# decklist v2 — 声明式多 agent 环境定义(spec)

日期:2026-10-09
状态:待评审
取代:`2026-10-04-decklist-design.md` 的 §3(manifest)、§4(skill 归属)、§5(命令)与 ADR D6;该文其余部分(引擎边界、锁契约、测试策略)继续有效。

## 1. 定位

decklist 从"skill 依赖管理器"升级为**声明式多 agent 环境定义**:manifest 声明一组命名 agent,每个 agent = 独立目录 + harness + persona + skills。类比:docker-compose 之于服务,decklist 之于 agent。

一条命令(`decklist install`)把所有 agent 的 skill 装齐。引擎仍为 Vercel `skills` CLI(v0 的适配器架构不变)。

## 2. 非目标

- **不定义使用方式**:怎么启动 agent、persona 如何被各 harness 消费,一概不在范围内。不同 harness 对 persona 的载体各不相同,decklist 只存储与校验,不翻译、不落盘 persona。
- 不管理 agent 目录内的其他文件(引擎边界与 v0 相同:decklist 只 `mkdir` agent 目录,装东西永远由引擎做)。
- 不做 harness 清单校验(见 D13)。

## 3. Manifest:`decklist.json`

### 3.1 顶层基础字段(参考 npm package.json)

| 字段 | 类型 | 校验 | 说明 |
|---|---|---|---|
| `$schema` | string | 无 | JSON Schema URL,可选 |
| `name` | string | npm 名模式 `^[a-z0-9-~][a-z0-9-._~]*$` | 可选,项目名 |
| `version` | string | semver(`x.y.z`) | 可选,定义版本 |
| `description` | string | 非空 | 可选 |
| `private` | boolean | — | 可选,语义提示(见 §8 注) |
| `license` | string | 非空 | 可选,SPDX 建议,不做库级校验 |
| `author` | string | 非空 | 可选,自由文本 |
| `agents` | object | 见 3.2 | **必填**,可为空对象 `{}` |

未列出的顶层键 → `ManifestError`(沿用 v0 严格模式)。所有基础字段均可选;`agents` 必填。

### 3.2 agent 条目

```json
{
  "agents": {
    "dev": {
      "harness": "claude-code",
      "persona": "你是一个严谨的开发者…",
      "skills": {
        "superpowers": "obra/superpowers",
        "pw": { "source": "microsoft/playwright-cli", "skill": "playwright", "pin": "v1.2.0" }
      }
    }
  }
}
```

- **agent 名**(键):`/^[A-Za-z0-9][A-Za-z0-9._-]*$/` —— 安全目录段,拒绝穿越(`.`、`..`、含 `/` 均不合法)。
- **`harness`**:必填,非空字符串。**不做清单校验**——写错由引擎报错原样透传(引擎认识 ~75 种 harness,名单随上游演进,焊死会漂移)。
- **`persona`**:可选,内联文本,**长度 ≤ `PERSONA_MAX = 2000` 字符**,超出 → `ManifestError`。仅存储与校验。
- **`skills`**:必填(可为空对象——纯 persona 型 agent 合法)。每项沿用 v0 形态与校验:字符串简写(source)或对象 `{source, skill?, pin?}`;`pin` 仅配合 `owner/repo` 简称;`skill` 选择器语义、README 命名约定(C3 修复后的 probe 规则)不变。
- agent 对象 `additionalProperties: false`;未知键 → 报错。

### 3.3 移除 v0 顶层 `skills`

0.1.0 从未发布,无兼容负担。skill 必须挂在 agent 下;解析器遇顶层 `skills` → `ManifestError`,错误信息指引迁移("skills 必须声明在某个 agent 之下")。

## 4. 目录模型

- 每个命名 agent 对应项目根下 `agents/<name>/`。install 前 decklist 递归 `mkdir`(decklist 对文件系统的唯一写入之一,另一个是 `decklist.lock`)。
- 引擎以 `cwd = agents/<name>/` 运行,argv 携带 `-a <harness>`:harness 的固定落点(如 `.claude/skills/`)自然落在 agent 目录内——**独立目录即隔离**,多个 agent 同 harness 互不干扰;引擎自己的 `skills-lock.json` 也自动 per-agent。
- 目录名固定 `agents/`(常量,不配置)。`agents/` 目录本身建议用户加入 `.gitignore`(README 说明);decklist 不代写 `.gitignore`。

## 5. Lockfile:`decklist.lock`

- 全局一份,形状沿用 v0(`decklistVersion` / `engine` / `entries`)。
- **条目键:`"<agent>/<skill 名>"`**(如 `"dev/superpowers"`),entry 形状不变:`{source, resolved?}`。
- 锁优先级、pin/hash 语义、漂移警告、C2(skip 必须查已装状态)与 C3(按 `dep.skill ?? name` 探测身份)的规则全部按 agent 作用域套用。
- `dropStale`:manifest 中不存在的 `<agent>/<skill>` 键逐条删除;agent 整体移除 → 其全部键删除。
- 引擎锁(`skills-lock.json`)按 agent 目录自然分文件,读取时以对应 agent 目录为 cwd,decklist 永不写它(D8 不变)。

## 6. 命令

### 6.1 `decklist install [-- <engine flags>]`

逐 agent(按 manifest 声明顺序):

1. `mkdir -p agents/<name>`;
2. 以该目录读引擎已装状态;
3. 逐 skill 判定:skip(`ok`)/ 漂移警告(`drifted <n>: locked <old>, now <new>`)/ 安装(`installed`)/ 失败(`failed <n>: <msg>`,不断全局)。

汇总行 `N installed, M skipped, K failed`,exit code 规则同 v0。输出行前缀 agent 名:`<agent> installed <skill>`、`<agent> ok <skill>` 等,agent 间空行分隔。

**透传冲突**:harness 已由 manifest 声明,`--` 透传中出现 `-a`/`--agent`(含 `-a=<x>`、`--agent=<x>` 等值形式)→ 启动即报错、退出 1,错误信息说明 harness 由声明决定。其余引擎旗标照常透传。

### 6.2 `decklist add <source> --agent <name> [--skill <s>] [--pin <v>]`

- `--agent` 必填,且该 agent 必须已在 manifest 声明(未声明 → 报错并提示先编辑 decklist.json;YAGNI:不做隐式创建)。
- 装入该 agent 目录(harness 取声明值),成功后写 manifest(`agents.<name>.skills.<key>`)与 lock(`"<agent>/<key>"`);失败不落任何写(原子性沿 v0)。
- `--skill`/`--pin` 语义同 v0。

### 6.3 `decklist list`

按 agent 分组报告:`<agent> installed|missing|drifted <skill>`,组内 undeclared 行 `<agent> undeclared <name>`。exit 0(报告不是门),manifest 缺失/损坏 exit 1 同 v0。

## 7. 架构与模块变更

| 模块 | 变更 |
|---|---|
| `src/manifest.js` | 解析 v2 模型(基础字段 + agents);新校验(agent 名、harness 非空、persona ≤2000);顶层 `skills` 拒绝 |
| `src/lockfile.js` | 不变(键格式是调用方约定) |
| `src/engine.js` | 不变(argv 构造、spawn、installed 读取已参数化 cwd) |
| `src/commands/install.js` | agent 循环 + 目录 mkdir + 每 agent 的 installed 读取 + 行前缀 |
| `src/commands/add.js` | `--agent` 必填校验、目标目录与 lock 键 |
| `src/commands/list.js` | 分组输出 |
| `bin/decklist.js` | `buildCall` 增加 agent 旗标;透传 `-a` 冲突检测放 install/add 入口 |
| `schema/decklist.schema.json` | 重写为 v2 |
| `README.md` | 重写定位与示例 |

零运行时依赖、ESM、Node ≥ 20、2 空格 + 换行写盘、`npm test` = `node --test` 等 v0 全局约束不变。

## 8. 错误表(新增部分)

| 场景 | 行为 |
|---|---|
| 顶层 `skills` | 一行错误,指引"skills 挂 agent",exit 1 |
| agent 名不合法 / 穿越段 | `<file>: agents.<name>: invalid agent name`,exit 1 |
| `harness` 缺失或空串 | `<file>: agents.<name>.harness: required non-empty`,exit 1 |
| persona 超 2000 字符 | `<file>: agents.<name>.persona: exceeds 2000 characters`,exit 1 |
| 基础字段类型/模式不符 | `<file>: <field>: <reason>`,exit 1 |
| `add` 未指定 `--agent` | usage 提示,exit 1 |
| `add` 指向未声明 agent | 一行错误 + "先在 decklist.json 声明该 agent",exit 1 |
| 透传含 `-a`/`--agent` | 一行错误(harness 由声明决定),exit 1,装前即失败 |
| harness 引擎不认识 | 引擎错误原样透传(`failed …`),不翻译 |

注:`private` 仅作声明语义(如"此环境定义不对外分享"),v2 无发布机制消费它。

## 9. 测试策略

- v0 的 64 个用例中:manifest/install/add/list 相关按 v2 改写(engine 9 个、lockfile 4 个、cli 中 buildCall/handleRejection 断言调整);集成测试 fixture 改为双 agent 场景。
- 新增用例:基础字段校验通过/拒绝;顶层 skills 拒绝;agent 名穿越拒绝;persona 边界(2000 通过/2001 拒绝/缺省合法);纯 persona(空 skills)合法;双 agent 同 harness 目录隔离(`agents/dev/.claude` 与 `agents/test/.claude` 各自独立);同名 skill 双 agent 各自安装;透传 `-a` 冲突报错;add 未声明 agent 报错;lock 键 `agent/skill` 与 dropStale 前缀清理。
- README/schema 断言测试(docs.test.js)随重写更新。

## 10. ADR

- **D9(取代 D6):agent 进声明。** v0 认为agent 选择是运行时透传;实践需求是多 agent 环境需要按 agent 组织 skill 与 persona。运行时透传保留,但 `-a` 让位给声明。
- **D10:persona 只定义,不消费。** 内联文本 + 长度上限;任何 harness 侧翻译(写 CLAUDE.md 等)都超出边界,留给使用方。
- **D11:per-agent 目录 = 引擎 cwd。** 隔离不靠 decklist 认识 harness 目录结构,而靠把引擎放进每个 agent 目录。decklist 对目录系统只做 `mkdir`。
- **D12:manifest 基础字段借 npm package.json 惯例。** name/version/description/private/license/author,全部可选、轻校验——降低理解成本,不复制 npm 的发布语义。
- **D13:不做 harness 清单校验。** 名单归引擎/上游,decklist 校验非空即可;写错在安装时以引擎错误呈现。
- **D14:对 v0 顶层 `skills` 干净断裂。** 未发布,无兼容负担;解析层直接拒绝并指引迁移。

## 11. 开放问题

无。(supervibe bootstrap 沿用 v0 spec Q4,改为 v2 manifest 形态,时点仍在 npm 发布后。)

## 12. v2 DoD

1. `npm test` 全绿(改写 + 新增用例,预计 ~80);
2. `node bin/decklist.js install` 在含双 agent(同 harness)的 fixture 项目上:两目录各自落 `.claude/skills`,二次运行全 skip;
3. schema 校验器接受本文全部示例、拒绝错误表全部场景;
4. README 重写且 docs 断言过;版本仍 0.1.0。
