# mop-plugins

MiOpIIk 的 DeepSeek Harness（DSH）插件集。

## 范围

本仓库只包含插件层：7 个 `mop-*` 插件包 + 测试 + 设计文档，不是可直接安装的完整发行包。文档描述的三层 + 监督层系统由两部分组成：

- **本仓库（插件层）**：7 个 `mop-*` 插件包 + 测试 + 设计文档。
- **MiOpIIk agent preset**：persona 与 Cordis 组合行（planner / executor / supervisor 工具编排），位于本机 `${DSH_HOME}/.agent-presets/miopiik/`（`agent.cordis.yml` + `preset.yml`），不在本仓库。脱敏可重建模板见 [`examples/miopiik/`](examples/miopiik/)（无凭据/allowlist/用户路径）；定稿 persona 的 draft 源在 [`docs/design/presets/drafts/`](docs/design/presets/drafts/)（`executor.prompt.md` 逐字同步进 `mop-executor` 的 `EXECUTOR_PERSONA`，其余 persona 由 `persona-sync` 测试与 `examples/miopiik` 副本保持一致）。

仅凭本仓库无法重建完整系统：它是可安装的插件层，需叠加 preset 才是完整 MiOpIIk。插件层与本机 preset 的关系见[安装](#安装)。DSH 兼容矩阵见 [`docs/design/dsh-compat.md`](docs/design/dsh-compat.md)。

## 插件清单（7 包）

| 包                             | 类型   | 工具 / 行为                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chillizu/mop-tool-recovery`  | 恢复   | `mop_checkpoint`（记录目标会话 turn 边界 + git note）、`mop_rewind`（fork 到 checkpoint，含冷会话）、`mop_checkpoint_list`、`mop_checkpoint_prune`（按 `keep` 裁剪，dry-run 默认，`keep=0` 高风险）、`mop_rule_inject` / `mop_rule_show` / `mop_rule_clear`（会话级硬规则注入） |
| `@chillizu/mop-executor`       | 执行   | `mop_spawn_executor`（一次性执行层子代理，逐次指定 model/provider/`timeoutMs` 硬超时；Config: `provider`/`model`/`maxOutputChars`，默认 flash）                                                                                                                                 |
| `@chillizu/mop-magic-keywords` | hook   | 正文检测 `ultrathink` / `workflowz`（排除 code fence / inline code）→ `form: notice` 上下文消息注入（Config: `notices` dict）                                                                                                                                                   |
| `@chillizu/mop-model-auth`     | 授权闸 | `mop_model_authorize` / `mop_model_revoke` / `mop_model_list` + `agent/request` 硬闸（Config: `allowlistPath`）                                                                                                                                                                 |
| `@chillizu/mop-capabilities`   | 探测   | `mop_probe_capabilities`（探测 DSH seam 可用性 → `.dsh/memory/capabilities.md` 能力清单，防上游漂移）                                                                                                                                                                           |
| `@chillizu/mop-learn`          | 学习   | `mop_learn`（把可复用流程铸成 `.dsh/skills/<name>/SKILL.md`，被 skill-filesystem 发现）、`mop_learn_list`（只读枚举已铸 skill 名称）                                                                                                                                            |
| `@chillizu/mop-run-stats`      | 遥测   | `mop_run_stats`（D18 可编程 token 出口：读 session 累计四桶 uncached/cacheRead/cacheWrite/output，不计算价格/成本）                                                                                                                                                             |

## 工具安全行为与限制

- `mop_spawn_executor` `timeoutMs`：可选（毫秒），缺省无超时、行为不变。超时经 AbortController 中止子代理并返回 `[aborted] executor timed out after {N}ms`（末尾仍带 `[executor-session: {id}]`）。限制：仅 per-call 参数，无 Config 级默认；不调用 `run.dispose()`，进程内资源清理仍归 provider/tool 层。
- `mop_model_revoke`：从全局 allowlist 移除 `provider/model`，与 `mop_model_authorize` 对称；拒绝撤销当前默认模型（隐式授权、不在 allowlist），对不存在项幂等返回。限制：全量重写经进程内 `withAuthLock` 串行化，跨进程并发 revoke+authorize 存在丢行窗口（文档化接受，属低频运维操作）。
- `mop_learn_list`：只读枚举 `.dsh/skills/` 下实际含 `SKILL.md` 的 skill 名称（排序），空/目录不存在返回 `(no skills)`。限制：不读内容、不读 frontmatter description、不写任何文件。
- `mop_checkpoint_prune`：`keep` 必填（非负整数）；`confirm` 必须为布尔，仅严格 `true` 才写，缺省/false 一律 dry-run（返回将删数量与 label 清单）。只删 `parseCheckpointLine` 能识别的现行行，注释/空行/旧格式行/普通文本原位保留。`keep=0` 清空全部现行行，高风险、仍需 `confirm:true`。限制：旧格式行永不裁剪；不生成备份文件。

## 安装

推荐用 DSH bundle 方式安装（每包已声明 `dsh.bundle.patch`）。在 mop-plugins 仓库根执行：

```bash
dsh plugin --profile web add \
  link:./packages/mop-tool-recovery \
  link:./packages/mop-executor \
  link:./packages/mop-magic-keywords \
  link:./packages/mop-model-auth \
  link:./packages/mop-capabilities \
  link:./packages/mop-learn \
  link:./packages/mop-run-stats
```

`dsh plugin add` 把声明了 `dsh.bundle` 的依赖自动并入 profile 的 `dsh.profile.bundles` 列表；`dsh` 重启后 `standingKeyFor` 挂载验证。

免发布/pnpm 的等价做法：把包放到 `~/.dsh/profiles/mop-*`，在 `~/.dsh/profiles/node_modules/@chillizu/` 建 symlink 指向对应目录（`ln -sfn ~/.dsh/profiles/mop-<feature> ~/.dsh/profiles/node_modules/@chillizu/mop-<feature>`），preset 行写裸包名 `@chillizu/mop-<feature>`——这样 Web UI 插件列表显示的是包名而非文件路径（`@deepseek-ai/dsh-*` 依赖同样靠 `~/.dsh/profiles/node_modules` 的 fallback 解析）。两种方式都可用；bundle 方式可被 `dsh plugin list/remove` 管理。

### 给 Agent 的一键安装提示词

把下面这段原样复制给另一个 Agent（或你自己的新会话），让它按 README 的安装章节执行。提示词要求它先逐项取得你的确认再动手、装完做只读验证、失败原样上报，不含自创命令。

```text
你是安装助手。目标：把公开仓库 Chillizu/mop-plugins（DeepSeek Harness 插件集）安装到用户的 DeepSeek Harness。

0. 事实源：先读 https://github.com/Chillizu/mop-plugins 或
   https://raw.githubusercontent.com/Chillizu/mop-plugins/main/README.md ，
   以 README 的「安装」章节为准，不要自创命令、不要臆造路径。

1. 安装前必须先逐项询问并取得用户明确确认；未获确认前，不得安装、写文件、
   安装依赖、修改 profile、重启服务或改动任何插件源码：
   - 是否授权安装本插件集（是/否）？
   - 目标 Harness 是哪个（web / headless / 其它）？对应 profile 名是什么？
   - 安装位置：把本仓库 clone/checkout 到哪个目录？该目录是否已存在？
   - 是否允许修改 profile 配置（`dsh plugin add` 会写 profile）？
   - 是否允许重启 Harness 服务以加载插件？

2. 收到用户对以上全部确认后，再按 README「安装」章节的
   `dsh plugin --profile <profile> add link:./packages/...` 逐个安装 7 个包；
   不要跳过、不要自造参数、不要改动包内文件。

3. 安装后验证（只读，不额外改动）：
   - 核对 7 个包已进入 profile（`dsh plugin list` 或 `dsh.profile.bundles`）。
   - 重启后确认插件实际加载：Web UI 设置→插件清单里出现 `mop-*`，或
     `standingKeyFor` 挂载成功。
   - 可选：在仓库根跑 `npm test` 验证本仓库测试；若缺 Node 依赖，先说明，
     不要擅自 `npm install`。
   - 任一环节失败：原样报告错误与已执行步骤，不要擅自多方案重试或改动其它插件。

4. 全程不修改模型选择/路由，不碰 preset/设计文档/契约/实验产物；不 commit、不 push。
```

## 设计（计划树）

完整设计/决策见 [`docs/PLAN.md`](docs/PLAN.md)：三层 + 监督层工作流、固定通信协议、分级记忆、恢复工具包、魔法关键词、模型授权闸，逐条带验收证据。

## 命名约定

- 包：`@chillizu/mop-<domain>-<feature>`（`mop` 是 MiOpIIk 的域前缀，类似 DSH 官方包的 `dsh-`）
- 插件 `name`：`mop-<domain>-<feature>`（组合行 `id` 与插件 name 一致）
- 工具：`mop_<verb>`，下划线小写动词（如 `mop_spawn_executor`、`mop_run_stats`），与 DSH 内置工具（`session_search`、`send_message` 等）的 snake_case 风格一致
- preset id：小写 `miopiik`
