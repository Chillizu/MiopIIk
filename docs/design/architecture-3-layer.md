# 三层 + 监督层架构设计

> 上一级：[PLAN.md](../../PLAN.md)。对应决策 D1–D6、D11、D16、D19、D20。蓝本：用户在 OMP PEDA-Review 中已实战原型的三层 subagent 架构 + MioKig 独立验收法 + 用户画像（[user-preference-profile](../profile/user-preference-profile.md)）。

## 1. 四角色总表

| 角色 | DSH 实现 | 落地形态（D25） | 人格 | 工具面 | 模型（D19） |
|---|---|---|---|---|---|
| 审查层（Review） | 根会话 | 用户 preset `miopiik`（persona 行 = 审查层 prompt） | pragmatic + default（+ 用户交互规则） | 全量 + plan mode + goal + memory + subagent 控制 + session_query + **checkpoint/rewind 管理工具** | 强模型 |
| 规划层（Planner） | continuable 后台子代理 | `subagent_planner` 工具行（config.persona + toolFilter deny） | default | workflow + subagent 派发 + read/grep/edit + 项目记忆 + todo + session_query | 强模型 |
| 执行层（Executor） | one-shot 子代理 | `subagent_executor` 工具行（config.persona + toolFilter allow 最小集） | default 精简 | 最小集 read/write/edit/glob/grep/bash/todo；**无 subagent/workflow 工具**（toolFilter 硬过滤） | 廉价模型 |
| 监督层（Supervisor） | continuable 后台子代理（默认 = 规划层的子，U1） | `subagent_supervisor` 工具行（config.persona + 只读 toolFilter） | default + 沉默即通过 | 只读为主 read/grep + session_query；大上下文 | 廉价模型 |

## 2. 职责边界（分工设计，固定不变）

- **审查层**：唯一对用户；接收需求 → 产出项目总目标/意图/优先级/验收/边界 → 派规划层；阶段验收与方向决策；产出上游模型报告（D17）；管理全局记忆与授权闸；**不直接派执行层**（单文件小活按 AGENTS.md 自行处理）。

**审查层的监督模型（D28）**：审查层是唯一的无监督单点（监督层只管规划层，无人监督审查层自己）——它的顶层监督者就是**用户**（D2 直接对话用户即隐含此意，此处显式化）。因此：

1. **用户即顶层监督者**：审查层的方向决策以用户确认为准（授权闸 D11 已隐含）；审查层跑偏由用户纠偏，纠错到第二层为止是设计使然，非缺陷。
2. **审查层自 checkpoint**：里程碑后调 `mop_checkpoint(label, note)`（默认打调用者自己）——审查层有 checkpoint 能力但缺纪律，故写入 persona 硬规则；使其单点从"结构缺陷"降为"可恢复的薄弱环节"。
3. **能力探测前置**：会话开首读 `.dsh/memory/capabilities.md`（D27），确认 seam 可用性再动手，不凭记忆假设上游契约。

- **规划层**：解读审查层指示 + 项目全景 → 自己初步规划（plan 文件）→ 分解为切片 → 契约文件 → 并行派执行层 → 收集结果 → 门禁验证 → 定期向监督层报告（D9）；走偏时回溯（rewind）。
- **执行层**：按三段式任务模板执行单一切片；不做设计决策、不做 go/no-go、不 spawn 次级 subagent、只 append 不覆盖（PEDA-Teacher 契约）；完成后按验收格式输出。
- **监督层**：独立 agent（隔离上下文与偏见——用户 MioKig 原话动机）；定期收规划层 [EXEC] 报告做路径评估；默认沉默，仅偏离时 report concern；保持项目进度可知性（三通道，见通信协议）；附带独立验收职责（三 agent 验证法：功能/逻辑/稳定性 → P0–P3，输出文件+行号+风险）。

## 3. 授权闸（D11/U3）

- 默认：**派发 subagent 前经用户确认**（用户 AGENTS.md 明文 + 7/26 起实践）。
- 放行：用户可一次性批准一批（"这些都可以"），或声明"本阶段可自行派发"。
- 禁停：场景级关闭（评测/对比场景"不许使用 subagent"）→ 对应会话 preset 去掉 subagent 工具。
- 一期实现 = prompt 规则；二期评估接 DSH 审批 seam（allowed-once 语义恰好匹配）。

## 4. 防滥用规则（写入 preset）

1. 执行层工具面过滤掉 subagent/workflow——递归滥用从工具层根除（对照 OMP task.maxRecursionDepth 但更硬）。
2. 单文件小改动、直接回答不派发（AGENTS.md 任务分配原文）。
3. 规划层 fan-out 上限（默认 4-6 并行，用户可调）；"NEVER launch a one-off task"（orchestrate 契约）。
4. 大内容走文件不走消息（hub 消息 <1000 字符教训）。
5. 执行层不改他人切片文件（跨切片文件所有权合约）。

## 5. 工程纪律（D16，固化为 preset 默认规范）

- 契约先行：先冻结契约（schema/validator/golden fixtures），实现层只引用——项目级 `.dsh/contracts/` 目录。
- 计划即执行规格、零设计决策：规划层写 plan 文件为唯一事实来源。
- 预注册 PASS/KILL/NULL 量化门 + 归因分层 + 双臂对照 + 独立复算对账。
- 独立验证：每个里程碑后派只读 verification subagent，验收用 P0–P3 分级（见 report-template）。

## 6. 后台任务与可观测性（D20）

- 长任务：`run_in_background` + DSH jobs（job_list/job_output/job_kill）；强制详细日志 + 结束 flag + ETA 汇报（用户"像死机"焦虑红线）。
- 进度展示语义化：报告"最后执行的工具 + 当前操作"（Omp-bot 卡片诉求）。
- 卡住/超时：主动切方案（换镜像/换源/换 provider），不反复重试同一失败源（用户最大不满点）。
- run-stats：agent 墙钟/token/工具调用统计（session-telemetry seam，S7）——回应 DSH-test 评测硬缺口。

## 7. 上下文管理与自主压缩（D24）

- 规划层与监督层是长命 continuable 会话，**默认挂 DSH 自动压缩**（compaction-basic：上下文压力阈值触发 + 无模型工具结果剪枝），引擎侧无需模型参与。
- 规划层可**自主 compact**（状态折叠）：当判断上下文已偏离项目主线或压缩窗口临近时，主动执行——① 把当前状态写成 [EXEC] 汇总（见 report-template）并落盘 `.dsh/progress/` 与项目记忆；② handoff 到新会话续跑（携带压缩报告 + PLAN.md 引用）。监督层与审查层各自独立压缩，互不影响。
- 压缩防丢失：所有关键状态在压缩前必须已写入文件（progress/memory/contracts），会话日志仅作过程记录——WATCHDOG 纪律（PEDA 实践）的 DSH 版。
- 与 checkpoint/rewind 的关系：compact 是上下文整理（同一逻辑主线），rewind 是分支回溯（换逻辑主线）——两者正交，规划层按需选用。

**自 compact 权限模型（D24 细化）**：

- 作用域：DSH compaction 是 **per-agent**（`compactIfNeeded/compactNow(agent)`）——每个 agent **只能压缩自己**，不存在"压缩别的 agent"这个操作；跨会话没有"压缩"，只有 handoff。
- 谁能自 compact：规划层、监督层（长命 continuable）；执行层 one-shot 不需要（短命，toolResultPruner 够）；审查层随自己需要。
- 审查层**不能直接 compact 规划层**——对跑偏规划层的正确操作 = checkpoint + rewind（fork 新规划层子会话续跑），旧规划层自然退休；这与"checkpoint 作为审查层管理规划层的 git 工具"是同一件事的两半。
- 权限门 = **落盘先行**（条件式授权）：能 compact 的前提 = 关键状态已写盘（[EXEC] 汇总 + `.dsh/progress/` + `.dsh/memory/` + contracts）；未落盘则无权折叠（WATCHDOG 纪律）。

## 8. 落地形态：单 preset + 三 delegation 行（D25）

DSH 机制（源码核实）：子代理**加入父级 preset**（无 per-child preset 参数）；per-child 角色 = subagent 工具行 config 的 `persona`（shadow `deployment:persona` 段）+ `toolFilter`（allow/deny 全局工具名，未知名启动失败）。因此四层 = 一个用户 preset `miopiik`（从 standard copy）+ 三个 delegation 工具行；`docs/design/presets/*.md` 是四个 prompt 全文的定稿源，嵌入 miopiik 组合。

```yaml
# miopiik/agent.cordis.yml 关键行（prompt 全文定稿后嵌入）
- id: tool-subagent-planner        # 审查层派规划层（D3）
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_planner
    backgroundMode: continuable
    agentOptions: { provider: deepseek-official, model: deepseek-v4-pro }
    persona: <规划层 prompt 全文>
    toolFilter:
      deny: [ask_user_question, ralph, create_goal, get_goal, update_goal, web_search]

- id: tool-subagent-executor       # 规划层派执行层（D4）
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_executor
    agentOptions: { provider: deepseek-official, model: deepseek-v4-flash }
    persona: <执行层 prompt 全文>
    toolFilter:
      allow: [read, write, edit, glob, grep, bash, todo_write]

- id: tool-subagent-supervisor     # 规划层派监督层（D5/U1）
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_supervisor
    backgroundMode: continuable
    agentOptions: { provider: deepseek-official, model: deepseek-v4-flash }
    persona: <监督层 prompt 全文>
    toolFilter:
      allow: [read, grep, session_search, session_event_search, session_trace, session_event_trace, session_event_read]
```

要点：

- 子代理继承父级 miopiik 其余工具行（bash/fs/jobs/compaction/plan-mode/session-query 等），persona 只换"你是谁"段，toolFilter 收紧工具面；
- 执行层无 subagent/workflow/plan/goal 工具（allow 白名单硬过滤，防递归滥用，D11 工程化）；监督层只读（D10 三通道够用）；
- planner 的 deny 含 ask_user_question：规划层不直连用户，疑问走 2.5 汇报给审查层（协议 D7）；
- `report` 工具由宿主 `tool-subagent-report` 行注册给每个 continuable 子（非 preset 行，避免重复注册抛错）；
- 模型路由（D19 落地）：全局默认 = `deepseek-official/deepseek-v4-flash`；planner 行 `agentOptions` 用 `deepseek-v4-pro`，executor/supervisor/通用 subagent 与 fork 用 `deepseek-v4-flash`。DSH 部署默认曾是 llama-server 本地模型（子代理流超时根因），已修正；
- 宿主组合放共享服务：持久化/沙箱/审批/模型路由/subagent 后端；preset 只放模型可见工具与 prompt——本文件其余章节不变。
