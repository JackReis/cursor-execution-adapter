import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const value = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(
  value.marker,
  "CURSOR_ADAPTER_FIXTURE_V1",
  "fixture marker must be preserved",
);
assert.equal(value.sum, 42, "fixture numbers must sum to 42");
console.log("PASS: fixture content verified independently");
