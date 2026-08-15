# 魔法关键词设计（ultrathink / orchestrate / workflowz）

> 上一级：[PLAN.md](../../PLAN.md)。对应决策 D15。来源：OMP `src/modes/{magic-keywords,markdown-prose,ultrathink,orchestrate,workflow}.ts` + `prompts/system/*-notice.md` 原文（本地 17.2.15）。

## 1. 三关键词定义（OMP 行为）

| 关键词 | 触发行为 | OMP notice 原文要点 |
|---|---|---|
| `ultrathink` | turn 级深度思考开关；自动把思考等级拉最高 | 仅一行："Multi-step reasoning: think carefully through the problem before responding." |
| `orchestrate` | 注入完整编排契约 | decompose→dispatch→verify→iterate；禁止提前 yield；禁止串行派发（NEVER launch one-off task）；分阶段跑门禁再推进；坏活派纠正子代理不许自己偷偷修；offload 粒度 10 条规则 + 7 条 anti-patterns |
| `workflowz` | 注入确定性工作流手册 | eval 内 agent()/parallel()/pipeline()/completion()/log()/phase()/budget；模式：adversarial verify（N 质疑者投票）、judge panel、loop-until-dry、completeness critic |

触发规则：仅在散文正文触发，代码块/行内代码/XML/标识符/路径内不触发（OMP markdown-prose 排除规则）。

## 2. 分层注入表

| 层 | 注入方式 | 内容 |
|---|---|---|
| 审查层 | `ultrathink`（正文出现时触发） | 深度多步推理 prompt 段（DSH 无 turn 级思考等级切换，用高 effort 推理指引替代） |
| 规划层 | `orchestrate` = **preset 常驻契约段落**（不必靠关键词触发）；`workflowz`（正文出现时触发） | 契约按 DSH 术语改写：task→subagent/workflow；hub wait→job_output/workflow await；local://→工作区 `.dsh/contracts/`；验证命令→项目实际门禁；commit→git 双树策略 |
| 执行层 | 不注入 | one-shot 拿合约，不需要编排契约 |
| 监督层 | 不注入 | 只读评审 |

## 3. Hook 插件设计（S3）

- 挂点：`user/message`（或 `agent/pre-step`）监听器；
- 检测：按 OMP markdown-prose 排除规则在正文文本中匹配 **ultrathink / workflowz**（两个 hook 关键词；orchestrate 走 persona 常驻，不经 hook）；
- 注入：命中的 turn 注入对应 notice 段落（系统提示词 section，order 对齐 preset）；
- 范围：宿主组合 or preset 级均可；notice 文本从 OMP `*-notice.md` 移植改写（保留规则原文精神）。

**实现（已固化 `@chillizu/mop-magic-keywords`，miopiik preset 行）**：挂 `agent/pre-step` waterfall，正文（去 code fence/inline code）检测 `ultrathink`/`workflowz` → 以 `createUserMessage`（`form: 'notice'`）追加到该 step 消息（DSH 原生 context-message 注入，等价 OMP notice；`orchestrate` 已常驻规划层 persona，无需 hook）。检测为 v1 近似：只排除 code fence/inline code，未排除路径/标识符（后置细化）。

## 4. workflowz ↔ DSH workflow 工具对照

| OMP workflowz helper | DSH workflow 工具 | 备注 |
|---|---|---|
| agent(prompt, {schema}) | agent(prompt, {schema}) | schema 校验一致 |
| parallel(thunks) | parallel(thunks) | 一致 |
| pipeline(items, *stages) | pipeline(items, ...stages) | 一致（stage throw → 该 item 置 null） |
| phase(title) / log(msg) | phase(title) / log(msg) | 一致 |
| completion() 无状态单次调用 | 无（可用 subagent 替代） | 略 |
| budget.total/spent/remaining | 无 | 略（可后置） |
| 内联 eval 双语言 | workflow 工具调用（前台脚本） | DSH 用工具调用替代 eval 载体 |

结论：DSH 的 workflow 工具已是 workflowz 的原生版本——**关键词只需注入"本次任务用 workflow 工具"的 notice，无需移植手册全部细节**；OMP 模式（adversarial/judge panel 等）转成 DSH workflow 脚本模板放进 skill（二期）。

## 5. 验收标准（本包）

- PASS：ultrathink/workflowz 在正文触发、在代码块/路径中不触发；orchestrate 常驻段让规划层禁止串行派发；
- KILL：关键词误触发导致执行层收到编排契约（执行层必须无注入）。
