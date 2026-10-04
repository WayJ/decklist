// tests/cli.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgv, flagValue, assertRuntime, buildCall, handleRejection } from "../bin/decklist.js";
import { runInstall } from "../src/commands/install.js";
import { runAdd } from "../src/commands/add.js";
import { runList } from "../src/commands/list.js";

const run = promisify(execFile);
const BIN = fileURLToPath(new URL("../bin/decklist.js", import.meta.url));

test("bin has a node shebang", () => {
  assert.ok(readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env node"));
});

test("--help prints usage naming all three commands, exits 0", async () => {
  const { stdout } = await run(process.execPath, [BIN, "--help"]);
  for (const c of ["install", "add", "list"]) assert.match(stdout, new RegExp(c));
});

test("--version prints a semver", async () => {
  const { stdout } = await run(process.execPath, [BIN, "--version"]);
  assert.match(stdout, /^\d+\.\d+\.\d+/);
});

test("no args exits 1", async () => {
  await assert.rejects(run(process.execPath, [BIN]), (e) => e.code === 1);
});

test("unknown command exits 1", async () => {
  await assert.rejects(run(process.execPath, [BIN, "frobnicate"]), (e) => e.code === 1);
});

test("parseArgv splits -- into passthrough", () => {
  assert.deepEqual(parseArgv(["install", "-q", "--", "-a", "claude-code"]),
    { command: "install", rest: ["-q"], passthrough: ["-a", "claude-code"] });
  assert.deepEqual(parseArgv(["list"]), { command: "list", rest: [], passthrough: [] });
  assert.deepEqual(parseArgv([]), { command: undefined, rest: [], passthrough: [] });
});

test("flagValue reads --flag value and --flag=value", () => {
  assert.equal(flagValue(["--skill", "myutil"], "--skill"), "myutil");
  assert.equal(flagValue(["--pin=v1.2"], "--pin"), "v1.2");
  assert.equal(flagValue([], "--skill"), undefined);
});

test("assertRuntime flags pre-20 Node with a fix hint", () => {
  assert.match(assertRuntime("v18.20.1"), /Node >= 20/);
  assert.equal(assertRuntime(process.version), null);
});

test("buildCall wires each command, add carries passthrough (I1)", () => {
  const add = buildCall("add", { cwd: "/x", rest: ["o/r", "--skill", "s", "--pin", "v1"], passthrough: ["-a", "cc"] });
  assert.equal(add.fn, runAdd);
  assert.deepEqual(add.args, { cwd: "/x", source: "o/r", skill: "s", pin: "v1", passthrough: ["-a", "cc"] });
  const install = buildCall("install", { cwd: "/x", rest: [], passthrough: ["-g"] });
  assert.equal(install.fn, runInstall);
  assert.deepEqual(install.args, { cwd: "/x", passthrough: ["-g"] });
  const list = buildCall("list", { cwd: "/x", rest: [], passthrough: [] });
  assert.equal(list.fn, runList);
  assert.deepEqual(list.args, { cwd: "/x" });
});

test("handleRejection writes one line to err and returns 1 (C1)", () => {
  const chunks = [];
  const code = handleRejection(new Error("boom: x"), { write: (s) => chunks.push(s) });
  assert.equal(code, 1);
  assert.deepEqual(chunks, ["boom: x\n"]);
});
