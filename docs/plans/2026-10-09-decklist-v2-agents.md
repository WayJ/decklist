# decklist v2(agents 模型)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 decklist 从 v0 的扁平 skills manifest 重构为 v2 声明式多 agent 环境定义(agents/<name> = harness + persona + skills,各自独立目录)。

**Architecture:** manifest 解析层换 v2 模型;install/add/list 逐 agent 以 `cwd = agents/<name>/` 驱动现有引擎适配器,harness 经 `install(ref)` 新增字段注入 `-a`;锁改键 `"<agent>/<skill>"`,v0 的 pin/hash/漂移/C2/C3 规则按 agent 作用域套用。引擎边界不变(decklist 只 mkdir + 写两个 json)。

**Tech Stack:** Node ≥ 20 ESM、零运行时依赖、`node:test`、Vercel `skills` CLI(经 `src/engine.js` 适配器)。

**Spec:** `docs/specs/2026-10-09-decklist-v2-agents-design.md`(本文所有决策的出处;冲突时以 spec 为准)。v0 spec 的引擎边界、锁契约、测试策略节继续有效。

## Global Constraints

- 零运行时依赖;Node ≥ 20;ESM;`npm test` = `node --test`(禁目录形式)。
- 写盘 JSON 一律 2 空格缩进 + 末尾换行。
- 错误输出:单行、英文、含 `<file>: <path>: <reason>`,exit 1,无栈。
- `PERSONA_MAX = 2000`(字符数,`String.prototype.length`);agent 目录常量 `agents/`。
- decklist 对文件系统的写入仅限:`mkdir agents/<name>/`(recursive)、写 `decklist.json`、写 `decklist.lock`。
- 版本保持 0.1.0;schema draft-07。
- 引擎状态(`skills-lock.json`)只读(D8)。decklist 不校验 harness 清单(D13)。

## Review Focus

1. **带 committed lock 的新克隆(pinned + hashed 混合)必须真装**(v0 C2 类):fake engine 空 installed、manifest 两 agent、锁含 `dev/p`(pin 匹配)与 `test/h`(hash 匹配)→ 2 次 install 调用。→ Task 2 测试。
2. **selector(key ≠ skill 名)在 agent 作用域内生效**(v0 C3 类):`agents.dev.skills.pw = {skill:"playwright"}`,installed 含 playwright → skip 且 list 报 `dev installed pw`、不报 `dev undeclared playwright`。→ Task 2、Task 4 测试。
3. **透传含 `-a` 必须在任何引擎调用之前失败**(无半装状态):`runInstall({passthrough:["-a","x"]})` → engine.calls.length === 0 且 exit 1;add 同。→ Task 2、Task 3 测试。
4. **agent 名穿越/保留段在解析层死亡,永不到 mkdir**:manifest 拒 `"../evil"`、`"."`、`".."`、`"a/b"`。→ Task 1 测试。
5. **persona 边界与纯 persona agent**:恰好 2000 字符合法、2001 拒绝;`skills: {}` 的 agent 合法且 install 对它零引擎调用(只 mkdir)。→ Task 1、Task 2 测试。

---

### Task 1: manifest v2 解析与校验

**Files:**
- Modify: `src/manifest.js`
- Rewrite: `tests/manifest.test.js`

**Interfaces:**
- Consumes: v0 的 `ManifestError`、`readManifest`(ENOENT→null)、`writeManifest` 行为不变。
- Produces:
  - `export const PERSONA_MAX = 2000`
  - `parseManifest(text)` → `{ name?, version?, description?, private?, license?, author?, agents: { [agentName]: { harness: string, persona?: string, skills: { [key]: { source, skill?, pin? } } } } }`(skills 字符串条目归一为 `{source}`;`$schema` 不进返回值)
  - 非法抛 `ManifestError`,key 形如 `agents.dev.persona`、`name`、`agents`;顶层 `skills` 的 reason 必须含 `under an agent`。

- [ ] **Step 1: 重写 `tests/manifest.test.js`(RED)**

用例清单(全部先失败):

1. 合法全字段:基础字段 + 两 agent(dev: harness+persona+skills;test: harness+空 skills)→ 返回值形状断言(基础字段透传、字符串归一 `{source}`)。
2. 基础字段逐项拒绝:`name: "Bad Name"`、`version: "1.2"`、`description: ""`、`private: "yes"`、`license: ""`、`author: ""`。
3. `agents` 缺失 → error;`agents: {}` 合法;顶层 `skills` → reason 含 `under an agent`。
4. agent 名:合法 `dev`、`test-1`、`a.b_c`;拒绝 `"../evil"`、`"."`、`".."/` 含斜杠即拒(正则 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` 全覆盖)。
5. `harness` 缺失 / 空串 → error;`harness: "claude-code"` 合法(任意非空串,不查清单)。
6. `persona`:缺省合法;`"x".repeat(2000)` 合法;`2001` → reason 含 `2000`。
7. `skills` 缺失 → error;`skills: {}` 合法;条目沿 v0:非法 source、未知对象键、空名拒绝(改写 v0 用例到 agent 之下)。
8. agent 对象未知键(如 `harnesses`)→ error(`additionalProperties` 语义)。
9. v0 保留行为:非法 JSON、非对象顶层、`readManifest` ENOENT→null(不改动,回归确认)。

- [ ] **Step 2: Run** `node --test tests/manifest.test.js` → 全部新断言 FAIL(旧实现不识 v2)。
- [ ] **Step 3: 实现 `src/manifest.js` v2**

顶层允许键白名单 `[$schema, name, version, description, private, license, author, agents]`;`name` 模式 `^[a-z0-9-~][a-z0-9-._~]*$`,`version` 模式 `^\d+\.\d+\.\d+$`;基础字段仅在出现时校验类型/模式;`agents` 必填对象;agent 校验按 Interfaces;skills 条目校验复用 v0 逻辑搬入 agent 循环。

- [ ] **Step 4: Run** `node --test tests/manifest.test.js` → PASS。
- [ ] **Step 5: Commit** `git add src/manifest.js tests/manifest.test.js && git commit -m "feat(manifest): v2 model — npm-style basics, agents{harness,persona≤2000,skills}"`

---

### Task 2: engine harness 注入 + agent 目录 + install v2

**Files:**
- Modify: `src/engine.js`、`src/lockfile.js`、`tests/engine.test.js`、`tests/lockfile.test.js`
- Create: `src/agent-dir.js`
- Rewrite: `src/commands/install.js`、`tests/install.test.js`

**Interfaces:**
- Consumes: Task 1 `parseManifest` 返回形态。
- Produces(Task 3/4 依赖):
  - `engine.install(ref, {cwd, passthrough})`:ref 增加可选 `harness`;argv 为 `["-y","skills","add", sourceArg, "-y","-s", skill??"*", ...(ref.harness ? ["-a", ref.harness] : []), ...passthrough]`(harness 在 passthrough 之前;无 harness 同 v0)。
  - `src/agent-dir.js`:`export const AGENTS_DIR = "agents"; export const agentDir = (cwd, name) => join(cwd, AGENTS_DIR, name);`
  - `dropStale(lock, keys)`:`keys` 由对象改为 `Set<string>`(全量合法键集合),不在集合内的条目删除,返回删除数。
  - `engine.js` 新增 `agentFlagConflict(passthrough) → string | null`:命中 token 为 `"-a"`、`"--agent"`、或前缀 `"-a="`/`"--agent="` 时返回该 token。
  - `runInstall({cwd, engine, passthrough, out})` 流程:
    1. `readManifest` null → `decklist.json not found — declare agents, then: decklist add <source> --agent <name>`,exit 1;解析错误单行 exit 1(C1 包裹沿 v0)。
    2. `agentFlagConflict(passthrough)` 命中 → `passthrough <token> conflicts with the declared harness — harness is declared per agent in decklist.json`,exit 1(**任何引擎调用之前**)。
    3. lock 读取 try/catch(损坏锁单行 exit 1)。
    4. 逐 agent(`Object.entries(manifest.agents)`):`mkdirSync(agentDir(cwd,name),{recursive:true})`;agent 间输出空行;`installed = await engine.installed({cwd: agentDir})`;逐 skill:`lockKey = "<agent>/<key>"`,`probe = dep.skill ?? key`,skip/drift/installed/failed 规则同 v0(C2:pin skip 需 `installed.has(probe)`;C3:probe 用 selector;漂移行 `<agent> drifted <key>: locked <old>, now <new>`),行前缀 `<agent> `。
    5. `dropStale(lock, new Set(全部 lockKey))` + 写锁 + `${ok} installed, ${skipped} skipped, ${failed} failed`,exit `failed>0?1:0`。

- [ ] **Step 1: RED — engine/lockfile/agent-dir**

`tests/engine.test.js` 追加:ref 含 `harness:"claude-code"` → argv 断言含 `"-a","claude-code"` 且在 passthrough 前;ref 无 harness → argv 无 `-a`(v0 用例保持绿)。`tests/lockfile.test.js` 改 `dropStale` 用 `Set`。Run both → FAIL。

- [ ] **Step 2: 实现** `src/engine.js`(argv 按上)、`src/lockfile.js`(`dropStale` 收 Set)、`src/agent-dir.js`。Run both → PASS。

- [ ] **Step 3: RED — 重写 `tests/install.test.js`**

用例(伪代码级断言):

1. 双 agent 全新安装:manifest `{dev:{harness:"cc",skills:{a:"o/r"}},test:{harness:"cc",skills:{}}}` → 调用 1 次(source o/r、harness cc、cwd=…/agents/dev),`agents/test` 目录也被 mkdir,输出含 `dev installed a`、汇总 `1 installed`。
2. **RF1**:committed lock 双 agent(pinned `dev/p` + hashed `test/h`)+ 空 installed → 2 次 install 调用。
3. **RF2**:selector skip:manifest `dev.skills.pw={source:"o/pw",skill:"playwright"}`,lock `dev/pw` resolved h1,installed 含 playwright h1 → 0 调用、输出 `dev ok pw`。
4. pin 匹配 + 已装 → skip;pin 匹配但未装 → 装(C2,installed map 必须填)。
5. hash 漂移:输出 `dev drifted a: locked h9, now h1` + `dev installed a`。
6. **RF3**:passthrough `["-a","claude-code"]` → exit 1、`engine.calls.length===0`;`["--agent=x"]` 同。
7. **RF5**:`skills:{}` agent → 0 调用、目录存在。
8. 中途失败不断全局(3 skill 1 失败)→ exit 1,锁含成功两条;dropStale:manifest 删掉某 agent 后其 `agent/*` 键全清。
9. corrupt lock → 单行 exit 1;manifest 缺失 → usage 行 exit 1(v0 回归)。

Run → FAIL。

- [ ] **Step 4: 实现 `src/commands/install.js`**(按 Interfaces 流程)。Run tests/install.test.js → PASS。
- [ ] **Step 5: 全套** `npm test` → 此时 install/add/list/cli/docs/integration 仍为 v0 断言,预期红 —— 本任务提交范围只含上述文件;v0 旧文件的改写在 Task 3-6。允许提交时套件非全绿(记录于 ledger),Task 6 收敛。**若你选择保持主干每提交全绿**:把本任务与 Task 3、4 合并为一个提交序列执行,提交信息不变。此处由执行者裁定并记 Ruling。
- [ ] **Step 6: Commit** `git add src/engine.js src/lockfile.js src/agent-dir.js src/commands/install.js tests/engine.test.js tests/lockfile.test.js tests/install.test.js && git commit -m "feat(install): per-agent isolated dirs, declared-harness -a injection, agent/skill lock keys"`

---

### Task 3: add v2 + bin `--agent`

**Files:**
- Modify: `src/commands/add.js`、`bin/decklist.js`
- Rewrite: `tests/add.test.js`
- Modify: `tests/cli.test.js`

**Interfaces:**
- Consumes: Task 1 manifest 形态、Task 2 `agentDir`/`agentFlagConflict`/install-harness。
- Produces: `runAdd({cwd, engine, source, agent, skill, pin, passthrough, out})`;`buildCall("add", …)` 的 args 含 `agent: flagValue(rest, "--agent")`;usage 精确文案:

```
decklist add <source> --agent <name> [--skill <n>] [--pin <ref>]
                                            install one source into a declared agent
```

`runAdd` 流程:`!source || !agent` → usage 单行 exit 1;manifest 缺失/损坏 → 单行 exit 1;`!manifest.agents[agent]` → `agent "<name>" is not declared in decklist.json — declare it first` exit 1(**引擎调用前**);透传冲突同 Task 2;装(manifest 声明的 harness、cwd=agentDir、先 mkdir);成功后:lock 读取 try/catch(在 manifest 写之前,C1 原子性)→ 原始 doc JSON.parse 保留一切字段,`doc.agents[agent].skills[key] = 简写或对象`(同 v0 规则:无 skill 且无 pin → 字符串)→ 写 manifest → `upsertEntry(lock, "<agent>/<key>", …)` → 写锁 → `added <agent>/<key> (<source>)`;`key = skill ?? basename(source) 去 .git`。

- [ ] **Step 1: RED — 重写 `tests/add.test.js`**:成功(dev agent,manifest 增 `agents.dev.skills.r`,lock 键 `dev/r`,engine 收到 harness);skill/pin 对象形式;名字派生;未声明 agent → **0 调用** exit 1;`--agent` 缺失 → usage exit 1;corrupt lock → manifest 字节不动;engine 失败 → 零写入;透传 `-a` → 0 调用 exit 1。`tests/cli.test.js` 改 `buildCall` add 断言(含 agent)与 `--help` 文案断言(install/add/list 仍在)。Run → FAIL。
- [ ] **Step 2: 实现** `src/commands/add.js`、`bin/decklist.js`(buildCall、USAGE)。Run → PASS。
- [ ] **Step 3: Commit** `git add src/commands/add.js bin/decklist.js tests/add.test.js tests/cli.test.js && git commit -m "feat(add): --agent required, installs into declared agent dir; usage v2"`

---

### Task 4: list v2

**Files:**
- Modify: `src/commands/list.js`
- Rewrite: `tests/list.test.js`

**Interfaces:**
- Consumes: Task 1/2 形态与 helper。
- Produces: `runList({cwd, engine, out})`:manifest/lock 读取包裹同 v0;**不 mkdir**;逐 agent `installed = engine.installed({cwd: agentDir})`(目录不存在 → 引擎 ENOENT → 空 Map,天然 missing);行:`<agent> installed|missing|drifted <key>`(规则同 install:pin 匹配需已装,否则 missing;pinned absent 报 missing);undeclared:该 agent installed 键 ∉ 其 skills 且 ∉ 该 agent 的 selectors → `<agent> undeclared <name>`;exit 0/1 同 v0。

- [ ] **Step 1: RED — 重写 `tests/list.test.js`**:四状态 × agent 前缀;**RF2** selector(`installed pw`、无 `undeclared playwright`);pinned absent → `missing`;双 agent 分组互不串;无 manifest exit 1。Run → FAIL。
- [ ] **Step 2: 实现**。Run → PASS。
- [ ] **Step 3: Commit** `git add src/commands/list.js tests/list.test.js && git commit -m "feat(list): per-agent grouped report"`

---

### Task 5: schema + README + docs 断言

**Files:**
- Rewrite: `schema/decklist.schema.json`、`README.md`、`tests/docs.test.js`

**Interfaces:**
- schema:顶层 `properties` = `$schema,name,version,description,private,license,author,agents`,`required:["agents"]`,`additionalProperties:false`;`agents.additionalProperties` = agent 模式 `{harness:string minLength1, persona:string maxLength 2000, skills:{…v0 条目 oneOf…}}`,`required:["harness","skills"]`,`additionalProperties:false`。
- README 必含:新定位一句话、含基础字段+双 agent 的 manifest 示例、persona ≤2000 只定义不消费、`agents/` 建议进 `.gitignore`、命令表(install/add `--agent`/list)、透传 `-a` 冲突说明、lock 键格式、`node --test`。

- [ ] **Step 1: RED — 重写 `tests/docs.test.js`**:schema 断言(agents 必填、persona maxLength 2000、harness minLength 1、additionalProperties false);README includes 列表(`"agents"`、`"harness"`、`"persona"`、`"--agent"`、`"decklist install"`、`"node --test"`),并断言不含旧顶层示例误导串(如 `"skills": {` 出现在顶层示例位置 —— 用 `'"agents": {'` 存在性与 `gitignore` 提示断言替代,不强做反断言)。Run → FAIL。
- [ ] **Step 2: 重写 schema 与 README**。Run → PASS。
- [ ] **Step 3: Commit** `git add schema/decklist.schema.json README.md tests/docs.test.js && git commit -m "docs: v2 schema and README — multi-agent environment definition"`

---

### Task 6: 集成测试(双 agent 同 harness)+ 收敛

**Files:**
- Rewrite: `tests/integration.test.js`

**Interfaces:**
- Consumes: 全部。真实引擎,`npx -y skills --help` 守卫沿 v0;**PASSTHROUGH 常量删除**(harness 已声明,不再传 `-a`)。

- [ ] **Step 1: RED — 重写用例**:①`runAdd`(dev/claude-code,本地 fixture)→ `agents/dev/.claude/skills/myutil/SKILL.md` 存在、manifest/lock 落盘;②manifest 手工加第二 agent `test`(同 harness claude-code、同 skill 源)→ `runInstall` → 两目录各自存在 myutil、engine 锁各自出现在自己目录;③二次 install → 0 引擎调用;④删 decklist.lock → ≥1 调用;⑤`runList` → `dev installed myutil` 且 `test installed myutil`;⑥ghost 注入 dev 的 engine 锁 → `dev undeclared ghost`。Run → FAIL(旧文件是 v0 场景)。
- [ ] **Step 2: 跑通** `node --test tests/integration.test.js` → PASS;随后**全套** `npm test` → 全绿(预计 ~80)。若 v0 遗留断言仍有红,此处收敛完再提交。
- [ ] **Step 3: Commit** `git add tests/integration.test.js && git commit -m "test: dual-agent same-harness isolation against the real engine; suite green"`

---

## Post-plan(人工步骤,不属本计划)

- npm 登录与发布(与 v2 无耦合,发布内容即 v2 后的 0.1.0)。
- supervibe bootstrap 改用 v2 manifest 形态(v0 spec Q4,时点不变)。

## Self-Review 记录

- 覆盖:spec §3→T1、§4/§6.1→T2、§6.2→T3、§6.3→T4、§7 schema/README→T5、§9→T2-T6、§12→T6;§8 错误表逐行分布在 T1-T3 用例。无缺口。
- 类型一致:`lockKey`/`agentDir`/`agentFlagConflict`/`PERSONA_MAX` 各任务引用与定义处一致;`dropStale` Set 形态在 T2 定义、T2 内自用。
- Task 2 Step 5 的"主干允许暂红"是本计划唯一显式自由度,已给默认路径与替代路径。
