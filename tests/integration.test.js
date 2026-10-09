// tests/integration.test.js — real engine, dual-agent same-harness isolation
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillsEngine } from "../src/engine.js";
import { runAdd } from "../src/commands/add.js";
import { runInstall } from "../src/commands/install.js";
import { runList } from "../src/commands/list.js";

const run = promisify(execFile);
const FIXTURE_SRC = fileURLToPath(new URL("./fixtures/local-skill", import.meta.url));

let engineAvailable = false;
try {
  await run("npx", ["-y", "skills", "--help"], { timeout: 60_000 });
  engineAvailable = true;
} catch {
  engineAvailable = false;
}

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-e2e-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };
const counting = () => {
  const engine = createSkillsEngine();
  const calls = [];
  return { calls, engine: { ...engine, install: async (ref, opts) => { calls.push(ref); return engine.install(ref, opts); } } };
};

const AGENTS = { dev: { harness: "claude-code", skills: {} }, test: { harness: "claude-code", skills: {} } };
const writeManifest = (dir, agents = AGENTS) =>
  writeFileSync(join(dir, "decklist.json"), JSON.stringify({ agents }, null, 2) + "\n");

async function seed(dir) {
  writeManifest(dir);
  const { engine, calls } = counting();
  const code = await runAdd({ cwd: dir, engine, source: FIXTURE_SRC, agent: "dev", skill: "myutil", out: lines().out });
  assert.equal(code, 0);
  return { engine, calls };
}

test("add installs into the agent's own directory", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.equal(manifest.agents.dev.skills.myutil.skill, "myutil");
  assert.equal(manifest.agents.dev.skills.myutil.source, FIXTURE_SRC);
  const lock = JSON.parse(readFileSync(join(dir, "decklist.lock"), "utf8"));
  assert.ok(typeof lock.entries["dev/myutil"].resolved === "string");
  assert.ok(existsSync(join(dir, "agents", "dev", ".claude", "skills", "myutil", "SKILL.md")));
});

test("same skill under two agents on the same harness stays isolated", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  manifest.agents.test.skills.myutil = { source: FIXTURE_SRC, skill: "myutil" };
  writeManifest(dir, manifest.agents);
  const { engine, calls } = counting();
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.equal(calls.length, 1); // only the test agent's copy was missing
  assert.ok(existsSync(join(dir, "agents", "dev", ".claude", "skills", "myutil", "SKILL.md")));
  assert.ok(existsSync(join(dir, "agents", "test", ".claude", "skills", "myutil", "SKILL.md")));
  assert.ok(existsSync(join(dir, "agents", "dev", "skills-lock.json")));
  assert.ok(existsSync(join(dir, "agents", "test", "skills-lock.json")));
});

test("second install skips (no engine churn)", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const { engine, calls } = counting();
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
});

test("deleting the lock forces reinstall", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  unlinkSync(join(dir, "decklist.lock"));
  const { engine, calls } = counting();
  const code = await runInstall({ cwd: dir, engine, out: lines().out });
  assert.equal(code, 0);
  assert.ok(calls.length >= 1);
});

test("list reports per agent; undeclared stays inside its agent", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const engineLockFile = join(dir, "agents", "dev", "skills-lock.json");
  const engineLock = JSON.parse(readFileSync(engineLockFile, "utf8"));
  engineLock.skills.ghost = { source: "nowhere", sourceType: "local", computedHash: "deadbeef" };
  writeFileSync(engineLockFile, JSON.stringify(engineLock, null, 2) + "\n");
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine: createSkillsEngine(), out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /dev installed myutil/);
  assert.match(text, /dev undeclared ghost/);
});
