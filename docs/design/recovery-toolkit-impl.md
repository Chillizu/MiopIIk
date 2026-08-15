# 恢复工具包 · 实施契约（阶段二）

> 上一级：[recovery-toolkit](recovery-toolkit.md)。对应 D13/D14/D18。本文是**契约先行（D16）**的实施规格：现状核验（原生 seam）+ 构建清单 + 验收门。只列事实与验收，不解释动机（动机见 recovery-toolkit.md）。

## 1. 现状核验（v0.1.0-rc.5，源码 + 运行时事件目录）

原生已有（无需自建底层机制）：

| 能力 | 原生 seam | 证据 |
|---|---|---|
| 请求级自动重试 | `agent/request-error` waterfall（返回 RequestErrorAction）+ provider 层 `llm/retry` 事件 + `ResolvedRetryPolicy`（maxAttempts/退避/错误分类） | 事件目录 + agent-loop/agent.ts:356 + 早前 subagent 超时日志（policyKey 含重试 2 次） |
| 失败 turn 记录 | `agent/error` emit（payload: agent/turn/step/error） | 事件目录 |
| 消息重注入 | `agent/pre-step` waterfall（"replace the messages that enter it"）+ `agent/inbox/inserted`/`claimed`/`discarded` + 会话日志 `agent/inbox/spliced` | 事件目录 |
| 无损回溯 | `ctx.sessions.fork(source, boundary?, childSessionId?)` | sessions 服务契约 |
| 内部 checkpoint | `sessionProjections.checkpoint/restore/restoreFloor/viewCheckpoint` | sessionProjections 服务契约 |
| 命令注册 | `ctx.commands.register(definition)`（已有 /compact /goal /plan /feedback） | commands 服务 + command-compact/goal/plan-mode/feedback 包 |
| 规则注入 seam | `systemPrompt.section()` + `system-prompt/assemble` waterfall | systemPrompt 服务 + persona 包 |

缺口（需自建，全部是"薄命令/薄插件套在现有 seam 上"）：

| 缺口 | 自建内容 | 套用 seam |
|---|---|---|
| `/retry` | 命令：`agent/error` 记录失败 turn/step 与边界 seq → 重注入原用户消息重跑 | agent/error + agent/pre-step（或 inbox 重注入 API，实现时确认） |
| `checkpoint` 工具 | 记录当前 seq + 标签 → `.dsh/memory/checkpoints.md` | sessionProjections.checkpoint（或直接记 seq）+ fs |
| `rewind` 工具 | 按标签 `sessions.fork(当前, boundary)` 开子会话 + 丢弃段压缩成简短报告注入新会话 | sessions.fork + compaction 报告 |
| 规则注入（TTSR 式） | `/rule` 命令：会话级硬规则写入 prompt 段 | systemPrompt.section |
| 「轨迹」页（D14/D18） | 会话树/时间线：checkpoint 标签、fork 分支、失败 turn 的 /retry 入口、run-stats（墙钟/token/工具计数） | client Slots（实现时查 Slots.listSubTree）+ sessionProjections/sessionTelemetry |

## 2. 平面归属（决定每个组件放哪）

| 组件 | 平面 | 理由 |
|---|---|---|
| 自动重试策略（配置化） | **宿主组合**（全局） | agent/request-error 跨会话生效；provider 重试已原生，本项只补"策略可配置/可关" |
| `/retry`、`checkpoint`、`rewind`、`/rule` | **miopiik preset 行**（agent 平面） | D13 §4：/retry+checkpoint 审查+规划层；rewind 规划层；/rule 会话级——均为模型可见命令，非跨会话共享服务 |
| 「轨迹」页 | client 插件（web bundle 或 preset client 行） | 纯 UI，读现有投影 |

## 3. 分阶段

1. **P1 命令四件套**（动态插件 spike 验证 seam → 落 miopiik preset 行）：/retry、checkpoint、rewind、/rule。
2. **P2 自动重试策略**：宿主级 `agent/request-error` 监听（可配置 maxAttempts/退避/错误分类）。
3. **P3 「轨迹」页**（D14/D18）：client Slot UI + run-stats（sessionTelemetry 投影）。

## 4. 验收门（D16，预注册）

| 门 | 判定 |
|---|---|
| PASS | /retry 同输入重跑失败 turn 不报新错；rewind 后新会话只含 checkpoint 前内容 + 压缩报告；checkpoint 可列表/可跳转；/rule 注入后下一轮 prompt 含该规则 |
| KILL | rewind 破坏原会话日志（必须 fork）；自动重试无限循环（必须有上限+退避）；命令注册重复抛错 |
| NULL | 无会话日志/事件证据支撑的 PASS 声明 |

## 5. 契约（冻结）

- `/retry`：重注入对象 = 失败 turn 的用户消息（非工具结果、非助手消息）；重跑后原失败 turn 与重跑 turn 均保留于日志（追加不覆盖）。
- `rewind`：绝不裁剪原会话；新会话 = fork 子（parentSession 指向原会话）；丢弃段压缩报告 ≤ 600 字符。
- `checkpoint`：标签唯一；落盘为 append（不覆盖历史）。
- `/rule`：规则段只追加/替换同 id，不删其他段；作用域 = 当前会话。

## 6. P1 实现进展（2026-08-14）

**复用点确认（不重造）**：client `sessions.fork({sessionId, atSeq})`（现成 fork 原语，= 现有 `forkAt` 语义）；host `agent.followup` + `agent/pre-step`/`agent/error`（重试）；`systemPrompt.section`（规则注入）；`fs.writeText`（checkpoint 落盘，须传 session 作用域 sandboxPolicy）。

**已建 recovery-ui 插件（动态 `recui-3`，host+client）**：
- Client：`conversation.chat.turnTail`「回溯到此」（fork 到该 turn 结束 seq）+ `conversation.session.header.actions`「回溯」（fork 到最近 checkpoint）与「Checkpoint」。
- Host：`recovery.checkpoint` / `recovery.checkpoints` / `recovery.retry` / `recovery.rule` 四个 handler。

**验证**：
- UI 挂载：turnTail occupant `dyn/recui-3`（active）——按钮已上线；
- 规则注入：`systemPrompt.section` 生效（`mop_rule_show` 回读确认）；
- checkpoint 落盘：初版被沙箱拒绝（`fs.writeText` 未传 session 作用域 policy），已修复（`sandboxPolicy.resolve({session})`）并实测写入 `.dsh/memory/checkpoints.md`；
- retry 管线：`agent/error` 监听已接（`retry_status` 返回"无失败记录"）。

**状态**：`recui-3` pkg-8（+「重试」按钮 + per-turn 重放）异步激活中；host spike `recov-2`（工具形态）运行中。剩余：P2 自动重试策略（宿主 request-error 监听，provider 重试已原生）、P3 轨迹页 run-stats、「改提示词」按钮（fork 到 turn 起点 + 预填原消息）、promote 为持久化组合（动态插件重启即失）。

**重试语义（已修）**：`recovery.retry` 重放 = 失败 turn 的**起始用户消息**（`agent/pre-step` 首步 turnStarters map），非全局最近一步；重放后原失败 turn 与重跑 turn 均保留于追加日志（契约 §5）。

**UI 归属修正（用户实测反馈）**：
- checkpoint = **agent 管理**（模型经 `mop_checkpoint` 工具调用），撤 UI 按钮；
- 回溯 = **每 turn 一个**，嵌在 turn 尾部（紧邻既有 fork 按钮），非 header 级；header 仅保留「重试」；
- **fork 边界 bug**：`sessions.fork` 的 `atSeq` 必须是 turn **完成边界**（`owner.turn.end.seq`），不是 closing assistant 消息 seq——否则报 `fork-unavailable: has not completed the turn containing event <seq>`（浏览器 console 实锤）。已改用 `turn.end.seq`。

## 7. P3 与固化结论

- **P3 run-stats（D18）已原生**：trajectory 视图 `AssistantTimingPanel` 展示 Started / Total duration / TTFT / Generation / Throughput（tok/s）+ outputTokens；无需自建。轨迹 tab 本身无可扩展子 Slot（按钮落 chat 视图 header/turnTail 是唯一 additive 点）。
- **改提示词（defer）**：fork 到「turn 前」需前一个 turn 的 end seq（`owner.turn` 无 prev）；`atSeq = turn.start.seq` 会因"该 turn 未完成"被拒，`start.seq - 1` 有非连续段风险——待实测后再定。
- **固化路径（待用户 sign-off，因需重启 dsh web）**：
  1. 把恢复插件做成本地 npm 包（host = model 工具 mop_checkpoint/mop_rule_inject/retry_replay + `harness.handle` 四 handler；client = 回溯/重试按钮）；
  2. agent 工具半 → **miopiik preset** 行（`agent.cordis.yml`，模型可调）；
  3. 按钮半 → **web profile patch**（`~/.dsh/profiles/web/cordis.patch.yml` + profile `package.json` deps 加该包，patch 里 insert 行）；
  4. 重启 `dsh web` 进程生效（会中断当前会话，故需你确认）。
  注意：client `host.call` 与 host `harness.handle` 必须同包同组合（web bundle）；agent 工具半是另一个 host-only 包放 preset。

## 8. 定案与实测（2026-08-14 收尾）

**方向收窄**：UI 按钮方向（`recui-3` 回溯/重试按钮）**已删**——`sessions.fork` 本质 = 新开会话，与现有「分叉会话」同原语，做不出"就地回退"；checkpoint/rewind 归位为**审查层 agent 工具**。

**固化完成（免 pnpm）**：
- 包：`~/.dsh/profiles/mop-tool-recovery/index.js`（ESM，`import { defineTool } from '@deepseek-ai/dsh-tools'`，靠 `~/.dsh/profiles/node_modules` 愈合 fallback 解析）；
- 接线：`miopiik/agent.cordis.yml` 尾部 `mop-tool-recovery` 行，`name` 用**绝对路径**（loader 转 file URL）；`standingKeyFor` mounted OK。

**实测（新会话导出 cb90624f）**：mop_checkpoint / mop_rule_inject / mop_rule_show 全部 [OK]；mop_rewind 首测 3 次 `session not found`（sessionId 未归一化 `session-` 前缀）→ **已修**（自动补/去前缀 + 冷会话提示）。checkpoint @ seq 0 = "派规划层前" fork 到空，语义正确。

**审查层 prompt 约定（已写入 persona + 定稿稿）**：checkpoint 于重大节点，git 仓库里先 `bash git rev-parse HEAD` 记进 note；rewind(sessionId=规划层 id, label) 无损回溯。

**清理**：动态 `recov-2` 已 undefine，探针 `prset-1` 已停（留定义备将来 preset 校验）。

**遗留**：① 冷会话 rewind（走 sessionPersistence 冷读 + fork，未做）；②「改提示词」fork 到 turn 前（边界未定，defer）；③ 记忆细化（D12，下一阶段）。
