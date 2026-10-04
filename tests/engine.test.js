// tests/engine.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EngineError, createSkillsEngine } from "../src/engine.js";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/engine", import.meta.url));
const HASH = "4ec8561c1a4cc3def68e0bdaf6d54315a64bb078a4ca76787cea63c20b5a87d9";

const tmp = () => mkdtempSync(join(tmpdir(), "decklist-engine-"));

function fakeSpawn({ code = 0, err = null } = {}) {
  const rec = { cmd: null, args: null, opts: null, calls: 0 };
  const spawn = (cmd, args, opts) => {
    rec.cmd = cmd; rec.args = args; rec.opts = opts; rec.calls++;
    return { on(ev, cb) {
      queueMicrotask(() => {
        if (err) { if (ev === "error") cb(err); return; }
        if (ev === "close") cb(code, null);
      });
    } };
  };
  return { rec, spawn };
}

function engineWith(spawn) {
  return createSkillsEngine({ spawnImpl: spawn });
}

test("argv: no pin, no skill", async () => {
  const { rec, spawn } = fakeSpawn();
  await engineWith(spawn).install({ source: "o/r" }, { cwd: tmp() });
  assert.deepEqual(rec.args, ["-y", "skills", "add", "o/r", "-y", "-s", "*"]);
  assert.equal(rec.cmd, "npx");
});

test("argv: skill selector passes -s myutil", async () => {
  const { rec, spawn } = fakeSpawn();
  await engineWith(spawn).install({ source: "o/r", skill: "myutil" }, { cwd: tmp() });
  assert.equal(rec.args[6], "myutil");
});

test("argv: pin on owner/repo shorthand becomes a GitHub tree URL", async () => {
  const { rec, spawn } = fakeSpawn();
  await engineWith(spawn).install({ source: "o/r", pin: "v1.2.0" }, { cwd: tmp() });
  assert.equal(rec.args[3], "https://github.com/o/r/tree/v1.2.0");
});

test("pin on a local path fails before spawning", async () => {
  const { rec, spawn } = fakeSpawn();
  await assert.rejects(
    engineWith(spawn).install({ source: "../x", pin: "v1" }, { cwd: tmp() }),
    (e) => e instanceof EngineError);
  assert.equal(rec.calls, 0);
});

test("argv: passthrough appended verbatim", async () => {
  const { rec, spawn } = fakeSpawn();
  await engineWith(spawn).install({ source: "o/r" }, { cwd: tmp(), passthrough: ["-a", "claude-code"] });
  assert.deepEqual(rec.args.slice(-2), ["-a", "claude-code"]);
});

test("success resolves pin over hash; skill-selected hash; unique-entry hash; omitted when ambiguous", async () => {
  const mk = (skills) => {
    const dir = tmp();
    writeFileSync(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills }));
    return dir;
  };
  const e = engineWith(fakeSpawn().spawn);
  assert.deepEqual(
    await e.install({ source: "o/r", pin: "v1" }, { cwd: mk({ myutil: { computedHash: HASH } }) }),
    { resolved: "v1" });
  assert.deepEqual(
    await e.install({ source: "o/r", skill: "myutil" }, { cwd: mk({ myutil: { computedHash: HASH } }) }),
    { resolved: HASH });
  assert.deepEqual(
    await e.install({ source: "../fixture-src" }, { cwd: mk({ myutil: { computedHash: HASH } }) }),
    { resolved: HASH });
  const ambiguous = mk({ a: { computedHash: "h1" }, b: { computedHash: "h2" } });
  assert.deepEqual(await e.install({ source: "o/r" }, { cwd: ambiguous }), {});
});

test("non-zero exit rejects with EngineError naming the exit code", async () => {
  const { spawn } = fakeSpawn({ code: 1 });
  await assert.rejects(
    engineWith(spawn).install({ source: "o/r" }, { cwd: tmp() }),
    (e) => e instanceof EngineError && /code 1/.test(e.reason));
});

test("spawn ENOENT (npx missing) becomes EngineError with a fix hint", async () => {
  const err = Object.assign(new Error("spawn npx ENOENT"), { code: "ENOENT" });
  const { spawn } = fakeSpawn({ err });
  await assert.rejects(
    engineWith(spawn).install({ source: "o/r" }, { cwd: tmp() }),
    (e) => e instanceof EngineError && /npx not found/.test(e.reason));
});

test("installed() parses the fixture; absent file yields an empty Map", async () => {
  const e = engineWith(fakeSpawn().spawn);
  const m = await e.installed({ cwd: FIXTURE_DIR });
  assert.deepEqual(m.get("myutil"), { source: "../fixture-src", hash: HASH });
  const empty = await e.installed({ cwd: tmp() });
  assert.equal(empty.size, 0);
});
