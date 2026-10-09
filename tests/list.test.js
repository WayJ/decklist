// tests/list.test.js — v2 per-agent report
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyLock, upsertEntry, writeLockfile } from "../src/lockfile.js";
import { runList } from "../src/commands/list.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-list-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };
const basename = (p) => p.split("/").pop();

// installedByAgent: { dev: [["skill", {source, hash}], ...] }
const fakeEngine = (installedByAgent = {}) => ({
  name: "skills", invocation: "npx skills",
  install: async () => { throw new Error("list never installs"); },
  installed: async ({ cwd }) => new Map(installedByAgent[basename(cwd)] ?? []),
});

const writeManifest = (dir, agents) =>
  writeFileSync(join(dir, "decklist.json"), JSON.stringify({ agents }, null, 2));
const writeLock = (dir, entries) => {
  const lock = emptyLock();
  for (const [k, v] of Object.entries(entries)) upsertEntry(lock, k, v);
  writeLockfile(dir, lock);
};

test("four states rendered with agent prefix — Review Focus 4", async () => {
  const dir = tmp();
  writeManifest(dir, {
    dev: { harness: "cc", skills: { ok: "o/ok", gone: "o/gone", drift: "o/drift", unpinned: "o/un" } },
  });
  writeLock(dir, {
    "dev/ok": { source: "o/ok", resolved: "h1" },
    "dev/drift": { source: "o/drift", resolved: "h9" },
  });
  const engine = fakeEngine({ dev: [
    ["ok", { source: "o/ok", hash: "h1" }],
    ["drift", { source: "o/drift", hash: "h1" }],
    ["unpinned", { source: "o/un", hash: "h1" }],
    ["extra", { source: "o/extra", hash: "h1" }],
  ] });
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine, out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /dev installed ok/);
  assert.match(text, /dev missing gone/);
  assert.match(text, /dev drifted drift/);
  assert.match(text, /dev drifted unpinned/);
  assert.match(text, /dev undeclared extra/);
});

test("RF2 selector entry reports installed, never missing+undeclared", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { pw: { source: "o/pw", skill: "playwright" } } } });
  writeLock(dir, { "dev/pw": { source: "o/pw", resolved: "h1" } });
  const engine = fakeEngine({ dev: [["playwright", { source: "o/pw", hash: "h1" }]] });
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine, out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /dev installed pw/);
  assert.doesNotMatch(text, /missing pw/);
  assert.doesNotMatch(text, /undeclared playwright/);
});

test("pinned entry absent on disk reports missing, not installed", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: { harness: "cc", skills: { p: { source: "o/p", pin: "v1" } } } });
  writeLock(dir, { "dev/p": { source: "o/p", resolved: "v1" } });
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine: fakeEngine(), out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /dev missing p/);
  assert.doesNotMatch(text, /dev installed p/);
});

test("agents are isolated — one agent's engine state is invisible to the other", async () => {
  const dir = tmp();
  writeManifest(dir, {
    dev: { harness: "cc", skills: { a: "o/a" } },
    test: { harness: "cc", skills: { a: "o/a" } },
  });
  writeLock(dir, { "dev/a": { source: "o/a", resolved: "h1" }, "test/a": { source: "o/a", resolved: "h1" } });
  const engine = fakeEngine({ dev: [["a", { source: "o/a", hash: "h1" }]] });
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine, out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /dev installed a/);
  assert.match(text, /test missing a/);
});

test("no manifest exits 1", async () => {
  const dir = tmp();
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine: fakeEngine(), out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist\.json not found/);
});
