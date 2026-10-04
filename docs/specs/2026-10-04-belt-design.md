---
project: belt
status: design-approved
date: 2026-10-04
---

# belt — declarative skill dependency manager

## 1. Problem

The agent-skills ecosystem has installers but no dependency contract. Vercel's
`skills` CLI (`npx skills add owner/repo`) resolves sources, handles ~75 agent
directory layouts, and manages symlinks — but it is imperative: a project has
no way to *declare* which skills it depends on, and a fresh clone has no
one-command way to reproduce that set. There is no manifest, no install-all,
no lockfile.

belt is that missing declarative layer: a `belt.json` manifest, a
`belt install` that installs every declared skill, and a `belt.lock` that pins
resolved versions — the npm-like contract layered on top of existing engines.

## 2. Positioning

belt **never touches agent directories itself**. Every install action is
delegated to an engine (v0: the `skills` CLI, invoked as `npx skills`).
belt owns exactly three concerns:

1. manifest parsing and validation
2. install-all orchestration
3. lockfile version recording

The data model records **source + version only** — never install method, never
target agent. Both dimensions stay swappable: an engine can be replaced behind
the adapter interface without changing user-facing files, and agent selection
is a runtime passthrough, not a declaration.

belt is a standalone project, not part of supervibe. supervibe is belt's first
user (see §10, ADR-1).

## 3. Non-goals (v0)

- No `update` / `remove` / `doctor` commands (manifest stays hand-editable;
  refresh = delete the lockfile entry or the whole lockfile)
- No agent targeting in the manifest (runtime passthrough only)
- No multi-engine support (the adapter interface is reserved, one
  implementation ships)
- No registry, publishing, or authoring tooling
- No lockfile merge-conflict semantics (regenerate on conflict)

## 4. Manifest: `belt.json`

Lives at the project root, committed to the repo.

```json
{
  "$schema": "https://raw.githubusercontent.com/WayJ/belt/main/schema/belt.schema.json",
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
  `belt list` reporting and as the lockfile key).
- String form is a source shorthand (`owner/repo`, git URL, local path).
- Object form adds:
  - `source` (required) — same grammar as the string form
  - `skill` (optional) — selector when one source carries multiple skills;
    passed to the engine as `--skill <name>`
  - `pin` (optional) — a tag, branch, or commit to install; beats the
    lockfile when both exist
- No `agents` field, ever (§2).

Validation errors (unknown fields, missing `source`, bad `skills` shape,
duplicate names) fail with file + key + reason, not a stack trace.

## 5. Lockfile: `belt.lock`

Written by belt next to the manifest, committed to the repo.

```json
{
  "beltVersion": 1,
  "engine": { "name": "skills", "invocation": "npx skills" },
  "entries": {
    "superpowers": { "source": "obra/superpowers", "resolved": "<commit-sha>" }
  }
}
```

Install semantics (npm-like, in precedence order):

1. manifest `pin` present → install the pinned ref, record its resolved sha
2. lockfile entry with `resolved` present → install that sha (reproducibility)
3. neither → resolve latest, record the resolved sha

A stale lockfile entry whose manifest key disappeared is dropped on next write.
`beltVersion` gates format migrations.

## 6. Commands

### `belt install`

Read `belt.json` → for each entry, in manifest order:

- already installed at the target version (per engine's installed-state) →
  skip, report `ok`
- otherwise → invoke the engine with the resolved ref → record the outcome

Single-entry failure does **not** abort the run: remaining entries still
install (installs are idempotent; re-running resumes), the summary lists
successes and failures, and the exit code is non-zero if anything failed.
`belt.lock` is written with every successfully resolved entry.

Arguments after `--` pass through to the engine verbatim
(e.g. `belt install -- --agent cursor -g`). belt stores nothing about them.

### `belt add <source> [--skill <name>] [--pin <ref>]`

Install via the engine first; only on success append the entry to
`belt.json` (and the resolved sha to `belt.lock`). This is the
`npm install <pkg> --save` experience — no hand-written JSON in the daily
loop. Local name defaults to the source's repo/skill name.

### `belt list`

Three-way report — manifest ↔ lockfile ↔ engine-installed state:

| state | meaning |
|---|---|
| `installed` | declared, locked, present on disk (via engine) |
| `missing` | declared but not installed |
| `drifted` | installed version differs from lockfile/pin |

Read-only; drift does not affect the exit code (it is a report, not a gate) —
fatal errors from §8 still exit 1.

## 7. Architecture

```
belt/
├── bin/belt.js          # CLI entry: arg parsing, command dispatch
├── src/
│   ├── manifest.js      # read/validate/write belt.json
│   ├── lockfile.js      # read/write belt.lock (beltVersion migrations)
│   ├── engine.js        # Engine adapter interface + SkillsCliEngine
│   └── commands/
│       ├── install.js
│       ├── add.js
│       └── list.js
├── schema/belt.schema.json
├── tests/               # node:test, zero deps (see §9)
├── package.json         # bin: { belt: bin/belt.js }
└── README.md
```

Engine adapter interface (one implementation in v0; reserved for swap):

```js
// Engine
{
  name,                    // "skills"
  invocation,              // "npx skills" — recorded in belt.lock
  install(ref, opts)       // -> { resolved } ; throws EngineError on failure
                           //    ref = source + optional skill selector + optional pin
  installed()              // -> [{ name, source, version }]  (for list/install-skip)
}
```

Constraints: zero runtime dependencies, Node ≥ 20, distributed via npx
(`npx belt install`). The only subprocess belt spawns is the engine's.

## 8. Error handling

| failure | behavior |
|---|---|
| no `belt.json` | explain + suggest `belt add <source>` to create one; exit 1 |
| corrupt manifest/lockfile JSON | file + parse position, no stack trace; exit 1 |
| schema violation | file + key + reason; exit 1 |
| `npx` missing / Node < 20 | check once up front with a one-line fix hint; exit 1 |
| engine failure on one entry | record, continue others, summarize, exit 1 |
| pinned ref unresolvable | that entry fails with the engine's error surfaced |
| lockfile sha un-installable by engine (Q1 fallout) | install latest, warn on sha mismatch, record actual |

## 9. Testing

`node:test`, zero dependencies, `node --test`:

- **unit** — manifest parse/validate/round-trip (string and object forms,
  every rejection case in §8); lockfile read/write/drop-stale/migration gate
- **adapter** — engine invocation argv construction with a mocked `spawn`
  (pin → correct ref form, `--skill` mapping, passthrough after `--`)
- **integration** — real `skills` CLI against a fixture repo of local-path
  sources (hermetic: no network); install → lockfile written → second install
  skips; add → manifest grows; list → three states observed

## 10. Decisions (ADR)

| id | decision | rationale | date |
|---|---|---|---|
| D1 | Standalone project (`~/orca/belt`), not a supervibe subsystem | skill dependency management is a distribution-layer concern, orthogonal to supervibe's iteration layer; audiences differ (every agent user vs Scrum teams); release cadences differ; supervibe becomes belt's first user instead of its container | 2026-10-04 |
| D2 | Declarative shell over an engine; v0 engine = Vercel `skills` CLI; manifest/lockfile record source+version only | the hard parts (source resolution, ~75 agent layouts, credentials) are already solved upstream; belt adds only the missing declarative layer; engine-agnostic data model keeps the swap option open | 2026-10-04 |
| D3 | Agent-agnostic data model; agent choice is runtime passthrough (`--`) | the agent dimension belongs to the engine; keeping it out of belt's files means no per-agent matrix in lockfile/list | 2026-10-04 |
| D4 | npm-like lockfile precedence: pin > lockfile resolved > latest | reproducible fresh clones are the point of a lockfile; explicit pins win; refresh stays manual in v0 | 2026-10-04 |
| D5 | `install` continues past per-entry failures (idempotent resume), non-zero exit at end | npm's fail-fast buys nothing here — installs are independent and resumable; a partial success with a clear summary beats an aborted half-run | 2026-10-04 |
| D6 | Zero runtime deps, Node ≥ 20, npx distribution | matches the supervibe-house philosophy; an npx-runnable single-purpose tool has no reason to carry dependencies | 2026-10-04 |
| D7 | Name: `belt`; manifest `belt.json` | toolbelt metaphor — the project declares which tools its agent carries; short, everyday word, neutral (not Scrum-bound) | 2026-10-04 |

## 11. Open Questions

| id | question | status |
|---|---|---|
| Q1 | Can the `skills` CLI install a *specific commit* (tree URLs / `?version=` support per source type)? | open — spike in implementation; fallback is §8's install-latest-and-warn |
| Q2 | Is the npm package name `belt` available? | open — check at publish; fallback `@wayj/belt` or `beltcli` |
| Q3 | Most reliable "already installed + version" signal — engine `list` output parsing vs disk scan? | open — verify during implementation; engine-owned state preferred |
| Q4 | supervibe bootstrap (belt.json in the supervibe repo + README line): land with belt v0, or after npm publish? | open — recommend after publish so the README command actually works |

## 12. v0 Definition of Done

- [ ] `belt install` from a fresh clone reproduces the declared skills via the
      real `skills` CLI against a real GitHub source
- [ ] second `belt install` skips installed entries (no reinstall churn)
- [ ] lockfile precedence (pin > lock > latest) demonstrated by test
- [ ] `belt add` grows manifest + lockfile in one step
- [ ] `belt list` reports installed/missing/drifted
- [ ] unit + adapter + integration suites green (`node --test`)
- [ ] README covers install/add/list, the `--` passthrough, and the lockfile
      contract
- [ ] published to npm (scope/name per Q2) and `npx <name> install` works
