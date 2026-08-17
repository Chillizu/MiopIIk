# mop-plugins

MiOpIIk 的 DeepSeek Harness（DSH）插件集。

命名遵循 DSH 约定：包 `@chillizu/mop-<domain>-<feature>`、插件 `name` = `mop-<domain>-<feature>`、模型工具 `mop_<verb>`。其中 `mop` = MiOpIIk 域（对应 DSH 自身的 `dsh-` 前缀），`<verb>` 用下划线小写（对应 DSH 的 `mop_spawn_executor` 式命名）。

## 插件清单（7 包）

| 包                             | 类型   | 工具 / 行为                                                                                                                                                                                            |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@chillizu/mop-tool-recovery`  | 恢复   | `mop_checkpoint`（记录目标会话 turn 边界 + git note）、`mop_rewind`（fork 到 checkpoint，含冷会话）、`mop_checkpoint_list`、`mop_rule_inject` / `mop_rule_show` / `mop_rule_clear`（会话级硬规则注入） |
| `@chillizu/mop-executor`       | 执行   | `mop_spawn_executor`（一次性执行层子代理，逐次指定 model/provider；Config: `provider`/`model`/`maxOutputChars`，默认 flash）                                                                           |
| `@chillizu/mop-magic-keywords` | hook   | 正文检测 `ultrathink` / `workflowz`（排除 code fence / inline code）→ `form: notice` 上下文消息注入（Config: `notices` dict）                                                                          |
| `@chillizu/mop-model-auth`     | 授权闸 | `mop_model_authorize` / `mop_model_list` + `agent/request` 硬闸（Config: `allowlistPath`）                                                                                                             |
| `@chillizu/mop-capabilities`   | 探测   | `mop_probe_capabilities`（探测 DSH seam 可用性 → `.dsh/memory/capabilities.md` 能力清单，防上游漂移）                                                                                                  |
| `@chillizu/mop-learn`          | 学习   | `mop_learn`（把可复用流程铸成 `.dsh/skills/<name>/SKILL.md`，被 skill-filesystem 发现）                                                                                                                |
| `@chillizu/mop-run-stats`      | 遥测   | `mop_run_stats`（D18 可编程 token 出口：读 session 累计四桶 uncached/cacheRead/cacheWrite/output，不计算价格/成本）                                                                                    |

## 安装

推荐 DSH bundle 姿势（每包已声明 `dsh.bundle.patch`）。在 mop-plugins 仓库根执行：

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

免发布/pnpm 的等价做法：把包放到 `~/.dsh/profiles/`，在 agent preset 的 `agent.cordis.yml` 加绝对路径行（`name` 用 `${DSH_HOME}/profiles/mop-<feature>/index.js`，loader 转 file URL）；`@deepseek-ai/dsh-*` 依赖靠 `~/.dsh/profiles/node_modules` 愈合 fallback 解析。两种姿势都可用，bundle 姿势可被 `dsh plugin list/remove` 管理。

## 设计（计划树）

完整设计/决策见 [`docs/PLAN.md`](docs/PLAN.md)：三层 + 监督层工作流、固定通信协议、分级记忆、恢复工具包、魔法关键词、模型授权闸，逐条带验收证据。

## 命名约定

- 包：`@chillizu/mop-<domain>-<feature>`
- 插件 `name`：`mop-<domain>-<feature>`（组合行 `id` 与插件 name 一致）
- 模型工具：`mop_<verb>`（下划线小写，如 `mop_spawn_executor` / `mop_run_stats`）
- 域缩写：`mop` = MiOpIIk；preset id 用小写 `miopiik`
