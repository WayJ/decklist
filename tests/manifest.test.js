// tests/manifest.test.js — v2 model
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestError, parseManifest, readManifest, PERSONA_MAX } from "../src/manifest.js";

const parse = (obj) => parseManifest(JSON.stringify(obj));
const rejects = (obj, key, reasonRe) => assert.throws(
  () => parse(obj),
  (e) => {
    assert.ok(e instanceof ManifestError, `not ManifestError: ${e}`);
    if (key !== undefined) assert.equal(e.key, key, `key: got ${e.key}`);
    if (reasonRe) assert.match(e.reason ?? e.message, reasonRe);
    return true;
  },
);
const agent = (over = {}) => ({ harness: "claude-code", skills: { a: "o/r" }, ...over });
const doc = (agents, basics = {}) => ({ ...basics, agents });

test("valid full document — basics pass through, skills normalized", () => {
  const m = parse(doc(
    {
      dev: { harness: "claude-code", persona: "p", skills: { a: "o/r", b: { source: "o/b", skill: "s", pin: "v1" } } },
      test: { harness: "cursor", skills: {} },
    },
    { name: "my-proj", version: "1.2.3", description: "d", private: true, license: "MIT", author: "WayJ" },
  ));
  assert.equal(m.name, "my-proj");
  assert.equal(m.version, "1.2.3");
  assert.equal(m.private, true);
  assert.equal(m.author, "WayJ");
  assert.deepEqual(m.agents.dev.skills.a, { source: "o/r" });
  assert.deepEqual(m.agents.dev.skills.b, { source: "o/b", skill: "s", pin: "v1" });
  assert.equal(m.agents.dev.persona, "p");
  assert.equal(m.agents.test.harness, "cursor");
  assert.deepEqual(m.agents.test.skills, {});
  assert.ok(!("$schema" in m));
});

test("basic fields rejected on bad values", () => {
  rejects(doc(agent(), { name: "Bad Name" }), "name");
  rejects(doc(agent(), { version: "1.2" }), "version");
  rejects(doc(agent(), { description: "" }), "description");
  rejects(doc(agent(), { private: "yes" }), "private");
  rejects(doc(agent(), { license: "" }), "license");
  rejects(doc(agent(), { author: "" }), "author");
});

test("agents required; empty agents valid; top-level skills rejected with migration hint", () => {
  rejects({}, "agents");
  assert.deepEqual(parse(doc({})).agents, {});
  rejects({ skills: { a: "o/r" } }, "skills", /under an agent/);
});

test("agent names — valid segments accepted, traversal rejected", () => {
  for (const name of ["dev", "test-1", "a.b_c"]) {
    assert.ok(parse(doc({ [name]: agent() })).agents[name], name);
  }
  for (const name of ["../evil", ".", "..", "a/b"]) {
    rejects(doc({ [name]: agent() }), "agents", new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("harness required non-empty; any non-empty string accepted", () => {
  rejects(doc({ dev: { skills: {} } }), "agents.dev.harness");
  rejects(doc({ dev: { harness: "", skills: {} } }), "agents.dev.harness");
  assert.equal(parse(doc({ dev: { harness: "claude-code", skills: {} } })).agents.dev.harness, "claude-code");
});

test("persona optional, capped at PERSONA_MAX", () => {
  assert.equal(parse(doc({ dev: agent({ persona: "x".repeat(PERSONA_MAX) }) })).agents.dev.persona.length, PERSONA_MAX);
  rejects(doc({ dev: agent({ persona: "x".repeat(PERSONA_MAX + 1) }) }), "agents.dev.persona", /2000/);
  assert.equal(parse(doc({ dev: agent() })).agents.dev.persona, undefined);
});

test("skills required per agent (may be empty); entries validated (v0 rules under agent)", () => {
  rejects(doc({ dev: { harness: "cc" } }), "agents.dev.skills");
  assert.deepEqual(parse(doc({ dev: { harness: "cc", skills: {} } })).agents.dev.skills, {});
  rejects(doc({ dev: agent({ skills: { a: "" } }) }), "agents.dev.skills.a");
  rejects(doc({ dev: agent({ skills: { a: 42 } }) }), "agents.dev.skills.a");
  rejects(doc({ dev: agent({ skills: { a: { source: "o/r", extra: 1 } } }) }), "agents.dev.skills.a");
  rejects(doc({ dev: agent({ skills: { a: { source: "o/r", pin: 1 } } }) }), "agents.dev.skills.a");
  rejects(doc({ dev: agent({ skills: { "": "o/r" } }) }), undefined, /non-empty string/);
});

test("unknown agent key rejected", () => {
  rejects(doc({ dev: agent({ harnesses: "cc" }) }), "agents.dev");
});

test("v0 retained behaviors — invalid JSON, non-object top level, readManifest ENOENT", () => {
  assert.throws(() => parseManifest("{oops"), (e) => e instanceof ManifestError && /invalid JSON/.test(e.message));
  assert.throws(() => parseManifest("[]"), (e) => e instanceof ManifestError && /top level/.test(e.message));
  const dir = mkdtempSync(join(tmpdir(), "decklist-manifest-"));
  assert.equal(readManifest(dir), null);
  writeFileSync(join(dir, "decklist.json"), JSON.stringify(doc({ dev: agent() })));
  assert.equal(readManifest(dir).agents.dev.harness, "claude-code");
});

test("writeManifest is not exported — it wrote the v0 shape this parser rejects (review F1)", async () => {
  const m = await import("../src/manifest.js");
  assert.equal(m.writeManifest, undefined);
});
