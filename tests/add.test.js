// tests/add.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError } from "../src/engine.js";
import { writeManifest } from "../src/manifest.js";
import { readLockfile } from "../src/lockfile.js";
import { runAdd } from "../src/commands/add.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-add-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };

function fakeEngine({ fail = false, noResolved = false, resolved = "h1" } = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      name: "skills", invocation: "npx skills",
      install: async (ref) => {
        calls.push(ref);
        if (fail) throw new EngineError(ref.source, "boom");
        return noResolved ? {} : { resolved };
      },
      installed: async () => new Map(),
    },
  };
}

test("success grows manifest (string form) and lock", async () => {
  const dir = tmp();
  writeManifest(dir, { existing: "o/e" });
  const { engine } = fakeEngine();
  const code = await runAdd({ cwd: dir, engine, source: "o/r", out: lines().out });
  assert.equal(code, 0);
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.deepEqual(manifest.skills, { existing: "o/e", r: "o/r" });
  assert.equal(readLockfile(dir).entries.r.resolved, "h1");
});

test("object form when skill or pin given", async () => {
  const dir = tmp();
  const { engine } = fakeEngine();
  await runAdd({ cwd: dir, engine, source: "o/r", skill: "s", out: lines().out });
  await runAdd({ cwd: dir, engine, source: "o/p", pin: "v1", out: lines().out });
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.deepEqual(manifest.skills.s, { source: "o/r", skill: "s" });
  assert.deepEqual(manifest.skills.p, { source: "o/p", pin: "v1" });
});

test("name derives from skill, else basename minus .git", async () => {
  const dir = tmp();
  const { engine } = fakeEngine();
  await runAdd({ cwd: dir, engine, source: "https://github.com/o/r.git", out: lines().out });
  await runAdd({ cwd: dir, engine, source: "o/other", skill: "s", out: lines().out });
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.skills), ["r", "s"]);
});

test("manifest absent → created", async () => {
  const dir = tmp();
  const { engine } = fakeEngine({ noResolved: true });
  const code = await runAdd({ cwd: dir, engine, source: "o/r", out: lines().out });
  assert.equal(code, 0);
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.deepEqual(manifest.skills, { r: "o/r" });
  const lock = readLockfile(dir);
  assert.equal(lock.decklistVersion, 1);
  assert.equal("resolved" in lock.entries.r, false);
});

test("engine failure touches nothing — Review Focus 3", async () => {
  const dir = tmp();
  writeManifest(dir, { existing: "o/e" });
  const before = readFileSync(join(dir, "decklist.json"), "utf8");
  const { engine } = fakeEngine({ fail: true });
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/bad", out });
  assert.equal(code, 1);
  assert.equal(existsSync(join(dir, "decklist.lock")), false);
  assert.equal(readFileSync(join(dir, "decklist.json"), "utf8"), before);
  assert.match(list.join(""), /boom/);
});

test("corrupt lock → one-line error, manifest untouched (C1)", async () => {
  const dir = tmp();
  writeManifest(dir, { existing: "o/e" });
  const before = readFileSync(join(dir, "decklist.json"), "utf8");
  writeFileSync(join(dir, "decklist.lock"), "{oops");
  const { engine } = fakeEngine();
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/r", out });
  assert.equal(code, 1);
  assert.equal(readFileSync(join(dir, "decklist.json"), "utf8"), before);
  assert.match(list.join(""), /decklist\.lock: invalid JSON/);
});
