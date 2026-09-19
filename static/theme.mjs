const COLOR_KEYS = [
  "accent", "selection", "muted", "background", "dark_background", "darker_background",
  "lighter_background", "foreground", "dark_foreground", "light_foreground", "bright_foreground",
  "red", "yellow", "orange", "green", "cyan", "blue", "magenta", "brown", "bright_red",
  "bright_yellow", "bright_green", "bright_cyan", "bright_blue", "bright_magenta"
];

export function parseTheme(source) {
  const values = {};
  const allowed = new Set(["mode", ...COLOR_KEYS]);
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-z_]+)\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
    if (!match || !allowed.has(match[1])) throw new Error(`Invalid theme entry on line ${index + 1}.`);
    if (values[match[1]] !== undefined) throw new Error(`Duplicate theme entry: ${match[1]}.`);
    values[match[1]] = match[2];
  }
  if (values.mode !== "light" && values.mode !== "dark") throw new Error('Theme mode must be "light" or "dark".');
  const missing = COLOR_KEYS.filter(key => !values[key]);
  if (missing.length) throw new Error(`Missing theme colors: ${missing.join(", ")}.`);
  for (const key of COLOR_KEYS) {
    if (!/^#[0-9a-f]{6}$/i.test(values[key])) throw new Error(`${key} must be a six-digit hex color.`);
  }
  return {
    mode: values.mode,
    source,
    terminal: {
      background: "#232225",
      foreground: values.foreground,
      cursor: values.accent,
      cursorAccent: "#232225",
      selectionBackground: values.selection,
      black: values.darker_background,
      red: values.red,
      green: values.green,
      yellow: values.yellow,
      blue: values.blue,
      magenta: values.magenta,
      cyan: values.cyan,
      white: values.foreground,
      brightBlack: values.muted,
      brightRed: values.bright_red,
      brightGreen: values.bright_green,
      brightYellow: values.bright_yellow,
      brightBlue: values.bright_blue,
      brightMagenta: values.bright_magenta,
      brightCyan: values.bright_cyan,
      brightWhite: values.bright_foreground
    }
  };
}
