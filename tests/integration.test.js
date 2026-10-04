// tests/integration.test.js — real engine, hermetic local fixture
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
const PASSTHROUGH = ["-a", "claude-code"];

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

async function seed(dir) {
  const { engine } = counting();
  const code = await runAdd({ cwd: dir, engine, source: FIXTURE_SRC, skill: "myutil", passthrough: PASSTHROUGH, out: lines().out });
  assert.equal(code, 0);
  return engine;
}

test("add → manifest + lock grown, skill on disk", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.equal(manifest.skills.myutil.source, FIXTURE_SRC);
  const lock = JSON.parse(readFileSync(join(dir, "decklist.lock"), "utf8"));
  assert.ok(typeof lock.entries.myutil.resolved === "string");
  assert.ok(existsSync(join(dir, ".claude", "skills", "myutil", "SKILL.md")));
});

test("second install skips (no engine churn)", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  const { engine, calls } = counting();
  await seed(dir);
  await runInstall({ cwd: dir, engine, passthrough: PASSTHROUGH, out: lines().out });
  assert.equal(calls.length, 0);
});

test("deleting the lock forces reinstall", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const { engine, calls } = counting();
  unlinkSync(join(dir, "decklist.lock"));
  await runInstall({ cwd: dir, engine, passthrough: PASSTHROUGH, out: lines().out });
  assert.ok(calls.length >= 1);
});

test("list reports installed and undeclared", { skip: !engineAvailable }, async () => {
  const dir = tmp();
  await seed(dir);
  const engineLockFile = join(dir, "skills-lock.json");
  const engineLock = JSON.parse(readFileSync(engineLockFile, "utf8"));
  engineLock.skills.ghost = { source: "nowhere", sourceType: "local", computedHash: "deadbeef" };
  writeFileSync(engineLockFile, JSON.stringify(engineLock, null, 2) + "\n");
  const { list, out } = lines();
  const code = await runList({ cwd: dir, engine: createSkillsEngine(), out });
  const text = list.join("");
  assert.equal(code, 0);
  assert.match(text, /installed myutil/);
  assert.match(text, /undeclared ghost/);
});
