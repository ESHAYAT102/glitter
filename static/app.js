import { Terminal } from "/vendor/xterm.mjs";
import { FitAddon } from "/vendor/addon-fit.mjs";
import { parseTheme } from "/theme.mjs";
import { keySequence, modifiedInput } from "/keys.mjs";
import { shouldDismissDrawer } from "/gesture.mjs";

const THEME_STORAGE_KEY = "glitter-theme";
const FONT_STORAGE_KEY = "glitter-font";
const SESSION_STORAGE_KEY = "glitter-sessions";
const DEFAULT_FONT = "JetBrainsMono Nerd Font";

const terminalOptions = {
  cursorBlink: true,
  cursorStyle: "bar",
  fontFamily: '"JetBrainsMono Nerd Font", "JetBrainsMono NF", monospace',
  fontSize: 14,
  lineHeight: 1,
  scrollback: 5000,
  theme: {
    background: "#232225", foreground: "#eeeef0", cursor: "#b5b2bc", cursorAccent: "#232225",
    selectionBackground: "#625f69", black: "#121113", red: "#f47768", green: "#57d38c",
    yellow: "#e8c86d", blue: "#78a9ff", magenta: "#c792ea", cyan: "#67d4d0", white: "#d8d8d8",
    brightBlack: "#6f6d78", brightRed: "#ff8a7a", brightGreen: "#72e6a1", brightYellow: "#f3da86",
    brightBlue: "#93baff", brightMagenta: "#d8a7ef", brightCyan: "#83e3df", brightWhite: "#eeeef0"
  }
};

const tabs = document.querySelector("#tabs");
const terminals = document.querySelector("#terminals");
const status = document.querySelector("#status");
const toast = document.querySelector("#toast");
const drawer = document.querySelector("#session-drawer");
const openSessions = document.querySelector("#open-sessions");
const activeSessionName = document.querySelector("#active-session-name");
const titleForm = document.querySelector("#title-form");
const titleInput = document.querySelector("#title-input");
const sessionMenu = document.querySelector("#session-menu");
const renameForm = document.querySelector("#rename-form");
const renameInput = document.querySelector("#rename-input");
const shell = document.querySelector(".shell");
const toolbar = document.querySelector(".toolbar");
const terminalPanel = document.querySelector(".terminal-panel");
const settingsPage = document.querySelector("#settings-page");
const themeForm = document.querySelector("#theme-form");
const themeSource = document.querySelector("#theme-source");
const themeStatus = document.querySelector("#theme-status");
const themeError = document.querySelector("#theme-error");
const fontSelect = document.querySelector("#font-select");
const fontPicker = document.querySelector("#font-picker");
const fontOptions = document.querySelector("#font-options");
const fontValue = document.querySelector("#font-value");
const extraKeys = document.querySelector("#extra-keys");
const fontChoices = [...fontOptions.querySelectorAll("[data-font]")];
const sessions = [];
const activeModifiers = new Set();
let active;
let contextSession;
let nextID = 1;
let toastTimer;
let drawerTimer;
let drawerSwipe;
let suppressDrawerClick = false;
const drawerDuration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;

function fontStack(font) {
  if (font === "monospace") return "monospace";
  if (font === DEFAULT_FONT) return '"JetBrainsMono Nerd Font", "JetBrainsMono NF", monospace';
  return `"${font}", monospace`;
}

function applyFont(font, persist = true) {
  const choice = fontChoices.find(option => option.dataset.font === font) ?? fontChoices[0];
  font = choice.dataset.font;
  fontValue.textContent = choice.textContent;
  fontSelect.style.fontFamily = fontStack(font);
  for (const option of fontChoices) option.setAttribute("aria-checked", option === choice);
  terminalOptions.fontFamily = fontStack(font);
  for (const session of sessions) session.terminal.options.fontFamily = terminalOptions.fontFamily;
  if (persist) localStorage.setItem(FONT_STORAGE_KEY, font);
  if (active && !terminalPanel.hidden) requestAnimationFrame(() => resize());
}

function closeFontMenu(focus = false) {
  fontOptions.hidden = true;
  fontSelect.setAttribute("aria-expanded", "false");
  if (focus) fontSelect.focus();
}

function openFontMenu(focus = false) {
  fontOptions.hidden = false;
  fontSelect.setAttribute("aria-expanded", "true");
  if (focus) fontChoices.find(option => option.getAttribute("aria-checked") === "true").focus();
}

for (const option of fontChoices) option.style.fontFamily = fontStack(option.dataset.font);

function applyTheme(theme, label) {
  terminalOptions.theme = theme.terminal;
  for (const session of sessions) session.terminal.options.theme = theme.terminal;
  themeSource.value = theme.source;
  themeStatus.textContent = label;
  themeError.hidden = true;
}

async function useOmarchyTheme() {
  const response = await fetch("/api/theme", { cache: "no-store" });
  if (!response.ok) throw new Error("No active Omarchy colors.toml was found.");
  const theme = parseTheme(await response.text());
  localStorage.removeItem(THEME_STORAGE_KEY);
  applyTheme(theme, "Using Omarchy’s active theme");
}

async function initializeTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved) {
    try {
      applyTheme(parseTheme(saved), "Using a custom theme override");
      return;
    } catch {
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  }
  try {
    await useOmarchyTheme();
  } catch {
    themeStatus.textContent = "Using Glitter’s default Mauve theme";
  }
}

function setStatus(text, state = "") {
  status.dataset.state = state;
  status.querySelector("span").textContent = text;
}

function setSessionStatus(session, text, state = "") {
  session.status = { text, state };
  if (session === active) setStatus(text, state);
}

function notify(text) {
  toast.textContent = text;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1600);
}

function consumeModifiers(data) {
  for (const button of extraKeys.querySelectorAll("[data-modifier]")) button.setAttribute("aria-pressed", "false");
  activeModifiers.clear();
  return data;
}

function saveSessions() {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    active: active?.key,
    sessions: sessions.map(({ key, number, name }) => ({ key, number, name }))
  }));
}

function renameSession(session, name) {
  name = name.trim();
  if (!name || !sessions.includes(session)) return false;
  if (name === session.name) return true;
  session.name = name;
  session.label.textContent = name;
  session.closeButton.setAttribute("aria-label", `Close ${name}`);
  if (session === active) {
    activeSessionName.textContent = name;
    document.title = `${name} | Glitter`;
  }
  saveSessions();
  notify("Session renamed");
  return true;
}

function closeDrawer(afterClose) {
  clearTimeout(drawerTimer);
  sessionMenu.hidden = true;
  renameForm.hidden = true;
  drawer.classList.remove("visible");
  drawerTimer = setTimeout(() => {
    drawer.close();
    drawer.classList.remove("dragging");
    drawer.style.removeProperty("--drawer-translate");
    drawer.style.removeProperty("--drawer-overlay-opacity");
    openSessions.setAttribute("aria-expanded", "false");
    afterClose?.();
  }, drawerDuration);
}

function nextSessionNumber() {
  const used = new Set(sessions.map(session => session.number));
  let number = 1;
  while (used.has(number)) number++;
  return number;
}

function openSessionMenu(session, clientX, clientY) {
  contextSession = session;
  renameForm.hidden = true;
  sessionMenu.hidden = false;
  const drawerRect = drawer.getBoundingClientRect();
  const x = Math.min(Math.max(clientX - drawerRect.left, 8), drawerRect.width - sessionMenu.offsetWidth - 8);
  const y = Math.min(Math.max(clientY - drawerRect.top, 8), drawerRect.height - sessionMenu.offsetHeight - 8);
  sessionMenu.style.left = `${x}px`;
  sessionMenu.style.top = `${y}px`;
  sessionMenu.querySelector("button").focus();
}

function send(session, message) {
  if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
}

function resize(session = active) {
  if (!session || session !== active) return;
  session.fit.fit();
  send(session, { type: "resize", cols: session.terminal.cols, rows: session.terminal.rows });
}

function connect(session, restart = false) {
  session.socket?.close();
  session.terminal.reset();
  setSessionStatus(session, "Connecting");
  const query = new URLSearchParams({ id: session.key });
  if (restart) query.set("restart", "1");
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${query}`);
  session.socket = socket;
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    if (session.socket !== socket) return;
    setSessionStatus(session, "Connected", "connected");
    resize(session);
    if (session === active && !drawer.open) session.terminal.focus();
  });
  socket.addEventListener("message", event => {
    session.terminal.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data);
  });
  socket.addEventListener("close", () => {
    if (session.socket !== socket || session.disposed) return;
    setSessionStatus(session, "Disconnected", "disconnected");
    session.terminal.write("\r\n\x1b[31mSession ended. Use restart to open a new shell.\x1b[0m\r\n");
  });
  socket.addEventListener("error", () => {
    if (session.socket === socket) setSessionStatus(session, "Connection error", "disconnected");
  });
}

function activate(session, focus = true) {
  active = session;
  activeSessionName.textContent = session.name;
  document.title = `${session.name} | Glitter`;
  for (const item of sessions) {
    const selected = item === session;
    item.panel.hidden = !selected;
    item.trigger.setAttribute("aria-selected", selected);
    item.trigger.tabIndex = selected ? 0 : -1;
  }
  setStatus(session.status.text, session.status.state);
  saveSessions();
  requestAnimationFrame(() => {
    resize(session);
    if (focus) session.terminal.focus();
  });
}

function closeSession(session) {
  const index = sessions.indexOf(session);
  if (index < 0) return;
  const keepDrawerFocus = drawer.open;
  session.disposed = true;
  send(session, { type: "close" });
  session.socket?.close();
  session.terminal.dispose();
  session.panel.remove();
  session.tab.remove();
  sessions.splice(index, 1);
  if (session === active) {
    if (sessions.length) activate(sessions[Math.min(index, sessions.length - 1)], !keepDrawerFocus);
    else createSession(!keepDrawerFocus);
  }
  saveSessions();
  if (keepDrawerFocus) requestAnimationFrame(() => active.trigger.focus());
}

function createSession(focus = true, restored) {
  const id = nextID++;
  const number = restored?.number || nextSessionNumber();
  const name = restored?.name || `Session ${number}`;
  const key = restored?.key || (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${id}-${Math.random().toString(36).slice(2)}`);
  const panel = document.createElement("div");
  panel.className = "terminal-host";
  panel.id = `terminal-${id}`;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `tab-${id}`);
  terminals.append(panel);

  const tab = document.createElement("div");
  tab.className = "tab-item";
  tab.setAttribute("role", "presentation");
  tab.innerHTML = `<button class="tab-trigger" id="tab-${id}" type="button" role="tab" aria-controls="terminal-${id}"><span class="tab-label"></span></button><button class="tab-close" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M18 18 6 6"/></svg></button>`;
  tabs.append(tab);

  const terminal = new Terminal(terminalOptions);
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(panel);
  const session = {
    id, key, number, name, tab, panel, terminal, fit,
    trigger: tab.querySelector(".tab-trigger"),
    label: tab.querySelector(".tab-label"),
    closeButton: tab.querySelector(".tab-close"),
    status: { text: "Connecting", state: "" },
    socket: null,
    disposed: false
  };
  session.label.textContent = name;
  session.closeButton.setAttribute("aria-label", `Close ${name}`);
  sessions.push(session);
  session.trigger.addEventListener("click", () => {
    if (session === active) return;
    closeDrawer(() => activate(session));
  });
  session.closeButton.addEventListener("click", () => closeSession(session));
  tab.addEventListener("contextmenu", event => {
    event.preventDefault();
    openSessionMenu(session, event.clientX, event.clientY);
  });
  session.trigger.addEventListener("keydown", event => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = session.trigger.getBoundingClientRect();
    openSessionMenu(session, rect.left + 24, rect.bottom - 4);
  });
  let longPressTimer;
  let longPressX;
  let longPressY;
  let suppressClick = false;
  tab.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" || event.target.closest(".tab-close")) return;
    longPressX = event.clientX;
    longPressY = event.clientY;
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      suppressClick = true;
      openSessionMenu(session, longPressX, longPressY);
    }, 550);
  }, { passive: true });
  tab.addEventListener("pointermove", event => {
    if (longPressTimer && Math.hypot(event.clientX - longPressX, event.clientY - longPressY) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }, { passive: true });
  for (const type of ["pointerup", "pointercancel"]) {
    tab.addEventListener(type, () => {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
      if (suppressClick) setTimeout(() => { suppressClick = false; });
    });
  }
  tab.addEventListener("click", event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  terminal.onData(data => send(session, { type: "input", data: consumeModifiers(modifiedInput(data, activeModifiers)) }));
  activate(session, focus);
  connect(session);
}

tabs.addEventListener("keydown", event => {
  const trigger = event.target.closest(".tab-trigger");
  if (!trigger || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = sessions.findIndex(session => session.trigger === trigger);
  const index = event.key === "Home" ? 0 : event.key === "End" ? sessions.length - 1 :
    (current + (event.key === "ArrowDown" ? 1 : -1) + sessions.length) % sessions.length;
  sessions[index].trigger.focus();
});

sessionMenu.addEventListener("click", event => {
  const action = event.target.closest("button")?.dataset.action;
  const session = contextSession;
  if (!action || !sessions.includes(session)) return;
  sessionMenu.hidden = true;
  if (action === "rename") {
    renameForm.hidden = false;
    renameInput.value = session.name;
    requestAnimationFrame(() => renameInput.select());
  }
  if (action === "clear") {
    session.terminal.clear();
    send(session, { type: "input", data: "\x0c" });
    notify(`${session.name} cleared`);
    session.trigger.focus();
  }
  if (action === "close") closeSession(session);
});

renameForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!renameSession(contextSession, renameInput.value)) return;
  renameForm.hidden = true;
  contextSession.trigger.focus();
});

document.querySelector("#cancel-rename").addEventListener("click", () => {
  renameForm.hidden = true;
  contextSession?.trigger.focus();
});

activeSessionName.addEventListener("click", () => {
  titleInput.value = active.name;
  activeSessionName.hidden = true;
  titleForm.hidden = false;
  requestAnimationFrame(() => titleInput.select());
});
function finishTitleRename(save) {
  if (titleForm.hidden) return;
  if (save) renameSession(active, titleInput.value);
  titleForm.hidden = true;
  activeSessionName.hidden = false;
}
titleForm.addEventListener("submit", event => {
  event.preventDefault();
  finishTitleRename(true);
  active.terminal.focus();
});
titleInput.addEventListener("blur", () => finishTitleRename(true));
titleInput.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  finishTitleRename(false);
  activeSessionName.focus();
});

document.querySelector("#open-settings").addEventListener("click", () => {
  closeDrawer(() => {
    shell.classList.add("settings-open");
    toolbar.hidden = true;
    terminalPanel.hidden = true;
    settingsPage.hidden = false;
    document.querySelector("#close-settings").focus();
  });
});
document.querySelector("#close-settings").addEventListener("click", () => {
  closeFontMenu();
  settingsPage.hidden = true;
  toolbar.hidden = false;
  terminalPanel.hidden = false;
  shell.classList.remove("settings-open");
  requestAnimationFrame(() => {
    resize();
    active.terminal.focus();
  });
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !settingsPage.hidden) {
    event.preventDefault();
    document.querySelector("#close-settings").click();
  }
});
themeForm.addEventListener("submit", event => {
  event.preventDefault();
  try {
    const theme = parseTheme(themeSource.value);
    localStorage.setItem(THEME_STORAGE_KEY, theme.source);
    applyTheme(theme, "Using a custom theme override");
    notify("Theme applied");
  } catch (error) {
    themeError.textContent = error instanceof Error ? error.message : "Could not read this theme.";
    themeError.hidden = false;
  }
});
document.querySelector("#use-omarchy-theme").addEventListener("click", async () => {
  try {
    await useOmarchyTheme();
    notify("Omarchy theme applied");
  } catch (error) {
    themeError.textContent = error instanceof Error ? error.message : "Could not load the Omarchy theme.";
    themeError.hidden = false;
  }
});
fontSelect.addEventListener("click", () => {
  if (fontOptions.hidden) openFontMenu();
  else closeFontMenu();
});
fontSelect.addEventListener("keydown", event => {
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    openFontMenu(true);
  } else if (event.key === "Escape" && !fontOptions.hidden) {
    event.preventDefault();
    event.stopPropagation();
    closeFontMenu();
  }
});
fontOptions.addEventListener("click", event => {
  const option = event.target.closest("[data-font]");
  if (!option) return;
  applyFont(option.dataset.font);
  closeFontMenu(true);
  notify("Terminal font updated");
});
fontOptions.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeFontMenu(true);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = fontChoices.indexOf(document.activeElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? fontChoices.length - 1 :
    (current + (event.key === "ArrowDown" ? 1 : -1) + fontChoices.length) % fontChoices.length;
  fontChoices[index].focus();
});
document.addEventListener("pointerdown", event => {
  if (!fontOptions.hidden && !fontPicker.contains(event.target)) closeFontMenu();
});
fontPicker.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!fontPicker.contains(document.activeElement)) closeFontMenu();
  });
});

new ResizeObserver(() => resize()).observe(terminals);
openSessions.addEventListener("click", () => {
  clearTimeout(drawerTimer);
  drawer.classList.remove("dragging");
  drawer.style.removeProperty("--drawer-translate");
  drawer.style.removeProperty("--drawer-overlay-opacity");
  drawer.showModal();
  openSessions.setAttribute("aria-expanded", "true");
  setTimeout(() => drawer.classList.add("visible"));
});
drawer.addEventListener("close", () => openSessions.setAttribute("aria-expanded", "false"));
drawer.addEventListener("pointerdown", event => {
  if (event.pointerType === "touch") {
    drawerSwipe = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      dragging: false
    };
  }
});
drawer.addEventListener("pointermove", event => {
  if (drawerSwipe?.id !== event.pointerId) return;
  const x = event.clientX - drawerSwipe.startX;
  const y = event.clientY - drawerSwipe.startY;
  if (!drawerSwipe.dragging) {
    if (Math.hypot(x, y) < 8) return;
    if (x >= 0 || Math.abs(y) >= Math.abs(x)) {
      drawerSwipe = undefined;
      return;
    }
    drawerSwipe.dragging = true;
    drawer.classList.add("dragging");
  }
  const width = drawer.getBoundingClientRect().width;
  const distance = Math.min(Math.max(-x, 0), width);
  drawer.style.setProperty("--drawer-translate", `${-distance}px`);
  drawer.style.setProperty("--drawer-overlay-opacity", 1 - distance / width);
  event.preventDefault();
}, { passive: false });
drawer.addEventListener("pointerup", event => {
  if (drawerSwipe?.id === event.pointerId && drawerSwipe.dragging) {
    const distance = Math.max(drawerSwipe.startX - event.clientX, 0);
    const elapsed = Math.max(event.timeStamp - drawerSwipe.startTime, 1);
    suppressDrawerClick = true;
    setTimeout(() => { suppressDrawerClick = false; }, 300);
    drawer.classList.remove("dragging");
    if (shouldDismissDrawer(distance, drawer.getBoundingClientRect().width, -distance / elapsed)) {
      closeDrawer();
    } else {
      drawer.style.setProperty("--drawer-translate", "0px");
      drawer.style.setProperty("--drawer-overlay-opacity", "1");
    }
    event.preventDefault();
  }
  drawerSwipe = undefined;
});
drawer.addEventListener("pointercancel", () => {
  if (drawerSwipe?.dragging) {
    drawer.classList.remove("dragging");
    drawer.style.setProperty("--drawer-translate", "0px");
    drawer.style.setProperty("--drawer-overlay-opacity", "1");
  }
  drawerSwipe = undefined;
});
drawer.addEventListener("click", event => {
  if (!suppressDrawerClick) return;
  suppressDrawerClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
drawer.addEventListener("click", event => {
  if (!sessionMenu.hidden && !sessionMenu.contains(event.target)) sessionMenu.hidden = true;
  if (event.target === drawer && event.clientX > drawer.getBoundingClientRect().right) closeDrawer();
});
drawer.addEventListener("cancel", event => {
  event.preventDefault();
  if (!sessionMenu.hidden) {
    sessionMenu.hidden = true;
    contextSession?.trigger.focus();
    return;
  }
  if (!renameForm.hidden) {
    renameForm.hidden = true;
    contextSession?.trigger.focus();
    return;
  }
  closeDrawer();
});
document.querySelector("#add-tab").addEventListener("click", () => createSession());
document.querySelector("#new-session").addEventListener("click", () => closeDrawer(() => createSession()));
document.querySelector("#restart").addEventListener("click", () => {
  connect(active, true);
  notify("Shell restarted");
});
extraKeys.addEventListener("pointerdown", event => event.preventDefault());
extraKeys.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.modifier) {
    if (activeModifiers.has(button.dataset.modifier)) activeModifiers.delete(button.dataset.modifier);
    else activeModifiers.add(button.dataset.modifier);
    button.setAttribute("aria-pressed", activeModifiers.has(button.dataset.modifier));
  } else {
    send(active, { type: "input", data: consumeModifiers(keySequence(button.dataset.key, activeModifiers)) });
  }
  active.terminal.focus();
});

applyFont(localStorage.getItem(FONT_STORAGE_KEY) || DEFAULT_FONT, false);
await initializeTheme();
let stored;
try {
  stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY));
} catch {}
if (Array.isArray(stored?.sessions) && stored.sessions.length) {
  for (const session of stored.sessions) {
    if (typeof session?.key === "string" && typeof session?.name === "string" && Number.isInteger(session?.number)) {
      createSession(false, session);
    }
  }
  if (sessions.length) activate(sessions.find(session => session.key === stored.active) || sessions[0]);
}
if (!sessions.length) createSession();
