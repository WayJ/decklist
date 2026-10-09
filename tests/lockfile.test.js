// tests/lockfile.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockfileError, emptyLock, readLockfile, upsertEntry, writeLockfile, dropStale } from "../src/lockfile.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-lock-"));
const dir = tmp();

test("emptyLock shape is exact", () => {
  assert.deepEqual(emptyLock(), {
    decklistVersion: 1, engine: { name: "skills", invocation: "npx skills" }, entries: {}
  });
});

test("read absent → null; corrupt JSON → LockfileError with file+reason, not SyntaxError", () => {
  assert.equal(readLockfile(dir), null);
  writeFileSync(join(dir, "decklist.lock"), "{oops");
  assert.throws(() => readLockfile(dir), (e) =>
    e instanceof LockfileError && e.file === "decklist.lock" && !(e instanceof SyntaxError));
});

test("upsert overwrites; write→read round-trips; trailing newline", () => {
  const dir2 = tmp();
  let lock = emptyLock();
  upsertEntry(lock, "a", { source: "o/r", resolved: "h1" });
  upsertEntry(lock, "a", { source: "o/r", resolved: "h2" });
  writeLockfile(dir2, lock);
  const back = readLockfile(dir2);
  assert.equal(back.entries.a.resolved, "h2");
  assert.match(readFileSync(join(dir2, "decklist.lock"), "utf8"), /\n$/);
});

test("upsert without resolved omits the field; dropStale removes only stale and returns count", () => {
  let lock = emptyLock();
  upsertEntry(lock, "keep", { source: "o/r", resolved: "h1" });
  upsertEntry(lock, "gone", { source: "x/y" });
  assert.equal("resolved" in lock.entries.gone, false);
  assert.equal(dropStale(lock, new Set(["keep"])), 1);
  assert.deepEqual(Object.keys(lock.entries), ["keep"]);
});
