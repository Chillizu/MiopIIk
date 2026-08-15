# 阶段一 Runbook：preset + 协议跑通四层

> 上一级：[PLAN.md](../../PLAN.md)。对应决策 D25（落地形态）、U1（监督层拓扑）、U2（session_query 授权 spike）。本文是验收操作规程：事实 + 步骤 + 验收门，不解释设计理由（设计见 [architecture-3-layer](architecture-3-layer.md) 与 [communication-protocol](communication-protocol.md)）。

## 0. 前置

- `miopiik` preset 已建且 `standingKeyFor` 挂载验证通过。
- 用户开一个**新会话**（Web GUI），preset 选 **MiOpIIk 审查层（miopiik）**，cwd 指向目标项目。
- 该会话的 agent 即审查层；本 runbook 由审查层执行。

## 1. 工具核对（新会话第一步）

审查层首轮自行核对模型可见工具：

- 有 `subagent_planner`（continuable，默认后台）、`subagent`、`subagent_fork`、`workflow`、`session_search` 系列、`plan` 模式工具；
- 没有遗留的 probe 工具（preset_list 等，属于旧会话动态插件）。

PASS：清单吻合。FAIL：缺工具 → 回本文档 §6 排障。

## 2. 授权闸（D11/U3）

- 审查层派发 `subagent_planner` 前**必须经用户确认**（prompt 规则；评测场景禁派发）。
- 用户确认后派发，任务用模板 2.1（项目总目标/意图与约束/优先级/验收标准/边界）。

## 3. 派发规划层

审查层调用 `subagent_planner`，prompt = 模板 2.1 全文（含 PLAN.md 引用）。记录返回的 subagent id（规划层 id，后文称 P）。

## 4. 规划层首轮验收点（读其报告）

规划层首轮应先做（由其 prompt 约束）：

1. 读项目全景 + 写 plan 文件 + 冻结契约目录 `.dsh/contracts/`；
2. 派监督层：调用 `subagent_supervisor`，prompt = 项目总目标 + 报告周期约定；记录监督层 id（称 S）；
3. 派发第一批执行层切片（`mop_spawn_executor` × N 并行，三段式任务模板 2.2）；
4. 收齐执行层结果 → 门禁验证；
5. 向 S `send_message` 发 [EXEC] 报告（2.3）；
6. 里程碑时用 `report` 向审查层发 2.5 汇报。

## 5. U2 spike（监督层 session_query 授权实测）

监督层在自己的会话里执行：

1. `session_search` 关键词搜规划层的会话内容（如搜索 P 写的 plan 文件名）；
2. `session_event_search` 直接按 P 的 session id 搜事件；
3. `read` 读 `.dsh/progress/current.md`（落盘事实通道）。

记录三种结果：

| 结果 | 判定 |
|---|---|
| 三通道全通 | PASS：监督层可知性完整（D10 全量） |
| session_* 受限但 progress 文件可读 | 部分通过：监督层退化为报告 + 文件两通道（PLAN.md U2 备选方案，同样成立） |
| 全不通 | FAIL：回 §6 排障 |

### 5.1 实测记录（2026-08-14，阶段一验收样例，判定 = 中间档）

监督层 S（`ffd1d28d-e2c8-43ff-84e9-1a8edd3f7ff6`，规划层子）依上表在自身会话实测（verbatim 存档：`.dsh/memory/u2-spike-result.md`）：

| 通道 | 实测动作 | 结果 |
|---|---|---|
| 1 session_search | `session_search(query="phase1-sample")` | 失败：`Error: session search is disabled in this deployment` |
| 2 session_event_search | `session_event_search(session_id="<P 的 id>", query="phase1")` | 失败：同上（部署级禁用，非权限/参数问题——两处报错完全一致） |
| 3 read progress | `read(".dsh/progress/current.md")` | 成功（22 行，与 [EXEC] 报告状态一致） |

结论：**session_* 在本部署被整体禁用**（审查层根会话同样复现同一报错，属部署级配置而非子代理授权规则），progress 文件通道可用 → 监督层可知性 = 报告推送 + 落盘事实两通道（PLAN.md U2 备选方案，成立）。附带实测：监督层 toolFilter 生效（write/glob 不可用，仅 read/grep/report/session_* 五件 + 宿主注入 report）。

注意：`report` 是子自身作用域注册，不受 toolFilter 过滤（已核实源码），监督层应始终可发 [CONCERN]。

## 6. 排障索引

| 症状 | 检查 |
|---|---|
| 子代理无预期工具 | persona/toolFilter 行配置（allow 白名单名必须精确匹配全局工具名：read/write/edit/glob/grep/bash/todo_write；session_* 五名） |
| 子代理 persona 未生效 | persona 必须挂 `deployment:persona` 段（dsh-subagent 源码行为）；确认组合里 persona 行是 `@deepseek-ai/dsh-persona` |
| 监督层无 report | 确认宿主 base bundle 的 tool-subagent-report 行未动（宿主机归属，preset 不得复刻） |
| 执行层能派 subagent | toolFilter allow 未含任何 subagent 工具（allow 白名单已排除）→ 若仍可派，回查 allow 名单与工具名 |
| 挂载失败信息 | `preset_validate miopiik` 的错误原文（行未激活/服务冲突/未知名） |

## 7. 阶段一验收门（D16）

- A1 审查层能一键派发规划层，规划层能并行派发执行层：PASS/KILL（工具不可见）/NULL（无证据）。
- A2 执行层工具面 = 白名单七件且无任何派发能力（实测让执行层 spawn 应失败）。
- A3 监督层默认沉默；收到刻意缺陷报告时能产出 [CONCERN]（含文件+行号证据）。
- A4 [EXEC] 报告五字段齐全且时间戳真实。
- A5 U2 结论落盘（本文件 §5 表更新）+ PLAN.md U2 行状态更新。
- A6 全程无 Emoji、结论先行、模板字段完整（用户风格门）。
