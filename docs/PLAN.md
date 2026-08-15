# MiOpIIk 计划树 — OMP 工作流迁移到 DSH

> 本文件是本计划树的**第一层**，也是整个项目的单一事实来源（对应 OMP 的 `local://PLAN.md` 语义：计划即执行规格、零设计决策交接）。
> 任何新会话（含未来执行层 subagent）只需读本文件即可无损理解项目状态。

## 1. 项目定位

把 oh-my-pi（OMP，can1357 的终端编程代理）的工作流思想、loop 逻辑与记忆体系迁移到 DeepSeek Harness（DSH，"一切皆插件"的 Cordis 框架），并融入用户（chillizu）自己的改进：三层 + 监督层工作流、固定通信协议、分级记忆、恢复工具包、魔法关键词。

## 2. 已确认决策（D1–D29）

| # | 决策 | 详情文档 |
|---|---|---|
| D1 | 总体架构 = 三层 + 监督层（审查层 / 规划层 / 执行层 / 监督层） | [architecture-3-layer](docs/design/architecture-3-layer.md) |
| D2 | 审查层 = 根会话，用户 preset `miopiik`（从 standard copy，persona 行 = 审查层 prompt 全文），直接对话用户 | 同上 |
| D3 | 规划层 = continuable 后台子代理，由 `subagent_planner` 工具行派发（config.persona = 规划层 prompt 全文 + toolFilter deny 用户直连/ralph/goal/web 工具） | 同上 |
| D4 | 执行层 = one-shot 子代理，`subagent_executor` 工具行（persona + toolFilter allow 最小集，无 subagent/workflow 工具） | 同上 |
| D5 | 监督层 = continuable 子代理，`subagent_supervisor` 工具行（persona + 只读 toolFilter），默认拓扑为**规划层的子**；沉默即通过 | 同上 + [通信协议](docs/design/communication-protocol.md) |
| D6 | 人格映射：全层用 OMP `default.md`（证据优先）；审查层叠加 `pragmatic.md`；弃用 `friendly.md` | [architecture-3-layer](docs/design/architecture-3-layer.md) |
| D7 | 通信走 DSH 树形原语：`send_message`（父→子）、`report`（子→父）；无兄弟直连（无 OMP 式 IRC） | [通信协议](docs/design/communication-protocol.md) |
| D8 | 执行层任务模板 = 用户实战的 `# Target / # Change / # Acceptance` 三段式 | [task-template](docs/design/templates/task-template.md) |
| D9 | 监督报告 = `[EXEC]` 五字段（目标/做了什么/进展/交付物/下一步）；监督层默认不回复，仅偏离时 report concern | [report-template](docs/design/templates/report-template.md) |
| D10 | 监督层可知性三通道：定期报告推送 + session_query 读日志 + `.dsh/progress/current.md` 落盘事实 | [通信协议](docs/design/communication-protocol.md) |
| D11 | Subagent 授权闸：派发默认经用户确认，可放行，可场景级禁停（评测场景禁 subagent） | [architecture-3-layer](docs/design/architecture-3-layer.md) |
| D12 | 记忆三级：全局记忆（用户偏好/系统信息/系统级改动）、项目记忆（进展/思路/长期需求）、recall（= DSH session_search 家族）；一期零新工具 | [memory-design](docs/design/memory-design.md) |
| D13 | 恢复工具包：`/retry`、请求级自动重试策略、`checkpoint`、`rewind`（fork 无损回溯）、规则注入 | [recovery-toolkit](docs/design/recovery-toolkit.md) |
| D14 | 恢复工具与会话管理（fork/rewind）UI 落位：Web GUI「轨迹」页面 | 同上 |
| D15 | 魔法关键词：hook 检测 **ultrathink / workflowz**（正文散文）注入 notice；**orchestrate** 为规划层 persona 常驻契约段落（非 hook 触发） | [magic-keywords](docs/design/magic-keywords.md) |
| D16 | 验收纪律：预注册 PASS/KILL/NULL 量化门、契约先行（冻结契约 + golden fixtures）、归因分层 + 复算对账、独立验证 subagent | [architecture-3-layer](docs/design/architecture-3-layer.md) |
| D17 | 保留"上游模型当最终裁判"的中介报告模式（审查层产出结构化 md 报告供转交） | [report-template](docs/design/templates/report-template.md) |
| D18 | 补可观测性：agent 墙钟 / token / 工具调用统计（session-telemetry seam 上的 run-stats 插件），回应 DSH-test 评测硬缺口 | [recovery-toolkit](docs/design/recovery-toolkit.md) |
| D19 | 模型路由（**待验证假设**）：审查/规划强模型、执行/监督廉价模型——沿用 OMP 直觉，但漏报率/rewind 率无量化门；降级为待验证，预注册实验见 [model-routing-experiment](docs/design/model-routing-experiment.md) | [architecture-3-layer](docs/design/architecture-3-layer.md) |
| D20 | 后台任务对齐 DSH jobs（job_list/output/kill + run_in_background）；长任务强制详细日志 + 结束 flag + ETA | [architecture-3-layer](docs/design/architecture-3-layer.md) |
| D21 | 计划树工作流：大项目先建树（第一层计划 / 第二层文档参考+对话记录简述 / 第三层设计细则），本树即约定实例 | [plan-tree-workflow](docs/design/plan-tree-workflow.md) |
| D22 | 简洁原则：后期插件实现时，提示词（特别是提示词）与代码必须保持简洁——只给事实与验收，不给方法说教 | 全树适用 + [lsp-extension](docs/design/lsp-extension.md) §6 |
| D23 | 动态 LSP（可选 S9）：在 DSH 既有 lsp seam 上扩展操作（一期 diagnostics+rename），按项目语言动态发现 server | [lsp-extension](docs/design/lsp-extension.md) |
| D24 | 规划层上下文管理：长命会话挂 DSH 自动压缩（阈值触发 + 工具结果剪枝）；规划层可**自主 compact**（状态折叠：写 [EXEC] 汇总 + 项目记忆落盘 → handoff 新会话续跑）；WATCHDOG 式落盘笔记对抗压缩丢失 | [architecture-3-layer](docs/design/architecture-3-layer.md) §7 |
| D25 | 落地形态（DSH 机制约束）：**单 preset `miopiik` + 三个 delegation 工具行**；子代理加入父级 preset（无 per-child preset 参数），per-child 角色 = 工具行 config 的 persona 覆盖（shadow `deployment:persona`）+ toolFilter allow/deny；四个 prompt 全文定稿于 presets 目录并嵌入 miopiik 组合 | [architecture-3-layer](docs/design/architecture-3-layer.md) §8 |
| D26 | 命名约定：MiOpIIk 自建包用 `@chillizu/mop-<domain>-<feature>`（mop = MiOpIIk 域，对应 DSH 的 dsh-）；插件 name = `mop-<domain>-<feature>`；模型工具名 = `mop_<verb>`（下划线）；组合行 id 与插件 name 一致 | 全树适用 |
| D27 | 能力探测（类型：实现；状态：已落地；证据：单测）——`mop-capabilities` 启动/按需探测 DSH seam 可用性（sessions/sessionPersistence/sessionQuery/systemPrompt/sandboxPolicy），写 `.dsh/memory/capabilities.md` 能力清单，防上游漂移（U2 教训） | [capabilities](docs/design/capabilities.md) |
| D28 | 审查层监督模型（类型：监督模型；状态：已落文档；证据：设计推定）——**用户即顶层监督者**（D2 显式化）；审查层里程碑后自 checkpoint（`mop_checkpoint` 默认打调用者）；审查层单点从结构缺陷降为可恢复薄弱环节 | [architecture-3-layer](docs/design/architecture-3-layer.md) §2 |
| D29 | D19 模型路由实验（类型：实验；状态：待验证；证据：预注册骨架）——对比强/弱执行层模型在固定任务集上的 rewind 率 + 弱监督层漏报率，量化门见 [model-routing-experiment](docs/design/model-routing-experiment.md) | [model-routing-experiment](docs/design/model-routing-experiment.md) |

## 3. 计划树索引

| 层级 | 文件 | 职责 |
|---|---|---|
| 第一层 | [PLAN.md](PLAN.md) | 总计划树根：目标、决策、索引、待确认项 |
| 第二层·文档参考 | docs/research/*（omp-report / dsh-report / omp-vs-dsh） | 本地保留，不入库（OMP/DSH 调研） |
| 第二层·对话记录 | docs/profile/*（conversation-notes / user-preference-profile） | 本地保留，不入库（会话记录 + 用户画像） |
| 第三层·设计 | [docs/design/architecture-3-layer.md](docs/design/architecture-3-layer.md) | 三层+监督层架构细则 |
| 第三层·设计 | [docs/design/communication-protocol.md](docs/design/communication-protocol.md) | 通信拓扑与消息模板 |
| 第三层·设计 | [docs/design/memory-design.md](docs/design/memory-design.md) | 记忆分级 spec |
| 第三层·设计 | [docs/design/recovery-toolkit.md](docs/design/recovery-toolkit.md) | retry/checkpoint/rewind/规则注入 |
| 第三层·设计 | [docs/design/recovery-toolkit-impl.md](docs/design/recovery-toolkit-impl.md) | 恢复工具包实施契约（阶段二：现状核验 + 构建清单 + 验收门） || 第三层·设计 | [docs/design/magic-keywords.md](docs/design/magic-keywords.md) | 三魔法关键词映射与 hook 设计 |
| 第三层·预设 | [docs/design/presets/review.md](docs/design/presets/review.md) | 审查层 preset 骨架 |
| 第三层·预设 | [docs/design/presets/planner.md](docs/design/presets/planner.md) | 规划层 preset 骨架 |
| 第三层·预设 | [docs/design/presets/executor.md](docs/design/presets/executor.md) | 执行层 preset 骨架 |
| 第三层·预设 | [docs/design/presets/supervisor.md](docs/design/presets/supervisor.md) | 监督层 preset 骨架 |
| 第三层·模板 | [docs/design/templates/task-template.md](docs/design/templates/task-template.md) | 执行层任务模板（三段式） |
| 第三层·模板 | [docs/design/templates/report-template.md](docs/design/templates/report-template.md) | 工作报告模板（[EXEC]）+ P0–P3 验收格式 |
| 第三层·约定 | [docs/design/plan-tree-workflow.md](docs/design/plan-tree-workflow.md) | 计划树工作流约定（本树自身的元规则） |
| 第三层·设计 | [docs/design/lsp-extension.md](docs/design/lsp-extension.md) | 动态 LSP 扩展设计（可选 S9） |
| 第三层·设计 | [docs/design/capabilities.md](docs/design/capabilities.md) | 能力探测设计（D27：seam 可用性清单，防上游漂移） |
| 第三层·设计 | [docs/design/model-routing-experiment.md](docs/design/model-routing-experiment.md) | 模型路由实验骨架（D29：D19 待验证假设的预注册实验） |
| 第三层·规程 | [docs/design/phase1-runbook.md](docs/design/phase1-runbook.md) | 阶段一验收规程：四层跑通 + U2 spike（实施阶段用） |
| 第三层·审查 | [docs/review/completeness-omp-diff.md](docs/review/completeness-omp-diff.md) | 迁移完整性审查 + 相对 OMP 差别（阶段二后） |

## 4. 待确认项（U1–U3）

| # | 待确认 | 默认方案 |
|---|---|---|
| U1 | 监督层拓扑 | 规划层的 continuable 子（send_message/report 原生双向）；备选：审查层的子（需转发，不推荐） |
| U2 | spike：子代理能否用 session_query 读父会话日志（授权规则实测） | 已实测（2026-08-14，见 [runbook §5.1](docs/design/phase1-runbook.md#51-实测记录2026-08-14阶段一验收样例判定--中间档)）：session_search/session_event_search 在本部署被整体禁用（部署级配置，非授权规则），progress 文件可读 → 监督层用「报告推送 + 落盘事实」两通道（备选方案，成立） |
| U3 | 授权闸实现方式 | 一期 prompt 规则（派发前确认）；二期评估接 DSH 审批 seam |

## 5. 下一步（实施进度）

已完成：
1. **阶段一 preset+协议**：四 prompt 定稿、miopiik 组合、四层端到端跑通（A1–A4/A6 PASS，A5 中间档）✓
2. **阶段二恢复工具包**（D13/D14）：checkpoint / rewind（fork 无损，含冷会话）/ 规则注入 / 自动重试（原生）/ run-stats（原生）——已固化为 `@chillizu/mop-tool-recovery` 入 miopiik ✓
3. **记忆细化**（D12）：全局记忆 `~/.dsh/memory/global/` + persona 注入 + recall 全文搜索启用（profile patch，重启生效）✓
4. **魔法关键词 hook**（D15）：`@chillizu/mop-magic-keywords` 入 miopiik，正文检测 ultrathink/workflowz → notice 注入 ✓
5. **命名约定**（D26）：`@chillizu/mop-<domain>-<feature>` / `mop_<verb>` ✓
6. **能力探测**（D27）：`@chillizu/mop-capabilities` 探测 seam 可用性 → `.dsh/memory/capabilities.md` ✓
7. **审查层监督模型**（D28）：用户即顶层监督者 + 审查层自 checkpoint（写入 persona + architecture §2）✓

待办（用户门控，需重启/实测）：
- recall 全文搜索**重启 dsh web 后验证**（session_search/session_trace 可用）；
- 冷会话 rewind **实测**（需真实 settle 的冷规划层会话）；
- D29 模型路由实验（D19 待验证假设）：跑预注册实验 → 回写 D19 状态；
- 语义检索（bge-m3 嵌入）弃用。

## 6. 维护规则

- 本文件是单源事实；任何设计变更先改本文件对应决策行，再改详情文档；
- 会话发现的新偏好/教训 → 更新 [user-preference-profile](docs/profile/user-preference-profile.md)，重要结论升级为 PLAN.md 决策；
- 所有文档遵循用户风格：直接、简洁、无 Emoji、证据优先。
