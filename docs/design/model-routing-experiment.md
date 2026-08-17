# 模型路由实验（D29）

> 上一级：[PLAN.md](../../PLAN.md)。D19 降级为待验证假设后，本文件是预注册实验骨架（D16 纪律对 D19 的补课）。

## 1. 假设

- H1：执行层用廉价模型（deepseek-v4-flash）在固定任务集上的 rewind 率 ≤ 15%；
- H2：监督层用廉价模型的漏报率 ≤ 20%（注入缺陷 N 个，漏报 ≤ 0.2N）；
- H3-latency：flash 墙钟 ≤ 0.77 × pro 墙钟（**延迟**，不是成本）；
- H3-cost：flash token 成本 ≤ 0.77 × pro token 成本（**成本 = 各 token 桶 × 单价**，见 §4 定价表）。

> 外部评审 P1-4：旧 H3 把「墙钟」当成本是错的（墙钟≠成本）。已拆为延迟 + token 成本两门。

## 2. 方法

- 任务集：从 MiOpIIk 计划树选 5–10 个真实切片（写文件 / 改代码 / 验契约），预冻结 + golden fixtures；
- 每组跑两遍：执行层 = flash vs pro；监督层 = flash vs pro；
- 指标：rewind 率（执行层产坏活被 rewind 次数 / 总切片）、监督漏报率（注入缺陷未报 / 总缺陷）、token（`mop_run_stats` 累计桶，D18 可编程出口）、墙钟（延迟）。

## 3. 量化门（预注册）

| 门 | PASS | KILL |
|---|---|---|
| H1 执行层 rewind 率 | flash ≤ 15% | flash > 15% 且明显劣于 pro |
| H2 监督漏报率 | 两模型均 ≤ 20% | 任一 > 20% |
| H3-latency 延迟 | flash 墙钟 ≤ 0.77 × pro 墙钟 | flash 墙钟 > 0.77 × pro |
| H3-cost 成本 | flash 成本 ≤ 0.77 × pro 成本 | flash 成本 > 0.77 × pro |

- **灰区**：0.77 < 比值 < 1.0 记「未证实/需复测」，不判 PASS 也不判 KILL。
- **INCONCLUSIVE**：某 run 的 token 四桶全零（session 无 usage 记录，如失败/中止 run）→ 该 run 的 H3-cost 判 INCONCLUSIVE，不并入 PASS/KILL。

## 4. 成本口径与定价表

- **token 出口**：`mop_run_stats(sessionId)`（D18 可编程出口，`@chillizu/mop-run-stats`）返回每 run 累计四桶：uncachedInput / cacheRead / cacheWrite / output。逐 turn/step 折叠，同 step 的 usage 替换不重复计；`tokenUsage` 键缺失 = tokenMeter 未挂载（工具报错），全零桶 = 无 usage 记录（门判 INCONCLUSIVE）。
- **定价表**（DeepSeek V4 官方，2026-08-17 生效，峰谷分时，元/百万 tokens）：

| model | tier | 输入命中 | 输入未命中 | 输出 |
|---|---|---|---|---|
| deepseek-v4-flash | 闲时 | 0.05 | 1.5 | 4.5 |
| deepseek-v4-flash | 高峰 | 0.10 | 3.0 | 9.0 |
| deepseek-v4-pro | 闲时 | 0.15 | 4.5 | 13.5 |
| deepseek-v4-pro | 高峰 | 0.30 | 9.0 | 27.0 |

  - 高峰时段 9:00–14:00（北京），其余闲时；闲时 = 高峰一半。
  - **桶 → 价映射**：命中 = cacheReadTokens；未命中 = uncachedInputTokens + cacheWriteTokens（cacheWrite 归未命中价是建模假设；deepseek-official 恒为 0，pi-ai 路由需复核）；输出 = outputTokens。
  - `cost = (cacheRead × 命中价 + (uncachedInput + cacheWrite) × 未命中价 + output × 输出价) / 1e6`。
  - 两模型各档价比恒 1/3 → **同 tier、同桶 mix 时** cost 比退化为 token 比；2.31× 只是「同 mix 速算」注记，非恒等（命中/未命中/输出单价比 ≈ 1:30:90，mix 不同则偏离）。**门判一律按桶 × 价精确计算，不用速算。**
- **tier 判定**：由 run 起止时间推导（`tierOf(timestamp)`），tier 规则与定价表同源。**判定用同 tier 比较**（两 run 统一按 pro run 的 tier 或统一闲时，等价）；绝对成本按各自真实 tier 单独报告。
- **投影口径 ≠ 账单口径**：投影按 turn/step 最后 usage 计，重试中间请求 / 失败请求的已计费 token 不累计。成本为近似值，非供应商账单。

## 5. TODO

- [x] 冻结任务集 + golden fixtures（契约先行）—— 6 切片（用户勾选全选），见 `.dsh/contracts/d29/`（slices/ = 执行层三段式契约，fixtures/ = 审查层 golden，README = 矩阵/门/隔离）
- [x] 注入缺陷清单（每切片 2 个，共 12 雷）—— `.dsh/contracts/d29/defects.md`（仅审查层）
- [x] 跑双配置，记录 rewind 率 / 漏报率 / token / 墙钟 —— 24 run 完成，明细见 `.dsh/d29/results/results.md`（墙钟为粗界代理，token 不可编程采集，如实标注）
- [x] 按门判定，回写 D19 状态（待验证 → **初步确认，弱判别**）—— 全门 PASS，见 [d29-experiment-report](../../docs/review/d29-experiment-report.md)

## 6. D29v3（监督层漏报率）

D29v2 因注入缺陷传播=0 使 H2 无分母（NULL）。D29v3 的方法论 + 预注册门 + fallback 决策树见 [d29v3-experiment-design.md](d29v3-experiment-design.md)；冻结契约前必须先过其 §6 前置（golden 装置修复为阻塞项）。
