# 迁移完整性审查 + 相对 OMP 差别

> 上一级：[PLAN.md](../../PLAN.md)。本文件是实施到阶段二后的**完整性自审查**：自建清单状态 + 与 OMP 的关键差别 + 剩余缺口。事实优先、结论先行。

## 1. 自建清单状态（S1–S9）

| # | 自建项 | 状态 | 证据 |
|---|---|---|---|
| S1 | 四层 preset | ✓ | 单 preset `miopiik` + 两 delegation 行 + `mop_spawn_executor`（D25）；standingKeyFor 通过 |
| S2 | 通信协议 + 模板 | ✓ | 2.1/2.2/2.3/2.4/2.5 + [EXEC]；phase1/2 实测 |
| S3 | 魔法关键词 hook | ✓ | `mop-magic-keywords`：ultrathink/workflowz 正文检测 + orchestrate 常驻 persona |
| S4 | 恢复工具包 | ✓ | checkpoint/rewind/rule 固化入 miopiik；`/retry` 弃用（自动重试=原生 provider）；run-stats=原生 trajectory |
| S5 | 分级记忆 | ✓ 一期 | 全局→`~/.dsh/memory/global/` + persona 注入；项目→`.dsh/memory/`；recall 缺口见下 |
| S6 | 执行/报告模板 | ✓ | 三段式 + [EXEC] + P0–P3 |
| S7 | run-stats | ✓ 原生 + 可编程 | trajectory `AssistantTimingPanel`（duration/TTFT/Throughput/tokens）+ `mop_run_stats(sessionId)` 累计桶（D18 token 出口） |
| S8 | session_query 授权 spike | ✓ | U2 实测：部署级禁用（SESSION_QUERY_SEARCH_DISABLED） |
| S9 | 动态 LSP | ✗ 可选 | 后置，无需求 |

## 2. 相对 OMP 的关键差别（迁移的是思想，不是实现）

| 维度 | OMP | MiOpIIk/DSH | 评价 |
|---|---|---|---|
| 子代理通信 | IRC/hub（兄弟直连 + 广播） | 树形：send_message 父→子、report 子→父，无兄弟直连（D7） | 更简单，符合授权闸模型 |
| 监督层 | advisor = 同一上下文第二模型 | 独立 agent（隔离上下文与偏见，用户动机） | 更强隔离 |
| 记忆 | mnemopi 向量检索 + proactive linking（recallLimit 12 / injection 8000） | 文件 + session_query（一期零工具）；recall 现禁用 | 弱在召回，透明在前 |
| 恢复 | /retry + /omfg→TTSR（流截断，破坏性裁剪） | checkpoint/rewind=fork（无损，追加日志）+ 规则注入 | fork 更安全，但 rewind=新会话非就地回退 |
| 魔法关键词 | ultrathink/orchestrate/workflowz（散文触发） | 未迁移（D15 殿后） | 缺口 |
| 工具面 | 31 工具 + LSP/DAP/eval 四内核 + browser/computer + 23 搜索后端 | DSH ~35 工具 + seam | 放弃 browser/computer/DAP/内部 URL/语音/生图/多搜索后端 |
| 模型路由 | 十角色 fallback chains | per-layer agentOptions（planner=pro，executor/supervisor=flash）+ 全局默认 | 直觉同构 |
| loop | harmony 流截断 + hashline + TTSR | agent-loop + compaction + fork + sessionProjections | DSH 更事件溯源 |

## 3. 剩余缺口（按优先级）

1. **D19 模型路由实验**（D29）——冻结阈值并跑预注册实验。
2. **recall 自动化**——已启用全文搜索（profile patch `openAt: first-search`，重启生效）；语义检索弃用。
3. **冷会话 rewind 实测**——已实现（persistence read + seeded create），缺真实冷会话验证。
4. **retry agent 工具**——UI 方向已弃；自动重试原生；"手动重跑"由审查层直接重发消息，未单列工具（可接受）。
5. **S9 动态 LSP**（可选，无需求）。

## 4. 一句话结论

迁移了 OMP 的**协作编排 + 分级记忆 + 恢复/回溯 + 授权闸思想**，落地为 DSH 原生原语的薄封装（fork/compaction/subagent/agentOptions/systemPrompt.section）；核心空白只剩魔法关键词（殿后）与 recall 自动化（受部署禁用限制，二期接嵌入）。
