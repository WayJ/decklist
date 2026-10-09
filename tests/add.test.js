// tests/add.test.js — v2
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError } from "../src/engine.js";
import { readLockfile } from "../src/lockfile.js";
import { runAdd } from "../src/commands/add.js";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-add-"));
const lines = () => { const l = []; return { list: l, out: { write: (s) => l.push(s) } }; };

function fakeEngine({ fail = false, noResolved = false, resolved = "h1" } = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      name: "skills", invocation: "npx skills",
      install: async (ref, opts) => {
        calls.push({ ref, opts });
        if (fail) throw new EngineError(ref.source, "boom");
        return noResolved ? {} : { resolved };
      },
      installed: async () => new Map(),
    },
  };
}

const writeManifest = (dir, agents) =>
  writeFileSync(join(dir, "decklist.json"), JSON.stringify({ agents }, null, 2));
const DEV = { harness: "cc", skills: { existing: "o/e" } };

test("success — installs into the agent dir with declared harness, records agent/key", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const { engine, calls } = fakeEngine();
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/r", agent: "dev", out });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref.harness, "cc");
  assert.equal(calls[0].opts.cwd, join(dir, "agents", "dev"));
  assert.ok(existsSync(join(dir, "agents", "dev")));
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.equal(manifest.agents.dev.skills.r, "o/r");
  assert.equal(readLockfile(dir).entries["dev/r"].resolved, "h1");
  assert.match(list.join(""), /added dev\/r \(o\/r\)/);
});

test("object form when skill or pin given", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const { engine } = fakeEngine();
  await runAdd({ cwd: dir, engine, source: "o/r", agent: "dev", skill: "s", out: lines().out });
  await runAdd({ cwd: dir, engine, source: "o/p", agent: "dev", pin: "v1", out: lines().out });
  const manifest = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8"));
  assert.deepEqual(manifest.agents.dev.skills.s, { source: "o/r", skill: "s" });
  assert.deepEqual(manifest.agents.dev.skills.p, { source: "o/p", pin: "v1" });
});

test("name derives from skill, else basename minus .git", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const { engine } = fakeEngine();
  await runAdd({ cwd: dir, engine, source: "https://github.com/o/r.git", agent: "dev", out: lines().out });
  await runAdd({ cwd: dir, engine, source: "o/other", agent: "dev", skill: "s", out: lines().out });
  const skills = JSON.parse(readFileSync(join(dir, "decklist.json"), "utf8")).agents.dev.skills;
  assert.deepEqual(Object.keys(skills).sort(), ["existing", "r", "s"]);
});

test("undeclared agent fails before any engine call", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const { engine, calls } = fakeEngine();
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/r", agent: "nope", out });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /agent "nope" is not declared/);
});

test("missing --agent or source → usage, exit 1", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const { engine } = fakeEngine();
  for (const args of [{ source: "o/r" }, { agent: "dev" }, {}]) {
    const { list, out } = lines();
    assert.equal(await runAdd({ cwd: dir, engine, out, ...args }), 1);
    assert.match(list.join(""), /usage: decklist add <source> --agent <name>/);
  }
});

test("missing manifest → exit 1, no engine call", async () => {
  const dir = tmp();
  const { engine, calls } = fakeEngine();
  const { list, out } = lines();
  assert.equal(await runAdd({ cwd: dir, engine, source: "o/r", agent: "dev", out }), 1);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /decklist\.json not found/);
});

test("corrupt lock → one-line error, manifest untouched", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const before = readFileSync(join(dir, "decklist.json"), "utf8");
  writeFileSync(join(dir, "decklist.lock"), "{oops");
  const { engine, calls } = fakeEngine();
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/r", agent: "dev", out });
  assert.equal(code, 1);
  assert.equal(readFileSync(join(dir, "decklist.json"), "utf8"), before);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /decklist\.lock: invalid JSON/);
});

test("engine failure touches nothing", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const before = readFileSync(join(dir, "decklist.json"), "utf8");
  const { engine } = fakeEngine({ fail: true });
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/bad", agent: "dev", out });
  assert.equal(code, 1);
  assert.equal(readFileSync(join(dir, "decklist.json"), "utf8"), before);
  assert.equal(existsSync(join(dir, "decklist.lock")), false);
  assert.match(list.join(""), /boom/);
});

test("passthrough -a conflicts fail before any engine call", async () => {
  const dir = tmp();
  writeManifest(dir, { dev: DEV });
  const { engine, calls } = fakeEngine();
  const { list, out } = lines();
  const code = await runAdd({ cwd: dir, engine, source: "o/r", agent: "dev", passthrough: ["-a", "x"], out });
  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(list.join(""), /conflicts with the declared harness/);
});
