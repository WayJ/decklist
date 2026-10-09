// tests/install.test.js — v2 per-agent install
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError } from "../src/engine.js";
import { emptyLock, readLockfile, upsertEntry, writeLockfile } from "../src/lockfile.js";
import { runInstall } from "../src/commands/install.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-install-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };
const basename = (p) => p.split("/").pop();

// installedByAgent: { dev: [["skill", {source, hash}], ...] }
function fakeEngine(installedByAgent = {}, failLockKey = null) {
  const calls = [];
  return {
    calls,
    engine: {
      name: "skills", invocation: "npx skills",
      install: async (ref, { cwd }) => {
        const lockKey = `${basename(cwd)}/${ref.skill ?? ref.source.split("/").pop()}`;
        calls.push({ ref, cwd });
        if (lockKey === failLockKey) throw new EngineError(ref.source, "boom");
        return { resolved: "h1" };
      },
      installed: async ({ cwd }) => new Map(installedByAgent[basename(cwd)] ?? []),
    },
  };
}

const writeManifest = (dir, agents) =>
  writeFileSync(join(dir, "decklist.json"), JSON.stringify({ agents }, null, 2));

const writeLock = (dir, entries) => {
  const lock = emptyLock();
  for (const [k, v] of Object.entries(entries)) upsertEntry(lock, k, v);
  writeLockfile(dir, lock);
};

test("fresh dual agent — installs per agent dir, empty-skills agent only mkdir'd", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { a: "o/r" } }, test: { harness: "cc", skills: {} } });
  const { engine, calls } = fakeEngine();
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref.harness, "cc");
  assert.equal(calls[0].cwd, join(dir, "agents", "dev"));
  assert.ok(existsSync(join(dir, "agents", "dev")));
  assert.ok(existsSync(join(dir, "agents", "test")));
  const text = list.join("");
  assert.match(text, /dev installed a/);
  assert.match(text, /1 installed, 0 skipped, 0 failed/);
});

test("RF1 fresh clone with committed lock installs pinned and hashed entries", async () => {
  const dir = tmp();
  writeManifest(dir, {
    dev: { harness: "cc", skills: { p: { source: "o/p", pin: "v1" } } },
    test: { harness: "cc", skills: { h: "o/h" } },
  });
  writeLock(dir, { "dev/p": { source: "o/p", resolved: "v1" }, "test/h": { source: "o/h", resolved: "h1" } });
  const { engine, calls } = fakeEngine();
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.ref.source).sort(), ["o/h", "o/p"]);
});

test("RF2 selector probes engine state by skill name", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { pw: { source: "o/pw", skill: "playwright" } } } });
  writeLock(dir, { "dev/pw": { source: "o/pw", resolved: "h1" } });
  const { engine, calls } = fakeEngine({ dev: [["playwright", { source: "o/pw", hash: "h1" }]] });
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /dev ok pw/);
});

test("pin match skips only when installed; absent on disk installs (C2)", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { x: { source: "o/x", pin: "v1" } } } });
  writeLock(dir, { "dev/x": { source: "o/x", resolved: "v1" } });
  const present = fakeEngine({ dev: [["x", { source: "o/x", hash: "v1" }]] });
  assert.equal(await runInstall({ cwd: dir, engine: present.engine, out: lines().out }), 0);
  assert.equal(present.calls.length, 0);
  const fresh = fakeEngine();
  assert.equal(await runInstall({ cwd: dir, engine: fresh.engine, out: lines().out }), 0);
  assert.equal(fresh.calls.length, 1);
});

test("hash drift warns with locked vs now", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { a: "o/r" } } });
  writeLock(dir, { "dev/a": { source: "o/r", resolved: "h9" } });
  const { engine } = fakeEngine({ dev: [["a", { source: "o/r", hash: "h1" }]] });
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 0);
  const text = list.join("");
  assert.match(text, /dev drifted a: locked h9, now h1/);
  assert.match(text, /dev installed a/);
  assert.equal(readLockfile(dir).entries["dev/a"].resolved, "h1");
});

test("RF3 passthrough -a conflicts fail before any engine call", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { a: "o/r" } } });
  for (const passthrough of [["-a", "claude-code"], ["--agent=x"]]) {
    const { engine, calls } = fakeEngine();
    const { list, out } = lines();
    const code = await runInstall({ cwd: dir, engine, passthrough, out });
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.match(list.join(""), /conflicts with the declared harness/);
  }
});

test("entry failure does not stop the rest; stale agent keys dropped from lock", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { a: "o/a", b: "o/b", c: "o/c" } } });
  writeLock(dir, { "old/x": { source: "o/x", resolved: "h0" } });
  const { engine } = fakeEngine({}, "dev/b");
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  const entries = readLockfile(dir).entries;
  assert.deepEqual(Object.keys(entries).sort(), ["dev/a", "dev/c"]);
  const text = list.join("");
  assert.match(text, /dev failed b: /);
  assert.match(text, /2 installed, 0 skipped, 1 failed/);
});

test("corrupt lock → one-line error, exit 1", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { a: "o/r" } } });
  writeFileSync(join(dir, "decklist.lock"), "{oops");
  const { engine } = fakeEngine();
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist\.lock: invalid JSON/);
});

test("no manifest → usage hint, exit 1", async () => {
  const dir = tmp();
  const { engine } = fakeEngine();
  const { list, out } = lines();
  const code = await runInstall({ cwd: dir, engine, out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist add <source> --agent <name>/);
});
