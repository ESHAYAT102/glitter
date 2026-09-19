package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestOmarchyTheme(t *testing.T) {
	stateHome := t.TempDir()
	t.Setenv("XDG_STATE_HOME", stateHome)
	path := filepath.Join(stateHome, "omarchy", "current", "theme", "colors.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("mode = \"dark\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	omarchyTheme(response, httptest.NewRequest(http.MethodGet, "/api/theme", nil))
	if response.Code != http.StatusOK || response.Body.String() != "mode = \"dark\"\n" {
		t.Fatalf("unexpected theme response: %d %q", response.Code, response.Body.String())
	}
}

func TestTerminalEnvironmentDoesNotImpersonateHost(t *testing.T) {
	t.Setenv("TERMINAL", "ghostty")
	t.Setenv("GHOSTTY_RESOURCES_DIR", "/tmp/ghostty")

	env := terminalEnv()
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "TERMINAL=ghostty") || strings.Contains(joined, "GHOSTTY_RESOURCES_DIR=") {
		t.Fatal("host terminal identity leaked into shell")
	}
	if !strings.Contains(joined, "TERMINAL=glitter") || !strings.Contains(joined, "TERM_PROGRAM=Glitter") {
		t.Fatal("Glitter terminal identity is missing")
	}
}

func TestTerminalRunsShell(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	server := httptest.NewServer(http.HandlerFunc(terminal))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?id=persistence-test"
	header := http.Header{"Origin": {server.URL}}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))

	if err := conn.WriteJSON(message{Type: "input", Data: "glitter_value=persisted\r"}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	_ = conn.Close()

	conn, _, err = websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := conn.WriteJSON(message{Type: "input", Data: "printf 'restored:%s' \"$glitter_value\"\r"}); err != nil {
		t.Fatal(err)
	}
	for {
		_, output, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(output), "restored:persisted") {
			_ = conn.WriteJSON(message{Type: "close"})
			return
		}
	}
}
