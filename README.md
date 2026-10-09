# decklist

**Declarative multi-agent environment definition for AI coding agents.**
docker-compose declares services; `decklist.json` declares agents. Each named
agent is an isolated environment: a harness (the agent tool it runs on), an
optional persona (a text prompt that defines it), and its own skill list.
One command installs every agent's skills into its own directory.

Zero dependencies. Node ≥ 20. The only subprocess decklist spawns is the
engine (the [`skills` CLI](https://github.com/vercel-labs/skills), via
`npx skills`), which resolves sources and knows the directory layouts of
~75 harnesses.

## Quickstart

`decklist add` records into a declared agent, so create `decklist.json` first:

```
cat > decklist.json <<'EOF'
{
  "agents": {
    "dev": { "harness": "claude-code", "skills": {} }
  }
}
EOF
```

Then:

```
decklist add obra/superpowers --agent dev    # install + record under agent "dev"
npx decklist install                         # or: npm i -g decklist && decklist install
decklist list                                # installed / missing / drifted, per agent
```

## Manifest: `decklist.json`

Lives at the project root, committed to the repo. Top-level basics follow the
npm `package.json` convention (all optional): `name`, `version`,
`description`, `private`, `license`, `author`.

```json
{
  "$schema": "https://raw.githubusercontent.com/WayJ/decklist/main/schema/decklist.schema.json",
  "name": "my-project",
  "version": "1.0.0",
  "agents": {
    "dev": {
      "harness": "claude-code",
      "persona": "You are a meticulous developer…",
      "skills": {
        "superpowers": "obra/superpowers",
        "pw": { "source": "microsoft/playwright-cli", "skill": "playwright", "pin": "v1.2.0" }
      }
    },
    "test": {
      "harness": "cursor",
      "skills": {}
    }
  }
}
```

- **Agent names** are yours to choose (`dev`, `test`, `reviewer`…) — any safe
  directory segment. Each agent gets its own isolated directory
  `agents/<name>/`; the engine runs inside it, so even two agents on the same
  harness never collide.
- **`harness`** (required) names the agent tool (`claude-code`, `cursor`,
  …). It is passed to the engine as-is; an unknown harness surfaces the
  engine's own error at install time.
- **`persona`** (optional) is an inline text prompt, up to 2000 characters.
  decklist only stores and validates it — how each harness consumes a persona
  differs and is deliberately out of scope.
- **`skills`** (required, may be empty) maps names to sources. A string entry
  is a source (`owner/repo` shorthand, git URL, or local path); the object
  form adds `skill` (pick one skill from a multi-skill source — also use it
  when your key differs from the engine-level skill name) and `pin` (a tag,
  branch, or commit; `owner/repo` shorthand only).

Add `agents/` to your `.gitignore` — it holds installed state.

## Lockfile: `decklist.lock`

Written by decklist next to the manifest. Entries are keyed
`"<agent>/<skill>"`; `resolved` records the pinned ref, or the engine's
content hash for unpinned entries. Precedence on install:

1. manifest `pin` → install the pinned ref exactly
2. lockfile `resolved` → pinned refs reinstall exactly; hashes can't be
   installed by the engine, so the engine installs latest and decklist warns
   on drift
3. neither → latest, recorded into the lock

A fresh clone with a committed lock installs anything actually missing; a
skip only happens when the engine's own state confirms the skill is present.

Refresh a dependency by deleting its lock entry (or the whole lockfile).

## Commands

| command | behavior |
|---|---|
| `decklist install` | for every agent: ensure `agents/<name>/`, then install each declared skill; current entries skip; one failure never stops the rest — failures summarize and the exit code is 1 |
| `decklist add <source> --agent <name> [--skill <n>] [--pin <ref>]` | install one source into a declared agent, then record it in manifest + lockfile; on failure nothing is written |
| `decklist list` | per agent: `installed` / `missing` / `drifted` per entry, plus `undeclared` rows; a report, not a gate |

## Passing flags to the engine

Everything after `--` goes to the engine verbatim — except agent flags: the
harness is declared per agent in `decklist.json`, so `-a`/`--agent` in the
passthrough is a conflict and fails immediately with exit 1.

```
decklist install -- -g
```

## The engine's own lockfile

The `skills` CLI writes its own `skills-lock.json` — one per agent directory.
That is engine state: decklist reads it to know what's installed but never
commits, deletes, or rewrites it.

## Development

```
node --test
```

## License

MIT
