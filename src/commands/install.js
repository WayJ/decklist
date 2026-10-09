import { mkdirSync } from "node:fs";
import { agentFlagConflict, createSkillsEngine } from "../engine.js";
import { readManifest } from "../manifest.js";
import { emptyLock, readLockfile, upsertEntry, writeLockfile, dropStale } from "../lockfile.js";
import { agentDir } from "../agent-dir.js";

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
    write("decklist.json not found — declare agents, then: decklist add <source> --agent <name>");
    return 1;
  }

  const conflict = agentFlagConflict(passthrough);
  if (conflict) {
    write(`passthrough ${conflict} conflicts with the declared harness — harness is declared per agent in decklist.json`);
    return 1;
  }

  let lock;
  try {
    lock = readLockfile(cwd) ?? emptyLock({ name: engine.name, invocation: engine.invocation });
  } catch (e) {
    write(String(e.message));
    return 1;
  }

  let ok = 0, skipped = 0, failed = 0;
  const validKeys = new Set();
  const agentEntries = Object.entries(manifest.agents);
  for (const [i, [name, agent]] of agentEntries.entries()) {
    const dir = agentDir(cwd, name);
    mkdirSync(dir, { recursive: true });
    if (i > 0) write("");
    const installed = await engine.installed({ cwd: dir });

    for (const [key, dep] of Object.entries(agent.skills)) {
      const lockKey = `${name}/${key}`;
      validKeys.add(lockKey);
      const probe = dep.skill ?? key;
      const entry = lock.entries[lockKey];
      const skip = dep.pin
        ? entry?.resolved === dep.pin && installed.has(probe)
        : installed.has(probe) && entry?.resolved !== undefined && entry.resolved === installed.get(probe).hash;
      if (skip) {
        write(`${name} ok ${key}`);
        skipped++;
        continue;
      }
      try {
        const r = await engine.install({ ...dep, harness: agent.harness }, { cwd: dir, passthrough });
        const resolved = dep.pin ?? r.resolved;
        if (!dep.pin && resolved !== undefined && entry?.resolved !== undefined && entry.resolved !== resolved) {
          write(`${name} drifted ${key}: locked ${entry.resolved}, now ${resolved}`);
        }
        upsertEntry(lock, lockKey, { source: dep.source, resolved });
        write(`${name} installed ${key}`);
        ok++;
      } catch (e) {
        write(`${name} failed ${key}: ${e.message}`);
        failed++;
      }
    }
  }

  dropStale(lock, validKeys);
  writeLockfile(cwd, lock);
  write(`${ok} installed, ${skipped} skipped, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}
