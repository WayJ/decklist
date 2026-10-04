---
project: decklist
status: design-approved
date: 2026-10-04
---

# decklist — declarative skill dependency manager

## 1. Problem

The agent-skills ecosystem has installers but no dependency contract. Vercel's
`skills` CLI (`npx skills add owner/repo`) resolves sources, handles ~75 agent
directory layouts, and manages symlinks — but it is imperative: a project has
no way to *declare* which skills it depends on, and a fresh clone has no
one-command way to reproduce that set. There is no manifest, no install-all,
no lockfile.

decklist is that missing declarative layer: a `decklist.json` manifest, a
`decklist install` that installs every declared skill, and a `decklist.lock`
that records resolved versions — the npm-like contract layered on top of
existing engines.

## 2. Positioning

decklist **never touches agent directories itself**. Every install action is
delegated to an engine (v0: the `skills` CLI, invoked as `npx skills`).
decklist owns exactly three concerns:

1. manifest parsing and validation
2. install-all orchestration
3. lockfile version recording

The data model records **source + version only** — never install method, never
target agent. Both dimensions stay swappable: an engine can be replaced behind
the adapter interface without changing user-facing files, and agent selection
is a runtime passthrough, not a declaration.

decklist is a standalone project, not part of supervibe. supervibe is
decklist's first user (see §10, ADR-1).

## 3. Non-goals (v0)

- No `update` / `remove` / `doctor` commands (manifest stays hand-editable;
  refresh = delete the lockfile entry or the whole lockfile)
- No agent targeting in the manifest (runtime passthrough only)
- No multi-engine support (the adapter interface is reserved, one
  implementation ships)
- No registry, publishing, or authoring tooling
- No lockfile merge-conflict semantics (regenerate on conflict)

## 4. Manifest: `decklist.json`

Lives at the project root, committed to the repo.

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

- Each key under `skills` is a local name for the dependency (used by
  `decklist list` reporting and as the lockfile key). By convention it should
  match the engine-level skill name (the engine's lockfile keys by skill
  name); when it cannot, declare the selector with `skill`.
- String form is a source shorthand (`owner/repo`, git URL, local path).
- Object form adds:
  - `source` (required) — same grammar as the string form
  - `skill` (optional) — selector when one source carries multiple skills;
    passed to the engine as `-s <name>`
  - `pin` (optional) — a tag, branch, or commit to install; beats the
    lockfile when both exist
- No `agents` field, ever (§2).

Validation errors (unknown fields, missing `source`, bad `skills` shape,
empty names) fail with file + key + reason, not a stack trace.

## 5. Lockfile: `decklist.lock`

Written by decklist next to the manifest, committed to the repo.

```json
{
  "decklistVersion": 1,
  "engine": { "name": "skills", "invocation": "npx skills" },
  "entries": {
    "superpowers": { "source": "obra/superpowers", "resolved": "v6.4.2" },
    "myutil": { "source": "../tools/myutil", "resolved": "4ec8561c1a4cc3d..." }
  }
}
```

`resolved` records what identity decklist resolved for the entry: the pin
descriptor when pinned, otherwise the engine's content hash (spike
2026-10-04: the engine writes its own `skills-lock.json` with a
`computedHash` per skill, but cannot target a hash for installation).

Install semantics (npm-like, in precedence order):

1. manifest `pin` present → install the pinned ref, record `resolved` = pin
2. lockfile entry with `resolved` present → the engine installs and decklist
   verifies identity: a recorded pin is re-targeted exactly; a recorded hash
   cannot be installed by the engine, so the engine installs latest and
   decklist warns on hash drift (§8)
3. neither → resolve latest, record the engine's content hash

The engine's own `skills-lock.json` is engine state — decklist reads it as
the installed-state signal but neither commits, deletes, nor rewrites it;
whether the host repo commits it is the host repo's choice.

A stale lockfile entry whose manifest key disappeared is dropped on next
write. `decklistVersion` gates format migrations.

## 6. Commands

### `decklist install`

Read `decklist.json` → for each entry, in manifest order:

- already installed at the target version (identity rules in §5 against the
  engine's installed-state) → skip, report `ok`
- otherwise → invoke the engine with the resolved ref → record the outcome

Single-entry failure does **not** abort the run: remaining entries still
install (installs are idempotent; re-running resumes), the summary lists
successes and failures, and the exit code is non-zero if anything failed.
`decklist.lock` is written with every successfully resolved entry.

Arguments after `--` pass through to the engine verbatim
(e.g. `decklist install -- -a claude-code -g`). decklist stores nothing about
them.

### `decklist add <source> [--skill <name>] [--pin <ref>]`

Install via the engine first; only on success append the entry to
`decklist.json` (and the resolved identity to `decklist.lock`). This is the
`npm install <pkg> --save` experience — no hand-written JSON in the daily
loop. Local name defaults to the skill selector, else the source's last path
segment (`.git` stripped). On engine failure, manifest and lockfile are left
untouched.

### `decklist list`

Three-way report — manifest ↔ lockfile ↔ engine-installed state:

| state | meaning |
|---|---|
| `installed` | declared, identity matches pin/lock, present on disk (via engine) |
| `missing` | declared but not installed |
| `drifted` | installed but identity differs from pin/lock (incl. no lock entry) |
| `undeclared` | installed but not in the manifest (info row only) |

Read-only; drift, missing, and undeclared rows do not affect the exit code
(it is a report, not a gate) — fatal errors from §8 still exit 1.

## 7. Architecture

```
decklist/
├── bin/decklist.js      # CLI entry: arg parsing, -- split, dispatch, exit codes
├── src/
│   ├── manifest.js      # read/validate/write decklist.json
│   ├── lockfile.js      # read/write decklist.lock (decklistVersion migrations)
│   ├── engine.js        # Engine adapter interface + SkillsCliEngine
│   └── commands/
│       ├── install.js
│       ├── add.js
│       └── list.js
├── schema/decklist.schema.json
├── tests/               # node:test, zero deps (see §9)
├── package.json         # bin: { decklist: bin/decklist.js }
└── README.md
```

Engine adapter interface (one implementation in v0; reserved for swap):

```js
// Engine (all cwd-aware; decklist never chdir's)
{
  name,        // "skills"
  invocation,  // "npx skills" — recorded in decklist.lock
  install(ref, { cwd, passthrough })  // -> Promise<{ resolved | resolved? }>
               //   ref = { source, skill?, pin? }; throws EngineError on failure
  installed({ cwd })                  // -> Promise<Map<name, { source, hash }>>
               // read from the engine's skills-lock.json (engine-owned state),
               // NOT from parsing `skills list` output
}
```

Spike findings baked into the adapter (2026-10-04):

- The engine takes no ref argument — pins travel as GitHub tree URLs for
  `owner/repo`-shorthand sources; other source forms fail the entry up front
  with a clear message (§8).
- `-y` is always passed so the engine never blocks on skill-choice prompts;
  agent/scope prompts are avoided by the host's passthrough (e.g.
  `-a claude-code`) or the engine's agent auto-detection — decklist passes no
  `-a` of its own.
- The engine reinstalls on repeated `add` (no skip logic upstream) —
  decklist's own skip rule (§6) is load-bearing, not cosmetic.
- `npx` needs a shell wrapper on Windows (`spawn` with `shell: true` there).

Constraints: zero runtime dependencies, Node ≥ 20, ESM, distributed via npx
(`npx decklist install`). The only subprocess decklist spawns is the engine's.

## 8. Error handling

| failure | behavior |
|---|---|
| no `decklist.json` | explain + suggest `decklist add <source>` to create one; exit 1 |
| corrupt manifest/lockfile JSON | file + parse position, no stack trace; exit 1 |
| schema violation | file + key + reason; exit 1 |
| `npx` missing / Node < 20 | check once up front with a one-line fix hint; exit 1 |
| engine failure on one entry | record, continue others, summarize, exit 1 |
| pinned ref unresolvable (non-shorthand source) | that entry fails before spawning, message names the entry and the reason |
| lockfile hash un-installable by engine (expected case) | engine installs latest, warn on hash mismatch, record actual |

## 9. Testing

`node:test`, zero dependencies, `node --test`:

- **unit** — manifest parse/validate/round-trip (string and object forms,
  every rejection case in §8); lockfile read/write/drop-stale/migration gate
- **adapter** — engine argv construction with a mocked `spawn` (pin shorthand
  → tree URL, `-s` mapping, always `-y`, passthrough appended, non-shorthand
  pin fails before spawn); `installed()` against `skills-lock.json` fixtures
- **command** — install skip matrix, continue-on-failure, lockfile written
  with successes; add atomicity (no writes on engine failure), name
  derivation, manifest creation when absent; list four states
- **integration** — real `skills` CLI against a fixture local-path skill in a
  temp project (hermetic: no network); add → manifest + lock grown; second
  install skips; list states observed; auto-skipped when `npx skills` is
  unavailable in the environment

## 10. Decisions (ADR)

| id | decision | rationale | date |
|---|---|---|---|
| D1 | Standalone project (`~/orca/decklist`), not a supervibe subsystem | skill dependency management is a distribution-layer concern, orthogonal to supervibe's iteration layer; audiences differ (every agent user vs Scrum teams); release cadences differ; supervibe becomes decklist's first user instead of its container | 2026-10-04 |
| D2 | Declarative shell over an engine; v0 engine = Vercel `skills` CLI; manifest/lockfile record source+version only | the hard parts (source resolution, ~75 agent layouts, credentials) are already solved upstream; decklist adds only the missing declarative layer; engine-agnostic data model keeps the swap option open | 2026-10-04 |
| D3 | Agent-agnostic data model; agent choice is runtime passthrough (`--`) | the agent dimension belongs to the engine; keeping it out of decklist's files means no per-agent matrix in lockfile/list | 2026-10-04 |
| D4 | npm-like lockfile precedence: pin > lockfile resolved > latest | reproducible fresh clones are the point of a lockfile; explicit pins win; refresh stays manual in v0 | 2026-10-04 |
| D5 | `install` continues past per-entry failures (idempotent resume), non-zero exit at end | npm's fail-fast buys nothing here — installs are independent and resumable; a partial success with a clear summary beats an aborted half-run | 2026-10-04 |
| D6 | Zero runtime deps, Node ≥ 20, npx distribution | matches the supervibe-house philosophy; an npx-runnable single-purpose tool has no reason to carry dependencies | 2026-10-04 |
| D7 | Name: `decklist`; manifest `decklist.json`; published unscoped as `decklist` | card-game metaphor: the declared list of exactly what you bring to the match — judges check you against it (drift report), anyone can rebuild your deck from it (reproducible install); `belt` was taken on npm, `decklist` verified free on npm + GitHub 2026-10-04 | 2026-10-04 |
| D8 | `decklist.lock` and the engine's `skills-lock.json` coexist, not merge | the engine's lock is engine state (content hashes, install bookkeeping); decklist's lock is the committed engine-agnostic contract; merging them would couple decklist's format to one engine | 2026-10-04 |

## 11. Open Questions

| id | question | status |
|---|---|---|
| Q1 | Can the `skills` CLI install a *specific commit*? | closed 2026-10-04 spike — no ref argument exists; pins travel as GitHub tree URLs for shorthand sources, other forms fail the entry up front (§7, §8) |
| Q2 | Is the npm package name available? | closed 2026-10-04 — `belt` taken; `decklist` free on npm and GitHub, chosen (D7) |
| Q3 | Most reliable "already installed + version" signal? | closed 2026-10-04 spike — the engine's own `skills-lock.json` (`computedHash` per skill); parsing ANSI `skills list` output is brittle and rejected |
| Q4 | supervibe bootstrap (decklist.json in the supervibe repo + README line): land with decklist v0, or after npm publish? | open — recommend after publish so the README command actually works |

## 12. v0 Definition of Done

- [ ] `decklist install` from a fresh clone reproduces the declared skills via
      the real `skills` CLI against a real GitHub source
- [ ] second `decklist install` skips installed entries (no reinstall churn)
- [ ] lockfile precedence (pin > lock > latest) demonstrated by test
- [ ] `decklist add` grows manifest + lockfile in one step
- [ ] `decklist list` reports installed/missing/drifted/undeclared
- [ ] unit + adapter + command + integration suites green (`node --test`)
- [ ] README covers install/add/list, the `--` passthrough, and the lockfile
      contract
- [ ] published to npm as `decklist` and `npx decklist install` works
