import { createSkillsEngine } from "../engine.js";
import { readManifest } from "../manifest.js";
import { readLockfile } from "../lockfile.js";

export async function runList({ cwd, engine = createSkillsEngine(), out = process.stdout } = {}) {
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

  let lock;
  try {
    lock = readLockfile(cwd);
  } catch (e) {
    write(String(e.message));
    return 1;
  }
  lock = lock ?? { entries: {} };
  const installed = await engine.installed({ cwd });

  for (const [name, dep] of Object.entries(manifest.skills)) {
    const entry = lock.entries[name];
    const match = dep.pin
      ? entry?.resolved === dep.pin
      : installed.has(name) && entry?.resolved !== undefined && entry.resolved === installed.get(name).hash;
    const state = !installed.has(name) && !dep.pin ? "missing"
      : match ? "installed"
      : "drifted";
    write(`${state} ${name}`);
  }
  for (const name of installed.keys()) {
    if (!(name in manifest.skills)) write(`undeclared ${name}`);
  }
  return 0;
}
