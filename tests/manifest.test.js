// tests/manifest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestError, parseManifest, readManifest, writeManifest } from "../src/manifest.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-manifest-"));

test("parses string and object forms", () => {
  const m = parseManifest(JSON.stringify({
    $schema: "x", skills: { a: "o/r", b: { source: "o2/r2", skill: "s", pin: "v1" } }
  }));
  assert.deepEqual(m.skills.a, { source: "o/r" });
  assert.deepEqual(m.skills.b, { source: "o2/r2", skill: "s", pin: "v1" });
});

const bad = [
  ["not json", "invalid JSON"], ["[]", "top level"], ['{"skills":[]}', "skills"],
  ['{"skills":{"":"o/r"}}', "name"], ['{"skills":{"a":""}}', "source"],
  ['{"skills":{"a":{}}}', "source"], ['{"skills":{"a":{"source":"o/r","x":1}}}', "unknown"],
  ['{"skills":{"a":{"source":"o/r","skill":3}}}', "skill"],
  ['{"skills":{"a":{"source":"o/r","pin":3}}}', "pin"],
  ['{"extra":1,"skills":{}}', "unknown"],
];
for (const [text, reason] of bad) {
  test(`rejects: ${reason} (${text.slice(0, 24)})`, () => {
    assert.throws(() => parseManifest(text), (e) =>
      e instanceof ManifestError && e.reason.includes(reason));
  });
}

test("readManifest absent returns null; write→read round-trips with trailing newline", () => {
  const dir = tmp();
  assert.equal(readManifest(dir), null);
  writeManifest(dir, { a: { source: "o/r" } });
  assert.deepEqual(readManifest(dir).skills.a, { source: "o/r" });
  assert.match(readFileSync(join(dir, "decklist.json"), "utf8"), /\n$/);
});
