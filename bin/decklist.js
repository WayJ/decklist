#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInstall } from "../src/commands/install.js";
import { runAdd } from "../src/commands/add.js";
import { runList } from "../src/commands/list.js";

const USAGE = `decklist — declarative multi-agent environment definition

Usage:
  decklist install [-- <engine flags...>]   install every declared agent's skills
  decklist add <source> --agent <name> [--skill <n>] [--pin <ref>]
                                            install one source into a declared agent
  decklist list                             report installed / missing / drifted

Options:
  -h, --help       show this help
  -V, --version    print version
`;

export function parseArgv(argv) {
  const sep = argv.indexOf("--");
  const rest = sep === -1 ? argv : argv.slice(0, sep);
  const passthrough = sep === -1 ? [] : argv.slice(sep + 1);
  const known = new Set(["install", "add", "list"]);
  const command = rest.length > 0 && known.has(rest[0]) ? rest[0] : undefined;
  return { command, rest: command ? rest.slice(1) : rest, passthrough };
}

export function flagValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) return args[i + 1];
    if (arg.startsWith(name + "=")) return arg.slice(name.length + 1);
  }
  return undefined;
}

export function assertRuntime(version = process.version) {
  const major = Number(version.slice(1).split(".")[0]);
  return major >= 20 ? null : `decklist requires Node >= 20 (found ${version}); upgrade Node to continue.`;
}

export function buildCall(command, { cwd, rest = [], passthrough = [] } = {}) {
  if (command === "install") return { fn: runInstall, args: { cwd, passthrough } };
  if (command === "add") {
    return {
      fn: runAdd,
      args: {
        cwd, source: rest[0], agent: flagValue(rest, "--agent"),
        skill: flagValue(rest, "--skill"), pin: flagValue(rest, "--pin"), passthrough,
      },
    };
  }
  return { fn: runList, args: { cwd } };
}

export function handleRejection(e, err = process.stderr) {
  err.write(`${e?.message ?? String(e)}\n`);
  return 1;
}

async function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv.includes("-V") || argv.includes("--version")) {
    const { version } = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url))));
    process.stdout.write(version + "\n");
    return 0;
  }
  const hint = assertRuntime();
  if (hint) {
    process.stderr.write(hint + "\n");
    return 1;
  }

  const { command, rest, passthrough } = parseArgv(argv);
  if (!command) {
    process.stderr.write(USAGE);
    return 1;
  }

  const cwd = process.cwd();
  const { fn, args } = buildCall(command, { cwd, rest, passthrough });
  return fn(args);
}

// Realpath argv[1]: npm/npx invoke through node_modules/.bin symlinks, while
// the ESM loader resolves import.meta.url to the real file — a raw compare
// would never match and main() would never run under npx.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => process.exit(handleRejection(e)),
  );
}
