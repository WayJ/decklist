import { readFileSync, writeFileSync } from "node:fs";

export class LockfileError extends Error {
  constructor(file, reason) {
    super(`${file}: ${reason}`);
    this.name = "LockfileError";
    this.file = file;
    this.reason = reason;
  }
}

export function readLockfile(dir) {
  const file = dir + "/decklist.lock";
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new LockfileError("decklist.lock", `invalid JSON: ${e.message}`);
  }
}

export function writeLockfile(dir, lock) {
  writeFileSync(dir + "/decklist.lock", JSON.stringify(lock, null, 2) + "\n");
}

export function emptyLock({ name = "skills", invocation = "npx skills" } = {}) {
  return { decklistVersion: 1, engine: { name, invocation }, entries: {} };
}

export function upsertEntry(lock, name, { source, resolved }) {
  const entry = { source };
  if (resolved !== undefined) entry.resolved = resolved;
  lock.entries[name] = entry;
  return lock;
}

export function dropStale(lock, keys) {
  let dropped = 0;
  for (const name of Object.keys(lock.entries)) {
    if (!keys.has(name)) {
      delete lock.entries[name];
      dropped++;
    }
  }
  return dropped;
}
