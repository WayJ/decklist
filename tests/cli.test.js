// tests/cli.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgv, flagValue, assertRuntime } from "../bin/decklist.js";

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
