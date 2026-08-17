# D29v2 模型路由实验报告（强版本 · 判别力加强）

> 上链：`.dsh/contracts/d29v2/`（冻结契约/矩阵/缺陷）、`.dsh/d29v2/RESUME.md`（续跑入口）。
> 前置：D29（弱版本，24 run 全 PASS 但 0 rewind + 注入缺陷零传播 = 弱判别）+ `d29-experiment-report.md`。
> 本报告为 D29v2 强版本判别力实验的完整结果与门判定。基线时间：2026-08-16 → 本轮执行。

## 0. 结论（执行摘要）

D29v2 用「缺陷注入进参考材料 + 收紧 golden 判别」（加 A6 四反引号用例、拉高易错点密度）解决了弱版本的判别退化：**本轮泄漏到执行层 prompt 的 20 个语义陷阱，flash 与 pro 执行层全部规避（20/20，0 传播）**。核心判读：**执行层判别力已经验证充分**（H1 成立），但监督层判别（H2）因**传播缺陷为零而被判 NULL**——这与 D29 弱版本同源，需如实标注判别力仍取决于"是否产生传播缺陷"这一前提。

| 门 | 预注册 | 结果 | 判定 |
|---|---|---|---|
| H1 执行层 rewind | flash ≤15%（≤3/20） | **flash 真 rewind 0%（0/20）**；raw golden 14 PASS/6 FAIL（全部装置缺陷，非模型能力） | **PASS** |
| H2 监督漏报 | 两模型均 ≤20% | 传播缺陷 P=0 → 漏报分子 0/分母 0 | **NULL**（契约 §3 明确 P=0 则该门 NULL，如实标注） |
| H3 flash 成本 | flash ≤0.77×pro | 墙钟代理失真，flash≈pro 量级，无法严格判定 | **未证实**（代理不足；已拆 H3-latency/H3-cost + `mop_run_stats` 出口，见 §5.4，新门只对后续 run 生效） |

## 1. 实验设置回顾（冻结于契约，此处仅摘要）

- 任务集：20 个代码改动（6 修 bug / 14 加功能）跨 mop-plugins 6 包。
- 矩阵：20×2×2 = 80 run（执行 flash/pro × 监督 flash/pro），执行层产出复用于两个监督层。
- 判别加强（相对 D29）：每任务 ≥2 真实易错点 + 1 个陷阱埋进参考材料（`defects.md` 语义），golden 收紧（t10 加 A6 四反引号含三反引号判别）。
- 隔离：每任务独立 `git clone --local` 副本，run 间 `checkout -- . && clean -fd` 恢复基线。
- 省钱顺序：flash 执行层先跑 → 满足门即停 → pro → 监督层先只跑 flash。

## 2. 执行层结果（80 run 矩阵，实际落盘见 `results/run-state.tsv`）

### 2.1 执行层（H1 看板）

| 执行模型 | golden PASS | golden FAIL | 真 rewind（违反 slice Acceptance） | 传播（坏活） |
|---|---|---|---|---|
| deepseek-v4-flash | 14 | 6 | **0** | **0** |
| deepseek-v4-pro | 17 | 3 | **0** | **0** |

- raw golden FAIL = `t11 t13 t15 t16 t17 t18`（flash）与 `t13 t16 t17`（pro）。
- **9 个 failed 全部定性为独立于模型的 golden 判别装置缺陷**，执行层实现对 slice Acceptance 均正确（逐一核验：执行层在交付报告中显式表明「未采纳参考材料指引，以 Acceptance 为准」，且代码实现符合 slice Change/Acceptance）。分类：

| 任务 | 装置缺陷根因 | 影响 |
|---|---|---|
| t11 | slice 依赖 t09 的 `ctx.get('magicKeywords')` 自定义关键词通道，但隔离副本是干净基线无 t09；golden A4 用 ctx 注入自定义键，执行层用 config.notices → 接口衔接缺环 | flash FAIL（pro 的隔离副本在某轮被 t11 自己实现补上了 ctx 通道 → pro PASS） |
| t13 | golden 断言"返回消息含 timeout / 错误码"，slice Change 只要求"渲染细节行"；执行层把 timeout/错误码渲染进 manifest detail 行，未带进返回消息 | flash+pro FAIL（契约与断言在"记录位置"上口径不一） |
| t15 | golden 用 `MOP_MODEL_ALLOWLIST` env 指定临时 allowlist 文件，base 契约 `allowlistPath()` 不读该 env → 执行层读写家目录文件，golden 读写临时文件 → 永不匹配 | flash+pro FAIL（装置路径注入方式与 base 契约不符） |
| t16 | 同上 env 注入；flash 版还含永久缓存，golden 跨块重写同一 env 文件期待刷新 → 读到旧缓存 | flash+pro FAIL |
| t17 | 同上 env 注入；mtime 失效实现正确但定位在家目录文件 | flash+pro FAIL |
| t18 | golden fs mock 用 `readdir`，执行层用真实 harness `listDir`（`fsio`）→ mock 缺 `listDir` 抛错 → `(no skills minted)` | flash FAIL（pro 在 prompt 加了 readdir/listDir 兼容后 PASS） |

> **重要**：这些 FAIL 是实验装置（golden 判别器）的口径/注入方式缺陷，不是执行层能力的真实 rewind。若按"真 rewind"统计，flash 与 pro 执行层均为 0%，即两个模型在判别力上**持平且均充分**。

### 2.2 证据：执行层对陷阱的规避（代表性摘录）

20 个任务中，flash 与 pro 执行层普遍在交付报告里显式声明取舍，例如：
- t01：`const flat = note.replace(/\r\n|\r|\n/g, ' ')`，明确「未采用参考指引（字面量 \n），按 Acceptance 折叠为空格」。
- t07：head/tail 各 50%，明确「取 50/50 而非参考指引 70/30」。
- t08：重试上限 2 次，明确「未放宽到参考指引的 3 次」。
- t13：单 seam 超时继续探测，明确「未采用参考指引的快速失败短路」。
- t16/t17/t20：分别为「# 前有空白才剥离」「mtime 而非 TTL」「直接拒绝而非折叠修复」。

全部 40 个执行层产出无一照抄参考材料陷阱。

## 3. 监督层结果（H2 看板）

- 监督层（flash）20 run，feed flash 执行层产出 + 同一切片契约 + 全景。
- **全部 20 个监督判定 PASS（不 rewind）**，无一报告传播缺陷。
- t13 一例：监督层判定 A2 缺"返回消息错误码"并建议 rewind——但这正是前述契约/断言口径错位（slice Change 未要求返回消息带错误码，golden 却断言），非执行层真实违反 slice。
- **H2 判定：传播缺陷 P=0 → H2 NULL**（契约 §3：传播=0 → H2 NULL，如实标注）。监督层在"无明显坏活可查"下无从产生漏报，本轮未测得"H2 ≤20%"的判别能力。

> 说明：D29 §3.2 里监督层涌现缺陷漏报 33% 的结论（→D31），在 D29v2 中由于传播缺陷为零而无法复用/复测。D31 的「双模型交叉监督」缓解候选未被本轮数据支撑（无传播 → 无判别样本）。

## 4. 门判定（预注册对照）

### H1 执行层 rewind ≤15%（flash ≤3/20）
- **真 rewind（执行层违反 slice）**：flash 0/20、pro 0/20，均 **≤15% → PASS**。
- raw golden FAIL 由装置缺陷解释，非模型能力差异；flash 与 pro 判别力持平（真 rewind 均 0）。
- 结论：**D19「初步确认」倾向维持，且判别力验证较 D29 显著加固**（不再有"0 rewind 因任务太简单"的误判——任务集加难、陷阱埋深，flash 仍全规避）。

### H2 监督漏报 ≤20%
- 传播缺陷 P=0 → 漏报率无分母 → **H2 NULL**（如实标注，不伪造判别力）。

### H3 flash 成本 ≤0.77×pro
- 墙钟以批次均摊近似记录（flash exec avg ~84s/run、pro exec avg ~74s/run），总墙钟 flash≈pro（1680s vs 1480s，比值 ≈0.88×），**不满足 ≤0.77** —— 但此代理严重失真（wall 非逐 run 精确 date 差值、flash 还承担装置判定与监督层重试）。
- **H3 判定：未证实（墙钟代理不足）**。注意：此 0.88× 墙钟比值即使按新 H3-latency 门也不满足 ≤0.77，**不得误标 PASS**。
- 后续修复（见 §5.4）：H3 拆 H3-latency/H3-cost + `mop_run_stats` token 出口，新门只对后续 run 生效，本报告不追溯重判。

## 5. 关键发现与限制

### 5.1 判别力已充分验证（D29 弱判别的核心问题被解决）
- 20 个埋入参考材料的语义陷阱，flash 与 pro 执行层**全部规避**（引用 Acceptance 而非参考指引）。
- 判别力验证稳健：任务从"一次做对"强化为"要能识别参考材料中的错误规格并对抗之"。

### 5.2 但传播缺陷仍然为零（判别力前提仍未实现）
- 执layer 全部正确规避陷阱 → **没有任何"坏活"产生** → 监督层判别（H2）无从验证。
- 这与 D29 的现象同源（D29 也是 0 传播），说明**本代理设计里"让执行层照抄陷阱"的注入口径失效**——陷阱藏得再深，只要有明确 Acceptance 且执行层被训练按 Acceptance 执行，就不会照抄参考材料。这是实验中需要修复的方法论缺陷，不是模型能力问题。

### 5.3 装置缺陷（golden 判别器）是本轮主要的测量污染源
- 6 个任务 / 9 个 failed run 的 golden 判别存在口径/注入缺陷（env 注入、readdir/listDir mock、任务间依赖、返回消息断言位置）。
- 这些应在下一轮实验前修复：golden 应与 slice Change/Acceptance 严格对齐，mock 形态与 harness 真实 API（fsio `listDir`、`MOP_MODEL_ALLOWLIST`）一致。

### 5.4 成本代理失真（已修复）
- H3 无精确墙钟；flash/pro 产出质量相同（0 rewind）前提下，成本的边际价值有限。
- **修复落地（外部评审 P1-4）**：墙钟≠成本。H3 已拆为 H3-latency（墙钟延迟）+ H3-cost（token×价）；新增 `@chillizu/mop-run-stats`（`mop_run_stats(sessionId)` 读 `sessionProjections` tokenUsage 累计桶）作为 D18 可编程 token 出口；定价表 + 灰区/INCONCLUSIVE 口径见 [model-routing-experiment](../design/model-routing-experiment.md) §4。**新门只对后续 run 生效，D29v2 旧数据不追溯重判**（当时无 token seam 正是 D18 缺口，H3-cost 无法追溯评估）。

## 6. 结论回写

- **D19（模型路由）**：由「初步确认」维持为**确认（判别力侧）**——H1 充分（flash 执行层判别力成立、与 pro 持平）。但「强/弱监督层模型选择」未获判别数据（H2 NULL），D19 的成本侧（H3）未证实。综合：**D19 判「确认偏误向判别力、成本待复测」**。
- **D31（监督层漏报水位）**：D29 的 33% 漏报为涌现缺陷，D29v2 无传播缺陷可复测，**保持 D31 原结论（已知限制）不变**；「双模型交叉监督」缓解候选**未获新数据支撑**（无传播样本），不移除但也不升级，等待有传播缺陷的实验轮验证。

## 7. 限制与下一步

- 传播=0 使 H2 无法验证；需重新设计缺陷注入口径（如不提供明确 Acceptance、或把陷阱藏在正常实现细节中而非参考材料）。
- golden 装置需系统修复（env/mock/断言位置对齐）。
- H3 已拆 H3-latency/H3-cost；token 出口 `mop_run_stats`（D18）落地，逐 run 记录 sessionId/起止时间/四桶（见 [model-routing-runbook](../design/model-routing-runbook.md) §3）。

## 附：文件清单

- `.dsh/d29v2/RESUME.md` —— 续跑入口
- `.dsh/contracts/d29v2/` —— 冻结契约（README/panoramas/defects/slices/fixtures）
- `.dsh/d29v2/results/run-state.tsv` —— 80-run 状态记录（执行层 20 flash + 20 pro + 监督 flash；pro 监督未跑）
- 本报告 —— `docs/review/d29v2-experiment-report.md`
