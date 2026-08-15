# mop-plugins

MiOpIIk 的 DeepSeek Harness 插件集。命名遵循 DSH 插件约定：包 `@chillizu/mop-<domain>-<feature>`、插件 name `mop-<domain>-<feature>`、模型工具 `mop_<verb>`（`mop` = MiOpIIk 域，对应 DSH 的 `dsh-`）。

## 插件

| 包                             | 域   | 工具/行为                                                                                                                                                   |
| ------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chillizu/mop-tool-recovery`  | tool | `mop_checkpoint`（记录目标会话 turn 边界 + git note）、`mop_rewind`（fork 到 checkpoint，含冷会话）、`mop_rule_inject` / `mop_rule_show`（TTSR 式规则注入） |
| `@chillizu/mop-magic-keywords` | hook | 正文检测 `ultrathink` / `workflowz`（排除 code fence/inline code）→ `form: notice` 上下文消息注入                                                           |

## 安装（agent preset 绝对路径行，免发布/pnpm）

1. 把包放到 `~/.dsh/profiles/`（其 `@deepseek-ai/dsh-*` 依赖靠 DSH 的 `~/.dsh/profiles/node_modules` 愈合 fallback 解析）；
2. 在 agent preset 的 `agent.cordis.yml` 加行（`name` 用绝对路径，loader 转 file URL）：

```yaml
# ── recovery tools ──
- id: mop-tool-recovery
  name: ${DSH_HOME}/profiles/mop-tool-recovery/index.js # 或 $HOME/.dsh/...（绝对路径）

# ── magic keywords ──
- id: mop-magic-keywords
  name: ${DSH_HOME}/profiles/mop-magic-keywords/index.js
```

3. `dsh` 重启后 `standingKeyFor` 挂载验证。

## 设计（计划树）

完整设计/决策见 [`docs/PLAN.md`](docs/PLAN.md)：三层+监督层工作流、固定通信协议、分级记忆、恢复工具包、魔法关键词，逐条带验收证据。

## 命名约定

`@chillizu/mop-<domain>-<feature>`；插件 `name` = `mop-<domain>-<feature>`；组合行 `id` 与插件 name 一致；模型工具 = `mop_<verb>`。
