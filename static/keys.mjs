const keySequences = {
  Escape: "\x1b",
  Tab: "\t",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~"
};

const shifted = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?", "`": "~"
};

function modifierCode(modifiers) {
  return 1 + (modifiers.has("shift") ? 1 : 0) + (modifiers.has("alt") ? 2 : 0) + (modifiers.has("ctrl") ? 4 : 0);
}

export function modifiedInput(data, modifiers) {
  if (modifiers.has("shift") && data.length === 1) data = shifted[data] ?? data.toUpperCase();
  if (modifiers.has("ctrl") && data.length === 1) {
    const character = data.toUpperCase();
    const code = character.charCodeAt(0);
    const controlNumbers = { " ": 0, "2": 0, "3": 27, "4": 28, "5": 29, "6": 30, "7": 31, "8": 127 };
    if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
    else if (character in controlNumbers) data = String.fromCharCode(controlNumbers[character]);
  }
  if (modifiers.has("alt")) data = `\x1b${data}`;
  return data;
}

export function keySequence(key, modifiers) {
  const modifier = modifierCode(modifiers);
  if (modifier > 1) {
    const final = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D", Home: "H", End: "F" }[key];
    if (final) return `\x1b[1;${modifier}${final}`;
    const number = { PageUp: 5, PageDown: 6, Delete: 3 }[key];
    if (number) return `\x1b[${number};${modifier}~`;
    if (key === "Tab" && modifiers.has("shift")) return "\x1b[Z";
  }
  return modifiedInput(keySequences[key] ?? "", modifiers);
}
