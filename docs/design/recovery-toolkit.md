# 恢复工具包设计（retry / checkpoint / rewind / 规则注入）

> 状态（2026-08-15）：checkpoint / rewind / 规则注入已落地为 `@chillizu/mop-tool-recovery`；`/retry` 已**弃用**（请求级自动重试 = provider 原生 `llm/retry`）；run-stats = trajectory 原生。下文保留 retry 的设计记录，但非实现承诺。

> 上一级：[PLAN.md](../PLAN.md)。对应决策 D13、D14、D18。动机：用户确认 DSH 缺重试/checkpoint/回溯；其 OMP 实践（/retry、/omfg→TTSR、plan 重开+规则注入+固化教训）与"像死机"焦虑。

## 1. DSH 现有基础（查证自源码）

- `agent/request-error` waterfall：hook 可"返回 retry 动作或保留原错误"——**重试策略 seam 已存在，无随包策略实现**；
- `ctx.sessions.fork(source, boundary?, childSessionId?)`——**无损回溯原语**；
- compaction 体系（管长上下文，与本包正交）；
- 无 `/retry`、checkpoint/rewind 工具（grep 全仓确认）。

## 2. 功能设计

| 功能 | 实现 | 与 OMP 差异 |
|---|---|---|
| `/retry`（人类命令） | `ctx.commands` 注册；监听 turn/step 错误结束事件记录失败输入与边界 seq；`/retry` 把消息重注入 inbox（agent.inject/steer）重跑 | 同义；DSH 版保留重放历史 |
| 自动重试策略 | `agent/request-error` hook：最大尝试、退避、按错误类型决定重试或保留；配置可关 | 只做请求级；不碰 OMP harmony 流截断协议（provider 适配器职责） |
| `checkpoint` 工具 | 记录当前会话事件 seq（或 boundary id）+ 标签 → 项目记忆（`.dsh/memory/checkpoints.md`） | 等价 OMP checkpoint |
| `rewind`（回溯）工具 | 按标签 `sessions.fork(当前会话, boundary)` 开子会话继续；先把丢弃段压缩成简短报告注入新会话 | **比 OMP 安全**：OMP 破坏性裁剪；DSH 仅追加日志 → fork 无损，原分支可查可再回 |
| 规则注入（TTSR 式） | 会话级硬规则（如"gradlew 必须带 cwd CosHelper"）注入 prompt 段根治重复错误 | 一期做"规则段注入"；流中截断版（TTSR 原文）二期评估 |

## 3. UI 落位（D14）

fork/rewind/checkpoint/retry 等会话管理操作放在 Web GUI **「轨迹」页面**（会话树/时间线视图）：展示 checkpoint 标签、fork 分支关系、回溯入口、失败 turn 的 /retry 按钮、agent 墙钟/token/工具调用统计（D18 run-stats 同页）。

## 4. 层级归属

- `/retry`、`checkpoint`：审查层 + 规划层（规划层每次大 fan-out 前打 checkpoint）；
- `rewind`：规划层（探索走偏回溯）；审查层可全树回溯；
- 自动重试策略：全局（所有层）；
- 规则注入：会话级，由审查层/规划层维护。

## 5. 验收标准（本包）

- PASS：/retry 重跑失败 turn 成功率 100%（同输入重放不报新错）；rewind 后新会话上下文只含 checkpoint 前内容 + 压缩报告；checkpoint 标签可列表/可跳转；
- KILL：rewind 破坏原会话日志（绝不允许，必须 fork）；自动重试无限循环（必须有上限+退避）。
