import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createSkillsEngine } from "../engine.js";
import { readLockfile, emptyLock, upsertEntry, writeLockfile } from "../lockfile.js";

function defaultName(source) {
  return source.split("/").pop().replace(/\.git$/, "");
}

export async function runAdd({ cwd, engine = createSkillsEngine(), source, skill, pin, passthrough = [], out = process.stdout } = {}) {
  const write = (s) => out.write(s + "\n");
  if (!source) {
    write("usage: decklist add <source> [--skill <name>] [--pin <ref>]");
    return 1;
  }

  let installResult;
  try {
    installResult = await engine.install({ source, skill, pin }, { cwd, passthrough });
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
  doc.skills = doc.skills ?? {};
  doc.skills[name] = skill || pin
    ? { source, ...(skill && { skill }), ...(pin && { pin }) }
    : source;
  writeFileSync(manifestFile, JSON.stringify(doc, null, 2) + "\n");

  const lock = readLockfile(cwd) ?? emptyLock({ name: engine.name, invocation: engine.invocation });
  upsertEntry(lock, name, { source, resolved: installResult.resolved });
  writeLockfile(cwd, lock);
  write(`added ${name} (${source})`);
  return 0;
}
