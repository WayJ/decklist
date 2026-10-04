// tests/list.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeManifest } from "../src/manifest.js";
import { emptyLock, upsertEntry, writeLockfile } from "../src/lockfile.js";
import { runList } from "../src/commands/list.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-list-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };

const fakeEngine = (installedMap) => ({
  name: "skills", invocation: "npx skills",
  install: async () => { throw new Error("list never installs"); },
  installed: async () => new Map(installedMap),
});

test("four states rendered — Review Focus 4", async () => {
  const dir = tmp();
  writeManifest(dir, {
    ok: "o/ok",
    gone: "o/gone",
    drift: "o/drift",
    unpinned: "o/un",
  });
  const lock = emptyLock();
  upsertEntry(lock, "ok", { source: "o/ok", resolved: "h1" });
  upsertEntry(lock, "drift", { source: "o/drift", resolved: "h9" });
  writeLockfile(dir, lock);
  const engine = fakeEngine(new Map([
    ["ok", { source: "o/ok", hash: "h1" }],
    ["drift", { source: "o/drift", hash: "h1" }],
    ["unpinned", { source: "o/un", hash: "h1" }],
    ["extra", { source: "o/extra", hash: "h1" }],
  ]));
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine, out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /installed ok/);
  assert.match(text, /missing gone/);
  assert.match(text, /drifted drift/);
  assert.match(text, /drifted unpinned/);
  assert.match(text, /undeclared extra/);
});

test("no manifest exits 1", async () => {
  const dir = tmp();
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine: fakeEngine(new Map()), out });
  assert.equal(code, 1);
  assert.match(list.join(""), /decklist add/);
});

test("selector entry reports installed, never missing+undeclared (C3)", async () => {
  const dir = tmp();
  writeManifest(dir, { pw: { source: "o/pw", skill: "playwright" } });
  const lock = emptyLock();
  upsertEntry(lock, "pw", { source: "o/pw", resolved: "h1" });
  writeLockfile(dir, lock);
  const engine = fakeEngine(new Map([["playwright", { source: "o/pw", hash: "h1" }]]));
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine, out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /installed pw/);
  assert.doesNotMatch(text, /missing pw/);
  assert.doesNotMatch(text, /undeclared playwright/);
});

test("pinned entry absent on disk reports missing, not installed (C2/C3)", async () => {
  const dir = tmp();
  writeManifest(dir, { p: { source: "o/p", pin: "v1" } });
  const lock = emptyLock();
  upsertEntry(lock, "p", { source: "o/p", resolved: "v1" });
  writeLockfile(dir, lock);
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine: fakeEngine(new Map()), out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /missing p/);
  assert.doesNotMatch(text, /installed p/);
});
