import assert from "node:assert/strict";
import { shouldDismissDrawer } from "./static/gesture.mjs";

assert.equal(shouldDismissDrawer(120, 320, -0.2), true);
assert.equal(shouldDismissDrawer(40, 320, -0.6), true);
assert.equal(shouldDismissDrawer(40, 320, -0.2), false);
console.log("Drawer swipe gesture OK");
