import assert from "node:assert/strict";
import { keySequence, modifiedInput } from "./static/keys.mjs";

assert.equal(modifiedInput("c", new Set(["ctrl"])), "\x03");
assert.equal(modifiedInput("x", new Set(["shift", "alt"])), "\x1bX");
assert.equal(keySequence("ArrowUp", new Set()), "\x1b[A");
assert.equal(keySequence("ArrowLeft", new Set(["ctrl", "shift"])), "\x1b[1;6D");
assert.equal(keySequence("Delete", new Set()), "\x1b[3~");
console.log("Mobile extra keys OK");
