# 决策一致性核验（d29）· review 文档 vs PLAN.md

> 本报告核验 docs/review/ 两张文档与 PLAN.md（单源事实）的事实一致性。只读核验，未修改任何被核验文档。

## 结论

完成。发现 10 处不一致（全部位于 completeness-omp-diff.md）；philosophy-audit.md §1 无不一致。

## 修改清单

- docs/review/decision-consistency-d29.md（新建，唯一产出）：本核验报告。

## 验收对照

1. docs/review/decision-consistency-d29.md 存在 -> 本文件即产出，见本文件第 1 行。
2. 覆盖完整性：报告声明已核对的陈述范围（两张文档 x 范围清单），数量可数 -> 见「核验范围声明」节（本文件第 32–43 行）。
3. 每条不一致含文件+行号+PLAN 依据+建议修复（4 要素） -> 见「不一致清单」节（本文件第 45–106 行），每条均含四要素。
4. 交付清单只含 1 个新文件，不改被核验文档 -> 「修改清单」（第 9–11 行）仅 1 项；未修改 completeness-omp-diff.md、philosophy-audit.md、PLAN.md 或任何其他文件。
5. 无 Emoji -> 全文无 Emoji。

## 阻塞

无。

## 核验基准说明

- PLAN.md 为单源事实（§6 维护规则）。
- PLAN.md U2（第 78 行）原文为：当时 session_search 被部署级禁用 -> 两通道兜底；现已启用全文搜索（profile patch openAt: first-search，实测 20 hits），recall 三通道恢复。
- 即「部署级禁用」是「当时」状态，当前权威状态是「已启用全文搜索 + recall 三通道恢复」。
- 因此 review 文档中把 session_search/recall 表述为「现禁用 / 部署级禁用 / 受部署禁用限制」的陈述，均判为不一致（与 PLAN.md U2 当前状态冲突）。

## 核验范围声明

### completeness-omp-diff.md
- §1 S1–S9 状态表（第 9–17 行，共 9 条）
- §2 相对 OMP 关键差别表（第 23–30 行，共 8 条）
- §3 剩余缺口清单（第 34–38 行，共 5 条）
- §4 一句话结论（第 42 行，1 条；补充核验，因其含状态陈述，超出 Change 列明的 §1/§2/§3 范围）
合计 23 条陈述。

### philosophy-audit.md
- §1 决策状态总表（第 7–13 行，共 5 个状态分类行）
合计 5 条陈述。

## 不一致清单（10 条，全部位于 completeness-omp-diff.md）

### 1. S1 四层 preset：delegation 口径过时
- 文件：docs/review/completeness-omp-diff.md 第 9 行
- 现状：「单 preset miopiik + 三 delegation 行（D25）」
- PLAN.md 依据：D25（PLAN.md 第 38 行）为「两 delegation 工具行（planner/supervisor）+ mop_spawn_executor 灵活执行层」；mop_spawn_executor 是自定义工具（D4，PLAN.md 第 17 行），不是 delegation 工具行。另见 philosophy-audit.md 第 19 行，已把「三个 delegation 行」列为已修复 drift，正确口径为「两行 + mop_spawn_executor」。
- 建议修复：S1 证据改为「单 preset miopiik + 两 delegation 工具行（planner/supervisor）+ mop_spawn_executor」。

### 2. S3 魔法关键词 hook：状态错误
- 文件：docs/review/completeness-omp-diff.md 第 11 行
- 现状：状态列为未完成（殿后），证据写「D15，未开始」
- PLAN.md 依据：§5 已完成项 4（PLAN.md 第 87 行）「魔法关键词 hook（D15）：mop-magic-keywords 入 miopiik，正文检测 ultrathink/workflowz -> notice 注入」，已标记完成。
- 建议修复：状态改「已完成」，证据改「mop-magic-keywords 入 miopiik（§5 已完成项 4）」。

### 3. S5 分级记忆：recall 仍称缺口
- 文件：docs/review/completeness-omp-diff.md 第 13 行
- 现状：「recall 缺口见下」
- PLAN.md 依据：§5 已完成项 3（PLAN.md 第 86 行）「recall 全文搜索启用（profile patch，重启生效）」；已完成项 10（第 93 行）「session_search 实测 2 hits」；U2（第 78 行）「recall 三通道恢复」。
- 建议修复：删除「recall 缺口见下」，改为「recall 全文搜索已启用」。

### 4. S8 session_query 授权 spike：证据过时
- 文件：docs/review/completeness-omp-diff.md 第 16 行
- 现状：「U2 实测：部署级禁用（SESSION_QUERY_SEARCH_DISABLED）」
- PLAN.md 依据：U2（PLAN.md 第 78 行）「现已启用全文搜索（profile patch openAt: first-search，实测 20 hits），recall 三通道恢复」。
- 建议修复：证据改为「U2 实测：当时部署级禁用，现已启用全文搜索（profile patch openAt: first-search）」。

### 5. §2 记忆维度：recall 现禁用
- 文件：docs/review/completeness-omp-diff.md 第 25 行
- 现状：「文件 + session_query（一期零工具）；recall 现禁用」
- PLAN.md 依据：U2（PLAN.md 第 78 行）「现已启用全文搜索…recall 三通道恢复」；§5 已完成项 3（第 86 行）。
- 建议修复：「recall 现禁用」改为「recall 全文搜索已启用」。

### 6. §2 魔法关键词维度：未迁移
- 文件：docs/review/completeness-omp-diff.md 第 27 行
- 现状：「未迁移（D15 殿后）」
- PLAN.md 依据：§5 已完成项 4（PLAN.md 第 87 行）魔法关键词 hook 已完成。
- 建议修复：改为「已迁移（mop-magic-keywords 入 miopiik）」。

### 7. §3 缺口 1：魔法关键词仍列缺口
- 文件：docs/review/completeness-omp-diff.md 第 34 行
- 现状：「S3 魔法关键词（D15 殿后）——三个 notice 段落 hook」
- PLAN.md 依据：§5 已完成项 4（PLAN.md 第 87 行）已完成。
- 建议修复：从剩余缺口清单删除该条。

### 8. §3 缺口 2：recall 自动化仍列缺口（低严重度，分类过时）
- 文件：docs/review/completeness-omp-diff.md 第 35 行
- 现状：「recall 自动化——已启用全文搜索（profile patch openAt: first-search，重启生效）；语义检索弃用」
- 说明：正文「已启用全文搜索」与 PLAN.md U2（第 78 行）一致，本身不是事实错误；但该条仍挂在「剩余缺口」标题下，属分类过时。
- PLAN.md 依据：U2（第 78 行）「recall 三通道恢复」，recall 已非缺口。
- 建议修复：移出「剩余缺口」或改标为已完成状态说明；「语义检索弃用」如保留，应单列为既定决策而非缺口。

### 9. §3 缺口 3：冷会话 rewind 缺真实验证
- 文件：docs/review/completeness-omp-diff.md 第 36 行
- 现状：「冷会话 rewind 实测——已实现（persistence read + seeded create），缺真实冷会话验证」
- PLAN.md 依据：§5 已完成项 8（PLAN.md 第 91 行）「真实冷会话 readFrom + create(seed) 跑通（775 事件 -> 边界 774 -> seed 775 -> 子会话）」。
- 建议修复：改为「真实冷会话实测已跑通（775 -> 774 -> 775 -> 子会话）」。

### 10. §4 一句话结论：核心空白过时
- 文件：docs/review/completeness-omp-diff.md 第 42 行
- 现状：「核心空白只剩魔法关键词（殿后）与 recall 自动化（受部署禁用限制，二期接嵌入）」
- PLAN.md 依据：§5 已完成项 4（第 87 行，魔法关键词已完成）；U2（第 78 行，recall 已启用，非受部署禁用限制）。
- 建议修复：改写结论，删除「魔法关键词」与「recall 自动化」两项空白表述；如需保留真实剩余项，应指向 PLAN.md 待办（第 98 行）的 D29 模型路由实验等待验证项。

## 一致项汇总

- completeness-omp-diff.md：一致 12 条（§1 的 S2/S4/S6/S7/S9 共 5 条；§2 的通信/监督/恢复/模型路由/loop 共 5 条；§3 的缺口 4/缺口 5 共 2 条）。另有 1 条（§2 工具面，第 28 行）无 PLAN.md 依据、无法核验，标为 [需人工复核]。
- philosophy-audit.md §1：一致 5 条（已落地/待验证/弃用/未做/定性命中 5 个分类行），无不一致。

## philosophy-audit.md §1 逐行核对结论

- 第 9 行「已落地 D1–D13、D15、D20、D21、D25–D28、D30（除 D14/D23）」：与 §5 已完成项 1–12 及 D25/D26/D27/D28/D30 对应，一致；D14、D23 明确排除，正确。
- 第 10 行「待验证 D19（-> D29）、D29」：与 PLAN.md 待办（第 98 行，D29 模型路由实验）及 D19「待验证假设」一致。
- 第 11 行「弃用 D14、D13 内 /retry」：与 D14（第 27 行，按钮方向已弃）、D13（第 26 行，/retry 弃用 = 自动重试原生）一致。
- 第 12 行「未做/可选 D23、D18」：与 D23（第 36 行，可选 S9）、§5 已完成项 2（第 85 行，run-stats 原生）一致。
- 第 13 行「定性命中 D16」：D16 为验收纪律方法论，§5 无矛盾，一致。

覆盖性备注（非不一致）：philosophy-audit.md §1 未给 D17（中介报告模式）、D22（简洁原则）、D24（规划层上下文管理）归类。因 §5 未对这三项给出与表冲突的完成状态，不构成状态不一致，仅记录为表覆盖性缺口，供规划层参考。

## 范围外备注（非本切片不一致项）

PLAN.md 内部 U2（第 78 行）写「实测 20 hits」，而 §5 已完成项 10（第 93 行）写「session_search 实测 2 hits」，两处命中数不一致。此为 PLAN.md 内部数字不一致，不在本切片（review 文档 vs PLAN.md）核验范围，标为 [需人工复核]。
