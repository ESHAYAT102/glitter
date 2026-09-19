import assert from "node:assert/strict";
import { parseTheme } from "./static/theme.mjs";

const keys = [
  "accent", "selection", "muted", "background", "dark_background", "darker_background",
  "lighter_background", "foreground", "dark_foreground", "light_foreground", "bright_foreground",
  "red", "yellow", "orange", "green", "cyan", "blue", "magenta", "brown", "bright_red",
  "bright_yellow", "bright_green", "bright_cyan", "bright_blue", "bright_magenta"
];
const source = `mode = "dark"\n${keys.map(key => `${key} = "#123456"`).join("\n")}`;
const theme = parseTheme(source);
assert.equal(theme.terminal.background, "#232225");
assert.equal(theme.terminal.black, "#123456");
assert.equal(theme.ui, undefined);
assert.throws(() => parseTheme(source.replace(/^accent = .+$/m, 'accent = "blue"')), /six-digit hex color/);
console.log("Omarchy theme parser OK");
