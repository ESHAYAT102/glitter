package main

import (
	"embed"
	"encoding/json"
	"flag"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/charmbracelet/log"
	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

//go:embed static
var assets embed.FS

var (
	appLog = log.NewWithOptions(os.Stderr, log.Options{
		Prefix:          "glitter",
		ReportTimestamp: true,
		TimeFormat:      "15:04:05",
	})
	nextSessionID atomic.Uint64
)

type message struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

func main() {
	addr := flag.String("addr", "0.0.0.0:3388", "address to listen on")
	flag.Parse()

	static, err := fs.Sub(assets, "static")
	if err != nil {
		appLog.Fatal("Could not load embedded assets", "error", err)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServer(http.FS(static)))
	mux.HandleFunc("GET /api/theme", omarchyTheme)
	mux.HandleFunc("GET /ws", terminal)

	server := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	appLog.Info("Glitter is ready", "url", "http://localhost:3388")
	if err := server.ListenAndServe(); err != nil {
		appLog.Fatal("Server stopped", "error", err)
	}
}

func omarchyTheme(w http.ResponseWriter, _ *http.Request) {
	stateHome := os.Getenv("XDG_STATE_HOME")
	if stateHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			http.Error(w, "Omarchy theme unavailable", http.StatusNotFound)
			return
		}
		stateHome = filepath.Join(home, ".local", "state")
	}
	colors, err := os.ReadFile(filepath.Join(stateHome, "omarchy", "current", "theme", "colors.toml"))
	if err != nil {
		http.Error(w, "Omarchy theme unavailable", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(colors)
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
	origin, err := url.Parse(r.Header.Get("Origin"))
	return err == nil && origin.Host == r.Host && (origin.Scheme == "http" || origin.Scheme == "https")
}}

const historyLimit = 1 << 20

type shellSession struct {
	id      string
	ptmx    *os.File
	cmd     *exec.Cmd
	conn    *websocket.Conn
	history []byte
	log     *log.Logger
	started time.Time
	mu      sync.Mutex
	once    sync.Once
}

type sessionStore struct {
	mu       sync.Mutex
	sessions map[string]*shellSession
}

var shells = sessionStore{sessions: make(map[string]*shellSession)}

func validSessionID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' {
			return false
		}
	}
	return true
}

func (store *sessionStore) get(id string, restart bool, client string) (*shellSession, error) {
	store.mu.Lock()
	old := store.sessions[id]
	if old != nil && !restart {
		store.mu.Unlock()
		return old, nil
	}
	if old != nil {
		delete(store.sessions, id)
	}
	store.mu.Unlock()
	if old != nil {
		old.stop()
	}

	session, err := startShell(id, client)
	if err != nil {
		return nil, err
	}
	store.mu.Lock()
	if existing := store.sessions[id]; existing != nil {
		store.mu.Unlock()
		session.stop()
		return existing, nil
	}
	store.sessions[id] = session
	store.mu.Unlock()
	go session.readOutput(store)
	return session, nil
}

func (store *sessionStore) close(id string, session *shellSession) {
	store.mu.Lock()
	if store.sessions[id] == session {
		delete(store.sessions, id)
	}
	store.mu.Unlock()
	session.stop()
}

func startShell(id, client string) (*shellSession, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-l")
	cmd.Env = terminalEnv()
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 80, Rows: 24})
	if err != nil {
		return nil, err
	}
	sessionLog := appLog.With("session", nextSessionID.Add(1), "shell", filepath.Base(shell), "client", client)
	sessionLog.Info("Shell session started")
	return &shellSession{id: id, ptmx: ptmx, cmd: cmd, log: sessionLog, started: time.Now()}, nil
}

func terminalEnv() []string {
	blocked := map[string]bool{
		"TERM": true, "COLORTERM": true, "TERMINAL": true, "TERM_PROGRAM": true, "TERM_PROGRAM_VERSION": true,
		"KITTY_WINDOW_ID": true, "KONSOLE_VERSION": true, "WEZTERM_EXECUTABLE": true, "GHOSTTY_RESOURCES_DIR": true,
	}
	env := make([]string, 0, len(os.Environ())+5)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !blocked[key] {
			env = append(env, entry)
		}
	}
	return append(env, "TERM=xterm-256color", "COLORTERM=truecolor", "TERMINAL=glitter", "TERM_PROGRAM=Glitter", "TERM_PROGRAM_VERSION=1")
}

func (session *shellSession) attach(conn *websocket.Conn) {
	session.mu.Lock()
	if session.conn != nil {
		_ = session.conn.Close()
	}
	session.conn = conn
	if len(session.history) > 0 {
		_ = conn.WriteMessage(websocket.BinaryMessage, session.history)
	}
	session.mu.Unlock()
}

func (session *shellSession) detach(conn *websocket.Conn) {
	session.mu.Lock()
	if session.conn == conn {
		session.conn = nil
	}
	session.mu.Unlock()
}

func (session *shellSession) readOutput(store *sessionStore) {
	buffer := make([]byte, 32<<10)
	for {
		n, err := session.ptmx.Read(buffer)
		if n > 0 {
			session.mu.Lock()
			session.history = append(session.history, buffer[:n]...)
			if len(session.history) > historyLimit {
				session.history = append([]byte(nil), session.history[len(session.history)-historyLimit:]...)
			}
			if session.conn != nil {
				if writeErr := session.conn.WriteMessage(websocket.BinaryMessage, buffer[:n]); writeErr != nil {
					_ = session.conn.Close()
					session.conn = nil
				}
			}
			session.mu.Unlock()
		}
		if err != nil {
			session.log.Debug("Shell output ended", "error", err)
			store.close(session.id, session)
			return
		}
	}
}

func (session *shellSession) stop() {
	session.once.Do(func() {
		session.mu.Lock()
		if session.conn != nil {
			_ = session.conn.Close()
			session.conn = nil
		}
		_ = session.ptmx.Close()
		_ = session.cmd.Process.Kill()
		session.mu.Unlock()
		_ = session.cmd.Wait()
		session.log.Info("Shell session closed", "duration", time.Since(session.started).Round(time.Millisecond))
	})
}

func terminal(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if !validSessionID(id) {
		http.Error(w, "Invalid session ID", http.StatusBadRequest)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		appLog.Warn("WebSocket upgrade failed", "client", r.RemoteAddr, "error", err)
		return
	}
	defer conn.Close()
	conn.SetReadLimit(64 << 10)
	session, err := shells.get(id, r.URL.Query().Get("restart") == "1", r.RemoteAddr)
	if err != nil {
		appLog.Error("Could not start shell", "error", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Unable to start shell: "+err.Error()))
		return
	}
	session.attach(conn)
	defer session.detach(conn)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg message
		if err := json.Unmarshal(data, &msg); err != nil {
			session.log.Warn("Ignored invalid terminal message", "error", err)
			continue
		}
		switch msg.Type {
		case "input":
			if _, err := io.WriteString(session.ptmx, msg.Data); err != nil {
				session.log.Error("Could not write to shell", "error", err)
				return
			}
		case "resize":
			if msg.Cols > 0 && msg.Cols <= 500 && msg.Rows > 0 && msg.Rows <= 300 {
				if err := pty.Setsize(session.ptmx, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows}); err != nil {
					session.log.Warn("Could not resize shell", "error", err)
				}
			}
		case "close":
			shells.close(id, session)
			return
		}
	}
}
