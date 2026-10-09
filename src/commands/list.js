import { createSkillsEngine } from "../engine.js";
import { readManifest } from "../manifest.js";
import { readLockfile } from "../lockfile.js";
import { agentDir } from "../agent-dir.js";

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
    write("decklist.json not found — declare agents, then: decklist add <source> --agent <name>");
    return 1;
  }

  let lock;
  try {
    lock = readLockfile(cwd);
  } catch (e) {
    write(String(e.message));
    return 1;
  }
  const entries = lock?.entries ?? {};

  for (const [name, agent] of Object.entries(manifest.agents)) {
    const installed = await engine.installed({ cwd: agentDir(cwd, name) });
    const selectors = new Set(Object.values(agent.skills).map((d) => d.skill).filter(Boolean));
    for (const [key, dep] of Object.entries(agent.skills)) {
      const probe = dep.skill ?? key;
      const entry = entries[`${name}/${key}`];
      const match = dep.pin
        ? entry?.resolved === dep.pin
        : installed.has(probe) && entry?.resolved !== undefined && entry.resolved === installed.get(probe).hash;
      const state = !installed.has(probe) ? "missing"
        : match ? "installed"
        : "drifted";
      write(`${name} ${state} ${key}`);
    }
    for (const skill of installed.keys()) {
      if (!(skill in agent.skills) && !selectors.has(skill)) write(`${name} undeclared ${skill}`);
    }
  }
  return 0;
}
