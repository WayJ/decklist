import { createSkillsEngine } from "../engine.js";
import { readManifest } from "../manifest.js";
import { emptyLock, readLockfile, upsertEntry, writeLockfile, dropStale } from "../lockfile.js";

export async function runInstall({ cwd, engine = createSkillsEngine(), passthrough = [], out = process.stdout } = {}) {
  const write = (s) => out.write(s + "\n");
  let manifest;
  try {
    manifest = readManifest(cwd);
  } catch (e) {
    write(String(e.message));
    return 1;
  }
  if (!manifest) {
    write("decklist.json not found — create one with: decklist add <source>");
    return 1;
  }

  const lock = readLockfile(cwd) ?? emptyLock({ name: engine.name, invocation: engine.invocation });
  const installed = await engine.installed({ cwd });

  let ok = 0, skipped = 0, failed = 0;
  for (const [name, dep] of Object.entries(manifest.skills)) {
    const entry = lock.entries[name];
    const skip = dep.pin
      ? entry?.resolved === dep.pin
      : installed.has(name) && entry?.resolved !== undefined && entry.resolved === installed.get(name).hash;
    if (skip) {
      write(`ok ${name}`);
      skipped++;
      continue;
    }
    try {
      const r = await engine.install(dep, { cwd, passthrough });
      const resolved = dep.pin ?? r.resolved;
      upsertEntry(lock, name, { source: dep.source, resolved });
      write(`installed ${name}`);
      ok++;
    } catch (e) {
      write(`failed ${name}: ${e.message}`);
      failed++;
    }
  }

  dropStale(lock, manifest.skills);
  writeLockfile(cwd, lock);
  write(`${ok} installed, ${skipped} skipped, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}
