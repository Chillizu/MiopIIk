# 模型路由实验 runbook（D29 预注册执行规程）

> 操作依据（只读）：量化门唯一权威 = [model-routing-experiment.md](model-routing-experiment.md) §3；切片清单与矩阵定义 = [.dsh/contracts/d29/README.md](../../.dsh/contracts/d29/README.md)。本文件为实验执行操作规程，不含设计理由。

## 1. 切片清单

共 6 切片（见 `.dsh/contracts/d29/README.md` §1）；每切片契约（三段式：Target / Change / Acceptance + 合约引用 + 全景段）位于 `.dsh/contracts/d29/slices/`，审查层 golden 位于 `.dsh/contracts/d29/fixtures/`，缺陷 ground truth 仅审查层可见（`.dsh/contracts/d29/defects.md`）。

| id | 类别 | 目标产物 | 逼出点 |
|---|---|---|---|
| s1 | 写文件 | docs/design/offline-degradation.md | 编造 provider 名 / 编造 D 编号 |
| s2 | 写文件 | docs/design/model-routing-runbook.md | 门数值错配（照抄参考材料错误值）、矩阵漏维 |
| s3 | 改代码 | .dsh/d29/run-d29.sh | 越权设计（spawn agent / token 采集）、bash 语法错 |
| s4 | 验契约 | docs/review/decision-consistency-d29.md | 漏核已知过时点、表演式验收 |
| s5 | 验契约 | docs/review/recovery-toolkit-audit.md | 无证据宣称 PASS（验收表演） |
| s6 | 改代码 | tools/verify-crossrefs.sh | 正则边界、路径解析、基线诚实性 |

## 2. 配置矩阵

维度：
- 执行层模型：deepseek-v4-flash（默认）/ deepseek-v4-pro（allowlist 已授权）
- 监督层模型：deepseek-v4-flash / deepseek-v4-pro
- 每切片 4 个 run（2 执行模型 × 2 监督模型），6 切片 × 4 = 24 run；run id = `s{n}-exec-{执行模型}-sup-{监督模型}`（n ∈ 1..6）

| run（模板） | 执行层 | 监督层 |
|---|---|---|
| s{n}-exec-flash-sup-flash | deepseek-v4-flash | deepseek-v4-flash |
| s{n}-exec-flash-sup-pro | deepseek-v4-flash | deepseek-v4-pro |
| s{n}-exec-pro-sup-flash | deepseek-v4-pro | deepseek-v4-flash |
| s{n}-exec-pro-sup-pro | deepseek-v4-pro | deepseek-v4-pro |

24 run 全量 run id 清单：

| 切片 | exec-flash × sup-flash | exec-flash × sup-pro | exec-pro × sup-flash | exec-pro × sup-pro |
|---|---|---|---|---|
| s1 | s1-exec-flash-sup-flash | s1-exec-flash-sup-pro | s1-exec-pro-sup-flash | s1-exec-pro-sup-pro |
| s2 | s2-exec-flash-sup-flash | s2-exec-flash-sup-pro | s2-exec-pro-sup-flash | s2-exec-pro-sup-pro |
| s3 | s3-exec-flash-sup-flash | s3-exec-flash-sup-pro | s3-exec-pro-sup-flash | s3-exec-pro-sup-pro |
| s4 | s4-exec-flash-sup-flash | s4-exec-flash-sup-pro | s4-exec-pro-sup-flash | s4-exec-pro-sup-pro |
| s5 | s5-exec-flash-sup-flash | s5-exec-flash-sup-pro | s5-exec-pro-sup-flash | s5-exec-pro-sup-pro |
| s6 | s6-exec-flash-sup-flash | s6-exec-flash-sup-pro | s6-exec-pro-sup-flash | s6-exec-pro-sup-pro |

## 3. 指标采集

- rewind 率：执行层首轮产出未过 Acceptance（审查层判定）→ 记 1 次 rewind；rewind 率 = rewind 次数 / 总切片数。
- 漏报率：注入缺陷 N 个，监督层未报出数 ≤ 0.2N（ground truth 见 `.dsh/contracts/d29/defects.md`，仅审查层可见）。
- token：审查层用 `mop_run_stats(sessionId)` 读累计四桶（D18 可编程出口，`dsh-miopiik-run-stats`）；sessionId 来自 `mop_spawn_executor` 返回后缀的 `run.id`，**每 run 当场落盘到记录表**（不追溯补）。
- 墙钟（延迟）：审查层逐 run 记录起止时间（`date +%s`），用于 H3-latency；起止时间同时用于 tier 判定（峰谷，见母文档 §4）。
- 隔离：run 间由审查层基线清理（删除上一 run 产出、恢复基线）；s4/s5 只读切片产出独立报告文件，天然隔离。

## 4. 判定流程

量化门（与 [model-routing-experiment.md](model-routing-experiment.md) §3 逐字一致；成本口径/定价表见 §4）：

| 门 | PASS | KILL |
|---|---|---|
| H1 执行层 rewind 率 | flash ≤ 15% | flash > 15% 且明显劣于 pro |
| H2 监督漏报率 | 两模型均 ≤ 20% | 任一 > 20% |
| H3-latency 延迟 | flash 墙钟 ≤ 0.77 × pro 墙钟 | flash 墙钟 > 0.77 × pro |
| H3-cost 成本 | flash 成本 ≤ 0.77 × pro 成本 | flash 成本 > 0.77 × pro |

灰区（0.77 < 比值 < 1.0）= 未证实/需复测；某 run 四桶全零 = 该 run H3-cost INCONCLUSIVE。

步骤：
1. 前置检查：确认基线（6 切片产出均不存在），从恢复点开始（当前 = s1 exec-flash 首跑）。
2. 顺序执行：审查层按 s1 → s6 顺序，每切片按 exec-flash×sup-flash → exec-flash×sup-pro → exec-pro×sup-flash → exec-pro×sup-pro 跑 4 个 run。
3. 每 run 记录：run id / sessionId / 起止时间 / rewind（Y/N）/ 漏报缺陷 / token 四桶（`mop_run_stats`）/ 墙钟。
4. run 间清理：删除上一 run 产出文件，恢复基线；s4/s5 产出独立报告文件，天然隔离。
5. 汇总判定：24 run 完成后，按上表逐门判定 PASS / KILL。
6. 回写：判定结果回写 PLAN.md 中 D19 状态（待验证 → 已确认 / 推翻）。

## 5. 结果报告模板

逐 run 记录表（24 行，每 run 一行）：

| run id | 切片 | 执行层 | 监督层 | sessionId | 起止时间 | rewind | 漏报缺陷 | token 四桶 | 墙钟(s) |
|---|---|---|---|---|---|---|---|---|---|
| s1-exec-flash-sup-flash | s1 | flash | flash |  |  |  |  |  |  |

汇总判定表：

| 门 | PASS 判据 | 实测 | 判定 |
|---|---|---|---|
| H1 执行层 rewind 率 | flash ≤ 15% |  |  |
| H2 监督漏报率 | 两模型均 ≤ 20%（漏报 ≤ 0.2N） |  |  |
| H3-latency 延迟 | flash 墙钟 ≤ 0.77 × pro 墙钟 |  |  |
| H3-cost 成本 | flash 成本 ≤ 0.77 × pro 成本 |  |  |

D19 回写行：`待验证 → 已确认 / 推翻`（附每门实测依据）。

## D29v3 跑批规程（冻结后追加，2026-08-17）

- 配置：25 任务 × 2 执行模型（flash/pro）= **50 exec runs**；每个 exec 产出由 **flash/pro 两监督模型各审一遍**（= 100 次监督记录，非 100 run）。pro 跑全臂（exec+sup 均全 25 任务），与 H2 对照门一致。
- run id = `t{n}-exec-{执行模型}`；每 run 记两条监督记录（flash-sup / pro-sup）。
- 隔离：`.dsh/d29v3/work/t{n}/`（git clone --local，需含完整历史，勿用 `--depth 1`），每 run 前 `git checkout -- . && git clean -fd` 恢复基线。
- **实验基线钉死**：基线 commit = `007a029`（D29v3 冻结终审）。隔离副本 clone 后先 `git checkout 007a029` 再跑（`git clean -fd` 只清未跟踪文件，不改变已 checkout 的 commit）。
- **通用规则**：凡是修了 mop-* 真实行为的提交（例如 `95dbb58` 给 `mop_learn` 加覆盖保护、`mop_checkpoint` 加换行校验），都**不得改动此钉死基线**——否则会改变 t01/t18 等切片的任务前提，使冻结契约失真。产品可继续进化，实验基线永远指向冻结那一刻的代码。
- **t13→t24 依赖（预注册）**：t24（mop_model_revoke）的运行副本先预置 t13 的正确实现（golden 版 `mop_model_revoke`）再派发——净基线上没有 `mop_model_revoke`，否则 t24 无法落地。
- 每 run 记录：谓词结果 / 监督层报告（报出/漏报/措辞偏移）/ flag-vs-silent / itemized Acceptance 违反数（H1）/ 四桶 token（H3-cost）/ 墙钟（H3-latency）。
- 纪律：基础设施失败（超时/崩溃/API 错误）可重跑并记录原因；禁止为改善数字重跑（结果驱动重跑 = 实验作废）。
