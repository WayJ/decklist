# decklist

**Declarative skill dependency management for AI agents.** A card game's
decklist is the declared list of exactly what you bring to the match: judges
check you against it, and anyone can rebuild your deck from it. `decklist.json`
does that for agent skills — declare which skills your project depends on, and
one command installs every one of them.

Zero dependencies. Node ≥ 20. The only subprocess it spawns is the engine
(the [`skills` CLI](https://github.com/vercel-labs/skills), via `npx skills`),
which resolves sources and knows the directory layouts of ~75 agents.

## Quickstart

```
decklist add obra/superpowers          # install + record
npx decklist install                   # or: npm i -g decklist && decklist install
decklist list                          # installed / missing / drifted
```

## Manifest: `decklist.json`

Lives at the project root, committed to the repo:

```json
{
  "$schema": "https://raw.githubusercontent.com/WayJ/decklist/main/schema/decklist.schema.json",
  "skills": {
    "superpowers": "obra/superpowers",
    "playwright": {
      "source": "microsoft/playwright-cli",
      "skill": "playwright",
      "pin": "v1.2.0"
    }
  }
}
```

- A string entry is a source (`owner/repo` shorthand, git URL, or local path).
- The object form adds `skill` (pick one skill from a multi-skill source) and
  `pin` (a tag, branch, or commit). Pins work with `owner/repo` shorthand
  sources; other source forms with a pin fail the entry.
- **Naming convention:** key each entry by its engine-level skill name so skip
  and drift detection match. If the names must differ, declare the `skill`
  selector.
- There is no `agents` field — which agent to install into is a runtime
  choice, not a declaration.

## Lockfile: `decklist.lock`

Written by decklist next to the manifest. `resolved` records the pinned ref,
or the engine's content hash for unpinned entries. Precedence on install:

1. manifest `pin` → install the pinned ref exactly
2. lockfile `resolved` → pinned refs reinstall exactly; hashes can't be
   installed by the engine, so the engine installs latest and decklist warns
   on drift
3. neither → latest, recorded into the lock

Refresh a dependency by deleting its lock entry (or the whole lockfile).

## Commands

| command | behavior |
|---|---|
| `decklist install` | install everything in `decklist.json`; already-current entries are skipped; one failure never stops the rest — failures summarize and the exit code is 1 |
| `decklist add <source> [--skill <n>] [--pin <ref>]` | install one source via the engine, then record it in manifest + lockfile; on engine failure nothing is written |
| `decklist list` | report `installed` / `missing` / `drifted` per entry, plus `undeclared` info rows; a report, not a gate |

## Passing flags to the engine

Everything after `--` goes to the engine verbatim:

```
decklist install -- -a claude-code -g
```

In CI (non-interactive), pass the agent explicitly:

```
decklist install -- -a claude-code
```

## The engine's own lockfile

The `skills` CLI writes its own `skills-lock.json`. That is engine state —
decklist reads it to know what's installed but never commits, deletes, or
rewrites it. Whether your repo commits it is your choice.

## Development

```
node --test tests/
```

## License

MIT
