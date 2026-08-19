# 能力探测设计（D27）

> 上一级：[PLAN.md](../PLAN.md)。动机：U2 spike 实测 `session_search` 被部署级禁用——平台契约可能是当前部署的偶然行为；DSH 尚在 rc，seam 语义流动。防上游漂移 = 每次部署/升级后实测，不凭记忆假设。

## 1. 探测模块

`@chillizu/mop-capabilities`：

- 挂 `agent/created`（根会话 depth 0）自动探测一次 + 工具 `mop_probe_capabilities` 按需重探；
- 探测 seam：`sessions.list/fork`、`sessionPersistence.listSnapshots/readFrom`、`sessionQuery.searchSessions`、`systemPrompt.section`、`sandboxPolicy.resolve`；
- 输出 `.dsh/memory/capabilities.md`（能力清单：seam / [OK]|[DEGRADED] / 详情）。

## 2. 用法

审查层 persona：会话开首读 `.dsh/memory/capabilities.md`（不存在则调 `mop_probe_capabilities`）；规划层/监督层按需读。

## 3. 探测项与降级映射

| seam | 降级时下游影响 | 兜底 |
|---|---|---|
| `sessionQuery.searchSessions` [DEGRADED] | recall 全文搜索不可用 | 报告推送 + 落盘事实两通道 |
| `sessionPersistence.readFrom` [DEGRADED] | 冷会话 rewind 不可用 | 仅热会话 rewind |
| `sessions.fork` [DEGRADED] | rewind 不可用 | 手动开新会话续跑 |

## 4. 验收

- PASS：`capabilities.md` 生成且含全部 seam 状态；degraded 项正确标注；
- KILL：探测写文件失败必须不中断（catch 后忽略），工具调用仍可用。
