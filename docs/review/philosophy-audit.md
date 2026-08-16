# 设计哲学全面体检（D1–D30）

> 上一级：[PLAN.md](../../PLAN.md)。本文件是整套设计哲学的**一致性 + 缺口**审计：决策状态、与早前 5 条批评的对照、本轮新发现的缺口。结论先行。

## 1. 决策状态总表

| 状态 | 决策 |
|---|---|
| 已落地（代码/实测） | D1–D13、D15、D20、D21、D25–D28、D30（除 D14/D23） |
| 已实测（弱判别） | D19（→ D29）、D29（24 run 全门 PASS 但判别力弱，见 §4 缺口 4） |
| 弃用/降级 | D14（UI 按钮方向，fork=新会话做不出就地回退）、D13 内 `/retry`（自动重试=原生） |
| 未做/可选 | D23（动态 LSP，S9 可选）、D18（run-stats 原生已覆盖，无自建） |
| 定性命中 | D16（预注册量化门多数决策未落数值，见 §3） |

## 2. 本轮修复的 drift（一致性伤）

| 处 | 问题 | 修复 |
|---|---|---|
| D25 | 仍写「三个 delegation 行」，实际已改「两行 + mop_spawn_executor」 | 改口径 |
| D4 | 写「mop_spawn_executor 工具行」，实为自定义工具（非 tool-subagent 行） | 改措辞 |
| D14 | 写「UI 落位轨迹页」，实际按钮方向已弃 | 标注已弃 |
| U2 | 写「session_search 部署禁用」，实际已启用全文搜索 | 更新为已启用 |
| 索引表 | recovery-toolkit-impl 与 magic-keywords 两行挤在一行（markdown 断行） | 拆行 |
| architecture §8 | yaml 代码块仍留 `tool-subagent-executor` delegation 行（D25 已改为 mop_spawn_executor 自定义工具）；且双树（workspace/repo）§1/§8 互相漂移 | 改「三 delegation 行」→「两行 + mop_spawn_executor」，删 executor 行，双树合并对齐 |

## 3. 早前 5 条批评的对照（哪些已补、哪些仍缝）

| 批评 | 状态 |
|---|---|
| 1. 上游平台漂移无防御 | **已补**（D27 能力探测） |
| 2. 审查层无监督单点 | **已补**（D28：用户即顶层监督者 + 自 checkpoint） |
| 3. 预注册验收门不对称 | **部分**：D13/D15/D27 有量化/单测，其余多定性；D16 适用范围未在 PLAN 显式划清 |
| 4. D19 模型路由零证据 | **已补**（D29 预注册实验，阈值已冻结） |
| 5. 单人带宽天花板（无人值守降级） | **设计已落、机制未实现**：D29 s1 切片已产出 offline-degradation.md（降级链/触发/恢复/验收门），未工程化 |

## 4. 本轮新发现缺口

1. **learn 机制缺失 → 已补**：D12 明确「learn（通用事实）vs skill（可复用流程）分流」，DSH 只有 skill 文件发现 + 加载，无结构化铸 skill 入口——已落地 `mop_learn`（写 `.dsh/skills/<name>/SKILL.md`，frontmatter name+description + body，19 单测过）。
2. **skill catalog 噪音 → 定性修正**：16 skill 中 14 个 AWS 系是**用户自己的全局库**（`~/.agents/skills/`，user-agents source），非 DSH 注入噪音；`disable-model-invocation` 只能全局、不能按 preset 隐藏——故瘦身 = 描述上限 500→100（`catalogDescriptionMaxLength: 100`，已落 miopiik tool-skill 行），AWS 库保留。
3. **模型授权闸缺失 → 已补（D30）**：模型路由落在「没额度/昂贵」provider（如 kimi 配额耗尽）时无闸拦截，subagent 静默失败——已落地 `mop-model-auth`（subagent 模型 ∈ 授权集 = 默认 ∪ allowlist，闸在 `agent/request` 全局 waterfall，覆盖原生 subagent/workflow/ralph/mop_spawn_executor/continuable 全部派发路径；`mop_model_authorize`/`mop_model_list` 管理，28 单测过）。
4. **监督层漏报水位（33%，超 20% 红线）→ 升 D31**：D29 §3.2 实测监督层对细微（涌现）缺陷漏报 33%（2/6，flash/pro 持平），超 D16 预注册 20% 红线——已升 D31 决策（接受为已知限制 + 双模型交叉监督列缓解候选，随 D29v2 验证），不再沉默留在报告附加观察。

## 5. 一句话结论

哲学骨架自洽且已从「文档成熟、代码滞后」追平到「代码与文档同频」；剩余一缝是**机制未实现**（离线降级设计已落 offline-degradation.md，但未工程化），留待真有无人值守场景再实现。另：D29 附带的监督层 33% 漏报已升 D31，不再留空档。
