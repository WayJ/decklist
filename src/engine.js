import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";

export class EngineError extends Error {
  constructor(source, reason) {
    super(`skills ${source}: ${reason}`);
    this.name = "EngineError";
    this.source = source;
    this.reason = reason;
  }
}

const SHORTHAND = /^(?!\.)[\w.-]+\/(?!\.)[\w.-]+$/;

export function agentFlagConflict(passthrough = []) {
  for (const token of passthrough) {
    if (token === "-a" || token === "--agent" || token.startsWith("-a=") || token.startsWith("--agent=")) {
      return token;
    }
  }
  return null;
}

function sourceArg(ref) {
  if (!ref.pin) return ref.source;
  if (SHORTHAND.test(ref.source)) {
    return `https://github.com/${ref.source}/tree/${ref.pin}`;
  }
  throw new EngineError(ref.source,
    `cannot express pin "${ref.pin}" for this source form — pins support owner/repo GitHub shorthand only`);
}

function readEngineLock(cwd) {
  try {
    return JSON.parse(readFileSync(cwd + "/skills-lock.json", "utf8"));
  } catch {
    return null; // engine state is never a fatal error for decklist
  }
}

function pickHash(lock, skill) {
  const skills = lock && typeof lock.skills === "object" && lock.skills ? lock.skills : null;
  if (!skills) return undefined;
  if (skill) return skills[skill]?.computedHash;
  const keys = Object.keys(skills);
  return keys.length === 1 ? skills[keys[0]].computedHash : undefined;
}

function runSpawn(spawnImpl, cwd, args, source) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("npx", args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    let settled = false;
    const done = (fn) => { if (!settled) { settled = true; fn(); } };
    child.on("error", (err) => done(() => reject(new EngineError(source,
      err && err.code === "ENOENT" ? "npx not found on PATH" : String(err)))));
    child.on("close", (code) => done(() => code === 0
      ? resolve(code)
      : reject(new EngineError(source, `engine exited with code ${code}`))));
  });
}

export function createSkillsEngine({ spawnImpl = nodeSpawn } = {}) {
  return {
    name: "skills",
    invocation: "npx skills",
    async install(ref, { cwd, passthrough = [] } = {}) {
      const arg = sourceArg(ref);
      const args = [
        "-y", "skills", "add", arg, "-y", "-s", ref.skill ?? "*",
        ...(ref.harness ? ["-a", ref.harness] : []),
        ...passthrough,
      ];
      await runSpawn(spawnImpl, cwd, args, ref.source);
      const hash = pickHash(readEngineLock(cwd), ref.skill);
      const resolved = ref.pin ?? hash;
      return resolved === undefined ? {} : { resolved };
    },
    async installed({ cwd }) {
      const map = new Map();
      const lock = readEngineLock(cwd);
      const skills = lock && typeof lock.skills === "object" && lock.skills ? lock.skills : {};
      for (const [name, e] of Object.entries(skills)) {
        if (e && typeof e === "object") map.set(name, { source: e.source, hash: e.computedHash });
      }
      return map;
    },
  };
}
