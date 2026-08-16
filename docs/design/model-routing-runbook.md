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
- token：审查层从 session telemetry（run-stats，原生 trajectory）补录；执行层与脚本不采集。
- 墙钟：审查层逐 run 记录（`date +%s`）。
- 隔离：run 间由审查层基线清理（删除上一 run 产出、恢复基线）；s4/s5 只读切片产出独立报告文件，天然隔离。

## 4. 判定流程

量化门（与 [model-routing-experiment.md](model-routing-experiment.md) §3 逐字一致）：

| 门 | PASS | KILL |
|---|---|---|
| 执行层 rewind 率 | flash ≤ 15% | flash > 15% 且明显劣于 pro |
| 监督漏报率 | 两模型均 ≤ 20% | 任一 > 20% |
| 成本 | flash 成本 ≤ 0.77 × pro 成本 | flash 成本 ≥ pro 成本 |

成本门补充（母文档 §1 H3）：总成本（token + 墙钟）flash 至少低于 pro 30%，倍率 ≥ 1.3×。

步骤：
1. 前置检查：确认基线（6 切片产出均不存在），从恢复点开始（当前 = s1 exec-flash 首跑）。
2. 顺序执行：审查层按 s1 → s6 顺序，每切片按 exec-flash×sup-flash → exec-flash×sup-pro → exec-pro×sup-flash → exec-pro×sup-pro 跑 4 个 run。
3. 每 run 记录：run id / rewind（Y/N）/ 漏报缺陷 / token / 墙钟。
4. run 间清理：删除上一 run 产出文件，恢复基线；s4/s5 产出独立报告文件，天然隔离。
5. 汇总判定：24 run 完成后，按上表逐门判定 PASS / KILL。
6. 回写：判定结果回写 PLAN.md 中 D19 状态（待验证 → 已确认 / 推翻）。

## 5. 结果报告模板

逐 run 记录表（24 行，每 run 一行）：

| run id | 切片 | 执行层 | 监督层 | rewind | 漏报缺陷 | token | 墙钟(s) |
|---|---|---|---|---|---|---|---|
| s1-exec-flash-sup-flash | s1 | flash | flash |  |  |  |  |

汇总判定表：

| 门 | PASS 判据 | 实测 | 判定 |
|---|---|---|---|
| 执行层 rewind 率 | flash ≤ 15% |  |  |
| 监督漏报率 | 两模型均 ≤ 20%（漏报 ≤ 0.2N） |  |  |
| 成本 | flash 成本 ≤ 0.77 × pro 成本 |  |  |

D19 回写行：`待验证 → 已确认 / 推翻`（附每门实测依据）。
