# 恢复工具包实施契约验收核验（s5）

## 结论

完成。

## 修改清单

- docs/review/recovery-toolkit-audit.md（新建，唯一产出）：核验 docs/design/recovery-toolkit-impl.md 的 §4 验收门（PASS/KILL/NULL 全覆盖）与 §5 冻结契约，逐门判定 + 证据，交叉核对 PLAN.md §5 已完成项 2，并列「仓库内不可核验项」清单。

## 验收对照

- Acceptance「docs/review/recovery-toolkit-audit.md 存在」→ 本文件即产出，已创建于 docs/review/recovery-toolkit-audit.md。
- Acceptance「§4 每门一行判定 + 证据（门数可数，全覆盖）」→ 见 §2：PASS 门 4 条、KILL 门 3 条、NULL 门 1 条，共 8 条判定，覆盖 recovery-toolkit-impl.md:45-49 全部门。
- Acceptance「至少 3 条带文件+行号的硬证据」→ 本报告含 9 条以上（.dsh/memory/checkpoints.md:1-9、recovery-toolkit-impl.md:68/:69/:100、PLAN.md:85/:91/:92、capabilities.md:11/:13/:14）。
- Acceptance「含『仓库内不可核验项』清单」→ 见 §5，共 9 项，诚实标注边界。
- Acceptance「交付清单只含 1 个新文件」→ 仅新建 docs/review/recovery-toolkit-audit.md。
- Acceptance「无 Emoji」→ 全文无 Emoji 符号。
- 禁止项自检：未修改 recovery-toolkit-impl.md / PLAN.md / checkpoints.md 或任何其他文件；未编造证据（/retry PASS 因无仓库内证据判为不可核验，未采信提示词全景的补充事实）；未跑 formatter。

## 阻塞

无。

## 1. 核验对象与方法

核验对象为 docs/design/recovery-toolkit-impl.md §4（验收门，line 43-49）与 §5（冻结契约，line 51-56）。证据仅采信仓库内可核验事实（文件 + 行号，或可复跑命令）；运行时行为无仓库内落盘/回读记录的，一律标「仓库内不可核验（需运行时验证）」。

提示词全景给出的补充事实「/retry 已实测重跑通过（2026-08-15）」与「checkpoints.md 第 3 行记录可作 PASS 证据」在仓库内均无对应证据，本报告不予采信：仓库内无 2026-08-15 的 /retry 重跑记录，且 .dsh/memory/checkpoints.md:3 实为 `manual | seq=295121`（早期手动条目，非 /retry 记录）。

## 2. §4 验收门逐门判定

### PASS 门（4 条）

- P1 `/retry` 同输入重跑失败 turn 不报新错 → **仓库内不可核验（需运行时验证）**。证据：仓库内无 /retry 重跑实测记录；recovery-toolkit-impl.md:70 仅记「retry 管线 agent/error 已接，retry_status 返回无失败记录」（管线接通，非完整重跑验证）；docs/review/completeness-omp-diff.md:37 记录 retry 未单列工具（UI 方向已弃、自动重试原生、手动重跑由审查层直接重发消息）。不判 PASS。
- P2 `rewind` 后新会话只含 checkpoint 前内容 + 压缩报告 → **部分（fork 无损有仓库内证据；压缩报告不可核验）**。证据：PLAN.md:91 冷会话 rewind 实测（775 事件 → 边界 774 → seed 775 → 子会话）；recovery-toolkit-impl.md:54 契约「绝不裁剪原会话 / fork 子 / parentSession」；.dsh/memory/capabilities.md:11 sessions.fork [OK]。但「压缩报告注入新会话」仓库内无产出/回读证据，实现（~/.dsh/profiles/mop-tool-recovery/index.js:150/:160，workspace 外）rewind 仅返回 child id 字符串，未见压缩报告产出 → 压缩报告一项不可核验。
- P3 `checkpoint` 可列表/可跳转 → **PASS（仓库内证据）**。证据：.dsh/memory/checkpoints.md:1-9 多条记录（标签 + seq，时间戳递增 = append）；recovery-toolkit-impl.md:69「checkpoint 落盘…实测写入 .dsh/memory/checkpoints.md」；recovery-toolkit-impl.md:100「mop_checkpoint…全部 [OK]」；PLAN.md:91 按标签 rewind 跳转（冷会话 rewind 实测）。
- P4 `/rule` 注入后下一轮 prompt 含该规则 → **PASS（文档记录，规则回读确认）**。证据：recovery-toolkit-impl.md:68「规则注入：systemPrompt.section 生效（mop_rule_show 回读确认）」；recovery-toolkit-impl.md:100「mop_rule_inject / mop_rule_show 全部 [OK]」；.dsh/memory/capabilities.md:13 systemPrompt.section [OK]。注：证据为「回读规则状态」而非「prompt 组装后快照」，「下一轮 prompt 实际含规则」属运行时，标注为文档级证据。

### KILL 门（3 条，触发即失败）

- K1 rewind 破坏原会话日志（必须 fork）→ **未触发（仓库内证据为 fork 设计，非破坏性）**。证据：recovery-toolkit-impl.md:54「绝不裁剪原会话」；recovery-toolkit-impl.md:79 fork 边界改用 turn.end.seq；.dsh/memory/capabilities.md:11 sessions.fork [OK]；PLAN.md:91 冷会话 rewind = fork/seed create（parentSession 指向原会话）。运行时「原会话日志未被破坏」仓库内无复验记录 → 设计级未触发，运行时不可核验。
- K2 自动重试无限循环（必须有上限+退避）→ **仓库内不可核验（需运行时验证）**。证据：recovery-toolkit-impl.md:11 原生 ResolvedRetryPolicy（maxAttempts/退避/错误分类）为源码描述；recovery-toolkit-impl.md:72「剩余：P2 自动重试策略」= 该项未落地。仓库内无运行时证据证明重试有上限不循环。
- K3 命令注册重复抛错 → **仓库内不可核验（需运行时验证）**。证据：仓库内无重复注册测试或日志记录。

### NULL 门（1 条）

- NULL 无会话日志/事件证据支撑的 PASS 声明 → **本报告据以执行（未采信无证据 PASS）**。证据：P1 因无仓库内会话日志证据判为不可核验（不判 PASS），即 NULL 门生效；本报告全部 PASS 判定均附仓库内文件 + 行号或标注不可核验。

## 3. §5 冻结契约逐条核对

- `/retry` 重注入对象 = 失败 turn 用户消息（非工具结果/助手消息）；追加不覆盖 → **仓库内有文档证据，运行时不可核验**。证据：recovery-toolkit-impl.md:74 声明「重放 = 失败 turn 的起始用户消息…追加日志」。但无运行时复验，且 /retry 未单列工具（completeness-omp-diff.md:37）。
- `rewind` 绝不裁剪原会话 / fork 子（parentSession）/ 压缩报告 ≤600 字符 → **前两项仓库内有证据，第三项不可核验**。证据：recovery-toolkit-impl.md:54 契约 + PLAN.md:91 实测 + capabilities.md:11 sessions.fork [OK]；「压缩报告 ≤600 字符」仓库内无产出证据（实现仅返回 child id）。
- `checkpoint` 标签唯一 / append 不覆盖 → **append 有证据，标签唯一未证实**。证据：.dsh/memory/checkpoints.md:1-9 时间戳递增（append）；PLAN.md:92 并发写锁 CAS；recovery-toolkit-impl.md:69 实测写入。但 .dsh/memory/checkpoints.md:2 与 :3 均为 label「manual」重复，且实现无唯一性强制 → 标签唯一未证实。
- `/rule` 只追加/替换同 id 不删其他段 / 作用域当前会话 → **仓库内有文档证据，运行时未复验**。证据：recovery-toolkit-impl.md:56 契约 + :68 生效回读；实现级（workspace 外）mop_rule_inject 按 session 隔离 ruleState、section name「session:rules」替换同 id（index.js:72/:217-223）。「不删其他段」运行时未复验。

## 4. PLAN.md §5 已完成项 2 交叉核对

PLAN.md:85 已完成项 2 声称「checkpoint / rewind（fork 无损，含冷会话）/ 规则注入 / 自动重试（原生）/ run-stats（原生）——已固化为 @chillizu/mop-tool-recovery 入 miopiik」。

- 核对「checkpoint / rewind / 规则注入固化」：与实现一致（workspace 外 mop-tool-recovery 包含 mop_checkpoint / mop_rewind / mop_checkpoint_list / mop_rule_inject / mop_rule_show）。
- 核对「含冷会话」：PLAN.md:91 已完成项 8 有冷会话 rewind 实测记录，一致。
- 核对「自动重试（原生）/ run-stats（原生）」：与 recovery-toolkit-impl.md §1 现状核验（line 11/§7 line 83）一致，属原生 seam，无自建代码，符合「不重造」定位。
- 核对「/retry 不在固化清单」：与 D13（PLAN.md:26）/retry 弃用、completeness-omp-diff.md:37「未单列工具」一致。

结论：已完成项 2 与仓库内证据一致（checkpoint/rewind/规则注入固化可核验；自动重试/run-stats 为原生声明）。

## 5. 仓库内不可核验项清单（需运行时验证）

1. /retry 同输入重跑不报新错（无重跑实测记录；/retry 未单列工具）
2. /retry 追加不覆盖（运行时日志行为）
3. rewind「压缩报告 ≤600 字符」（无压缩报告产出证据）
4. rewind 运行时「原会话日志未被破坏」（仅 fork 设计级证据）
5. 自动重试上限 + 退避（P2 未落地，仅原生 ResolvedRetryPolicy 源码描述）
6. 命令注册重复抛错（无测试/日志）
7. /rule「下一轮 prompt 实际含规则」（仅回读规则状态，非 prompt 快照）
8. /rule「不删其他段」（运行时未复验）
9. checkpoint「标签唯一」强制（数据存在 label 重复，无唯一性实现证据）
