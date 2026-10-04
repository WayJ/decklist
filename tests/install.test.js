// tests/install.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError } from "../src/engine.js";
import { writeManifest } from "../src/manifest.js";
import { emptyLock, readLockfile, upsertEntry, writeLockfile } from "../src/lockfile.js";
import { runInstall } from "../src/commands/install.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-install-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };

function fakeEngine(installedMap, failSource = null) {
  const calls = [];
  return {
    calls,
    engine: {
      name: "skills", invocation: "npx skills",
      install: async (ref) => {
        calls.push(ref);
        if (ref.source === failSource) throw new EngineError(ref.source, "boom");
        return { resolved: "h1" };
      },
      installed: async () => new Map(installedMap),
    },
  };
}

const writeLock = (dir, entries) => {
  const lock = emptyLock();
  for (const [k, v] of Object.entries(entries)) upsertEntry(lock, k, v);
  writeLockfile(dir, lock);
  return lock;
};

test("fresh install writes lock with resolved and exits 0", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/r" });
  const { engine } = fakeEngine(new Map());
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  assert.equal(readLockfile(dir).entries.a.resolved, "h1");
  assert.match(list.join(""), /installed a/);
});

test("second run skips — engine.install not called again", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/r" });
  const installedMap = new Map([["a", { source: "o/r", hash: "h1" }]]);
  const { engine, calls } = fakeEngine(installedMap);
  writeLock(dir, { a: { source: "o/r", resolved: "h1" } });
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /ok a/);
});

test("pin match skips; pin mismatch installs and records pin", async () => {
  const dir = tmp();
  writeManifest(dir, { x: { source: "o/x", pin: "v1" }, y: { source: "o/y", pin: "v2" } });
  writeLock(dir, { x: { source: "o/x", resolved: "v1" }, y: { source: "o/y", resolved: "v1" } });
  const installedMap = new Map([["x", { source: "o/x", hash: "v1" }], ["y", { source: "o/y", hash: "v1" }]]);
  const { engine, calls } = fakeEngine(installedMap);
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((r) => r.source), ["o/y"]);
  const entries = readLockfile(dir).entries;
  assert.equal(entries.x.resolved, "v1");
  assert.equal(entries.y.resolved, "v2");
});

test("hash match skips; hash drift reinstalls", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/r", b: "o/r2" });
  writeLock(dir, { a: { source: "o/r", resolved: "h1" }, b: { source: "o/r2", resolved: "h9" } });
  const installedMap = new Map([["a", { source: "o/r", hash: "h1" }], ["b", { source: "o/r2", hash: "h1" }]]);
  const { engine, calls } = fakeEngine(installedMap);
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((r) => r.source), ["o/r2"]);
});

test("no lock entry → reinstalls (unknown identity), Review Focus 2", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/r" });
  const installedMap = new Map([["a", { source: "o/r", hash: "h1" }]]);
  const { engine, calls } = fakeEngine(installedMap);
  await runInstall({ cwd: dir, engine, out: lines().out });
  assert.deepEqual(calls.map((r) => r.source), ["o/r"]);
});

test("entry 2 of 3 failing does not stop 3 — exit 1, lock holds 1 and 3", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/a", b: "o/b", c: "o/c" });
  const { engine } = fakeEngine(new Map(), "o/b");
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  const entries = readLockfile(dir).entries;
  assert.deepEqual(Object.keys(entries).sort(), ["a", "c"]);
  assert.match(list.join(""), /failed b: /);
  assert.match(list.join(""), /2 installed, 0 skipped, 1 failed/);
});

test("no manifest exits 1 and suggests decklist add", async () => {
  const dir = tmp();
  const { engine } = fakeEngine(new Map());
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist add/);
});

test("corrupt lock → one-line error, exit 1 (C1)", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/r" });
  writeFileSync(join(dir, "decklist.lock"), "{oops");
  const { engine } = fakeEngine(new Map());
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist\.lock: invalid JSON/);
});

test("corrupt manifest → one-line error, exit 1 (C1/Review Focus 5)", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "decklist.json"), "not json");
  const { engine } = fakeEngine(new Map());
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist\.json: invalid JSON/);
});

test("fresh clone with committed lock installs pinned and hashed entries (C2)", async () => {
  const dir = tmp();
  writeManifest(dir, { p: { source: "o/p", pin: "v1" }, h: "o/h" });
  writeLock(dir, { p: { source: "o/p", resolved: "v1" }, h: { source: "o/h", resolved: "h1" } });
  const { engine, calls } = fakeEngine(new Map());
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((r) => r.source).sort(), ["o/h", "o/p"]);
});

test("selector matches installed state keyed by engine name (C3)", async () => {
  const dir = tmp();
  writeManifest(dir, { pw: { source: "o/pw", skill: "playwright" } });
  writeLock(dir, { pw: { source: "o/pw", resolved: "h1" } });
  const installedMap = new Map([["playwright", { source: "o/pw", hash: "h1" }]]);
  const { engine, calls } = fakeEngine(installedMap);
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /ok pw/);
});

test("hash drift warns with locked vs now (I2)", async () => {
  const dir = tmp();
  writeManifest(dir, { a: "o/r" });
  writeLock(dir, { a: { source: "o/r", resolved: "h9" } });
  const installedMap = new Map([["a", { source: "o/r", hash: "h1" }]]);
  const { engine } = fakeEngine(installedMap);
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  const text = list.join("");
  assert.match(text, /drifted a: locked h9, now h1/);
  assert.match(text, /installed a/);
});
