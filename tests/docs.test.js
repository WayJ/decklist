// tests/docs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("schema parses and covers the skills map", () => {
  const s = JSON.parse(readFileSync(new URL("../schema/decklist.schema.json", import.meta.url)));
  assert.equal(s.type, "object");
  assert.ok(s.properties.skills);
});

test("README documents the full surface", () => {
  const t = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const s of ["npx decklist install", "decklist add", "decklist list",
                   "--", "decklist.lock", "decklist.json", "-a claude-code"])
    assert.ok(t.includes(s), `README missing: ${s}`);
});
