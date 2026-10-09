import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { agentFlagConflict, createSkillsEngine } from "../engine.js";
import { readManifest } from "../manifest.js";
import { readLockfile, emptyLock, upsertEntry, writeLockfile } from "../lockfile.js";
import { agentDir } from "../agent-dir.js";

function defaultName(source) {
  return source.split("/").pop().replace(/\.git$/, "");
}

export async function runAdd({ cwd, engine = createSkillsEngine(), source, agent, skill, pin, passthrough = [], out = process.stdout } = {}) {
  const write = (s) => out.write(s + "\n");
  if (!source || !agent) {
    write("usage: decklist add <source> --agent <name> [--skill <n>] [--pin <ref>]");
    return 1;
  }

  let manifest;
  try {
    manifest = readManifest(cwd);
  } catch (e) {
    write(String(e.message));
    return 1;
  }
  if (!manifest) {
    write("decklist.json not found — declare agents in decklist.json first");
    return 1;
  }
  if (!manifest.agents[agent]) {
    write(`agent "${agent}" is not declared in decklist.json — declare it first`);
    return 1;
  }

  const conflict = agentFlagConflict(passthrough);
  if (conflict) {
    write(`passthrough ${conflict} conflicts with the declared harness — harness is declared per agent in decklist.json`);
    return 1;
  }

  // Lock read precedes the engine call: a corrupt lock must fail the command
  // before anything is installed, not after (no wasted side effects).
  let lock;
  try {
    lock = readLockfile(cwd) ?? emptyLock({ name: engine.name, invocation: engine.invocation });
  } catch (e) {
    write(String(e.message));
    return 1;
  }

  const dir = agentDir(cwd, agent);
  mkdirSync(dir, { recursive: true });
  let installResult;
  try {
    installResult = await engine.install(
      { source, skill, pin, harness: manifest.agents[agent].harness },
      { cwd: dir, passthrough },
    );
  } catch (e) {
    write(String(e.message));
    return 1;
  }

  const name = skill ?? defaultName(source);

  const manifestFile = cwd + "/decklist.json";
  let doc = {};
  if (existsSync(manifestFile)) {
    try {
      doc = JSON.parse(readFileSync(manifestFile, "utf8"));
    } catch (e) {
      write(`decklist.json: invalid JSON: ${e.message}`);
      return 1;
    }
  }
  doc.agents = doc.agents ?? {};
  doc.agents[agent] = doc.agents[agent] ?? { harness: manifest.agents[agent].harness, skills: {} };
  doc.agents[agent].skills = doc.agents[agent].skills ?? {};
  doc.agents[agent].skills[name] = skill || pin
    ? { source, ...(skill && { skill }), ...(pin && { pin }) }
    : source;
  writeFileSync(manifestFile, JSON.stringify(doc, null, 2) + "\n");

  upsertEntry(lock, `${agent}/${name}`, { source, resolved: installResult.resolved });
  writeLockfile(cwd, lock);
  write(`added ${agent}/${name} (${source})`);
  return 0;
}
