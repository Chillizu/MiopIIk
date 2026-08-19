# 动态 LSP 扩展设计（可选，S9）

> 上一级：[PLAN.md](../PLAN.md)。对应决策 D23。动机：用户确认"确实可以有动态 LSP"；DSH 已有 lsp seam + stdio provider + `lsp` 工具，但仅 4 个导航操作（definition / references / hover / implementation + applyEdit / didOpen 等），OMP 侧为 14 操作。

## 1. 现状（本地源码查证）

- `packages/lsp/lsp`：`ctx.lsp` seam（`LspQueryRequest/Result`、`LspProvider`、`LspError`）；
- `packages/lsp/lsp-stdio`：stdio language server provider；
- `packages/lsp/tool-lsp`：面向模型的 `lsp` 工具（无 provider 时返回结构化 `LSP_UNAVAILABLE`，schema 稳定）；
- 已支持 op：definition、references、hover、implementation。

## 2. 目标

**动态 LSP**：按项目语言自动发现并拉起 language server（stdio），在既有 seam 上扩展高价值操作，让 agent 获得"IDE 知道什么它就访问什么"的能力（OMP 特色 F3 的 DSH 版）。

## 3. 扩展清单（按价值排序，分两期）

| op | 价值 | 说明 | 期 |
|---|---|---|---|
| diagnostics（publishDiagnostics） | 高 | 编辑后立即反馈错误，配合 aside 式注入（`agent.inject()` 延迟诊断，注入前查 stale——对齐 OMP L4） | 一 |
| rename（workspace/willRenameFiles → applyEdit） | 高 | 跨文件重命名（barrel 文件/别名导入同步更新，OMP F3 卖点） | 一 |
| documentSymbol / workspace/symbol | 中 | 结构导航 | 二 |
| codeAction | 中 | 快速修复 | 二 |
| formatting | 低 | 交由项目 formatter 统一跑（执行层禁跑 formatter 的纪律不变） | 二 |

## 4. 实现要点

- Provider 按 scope 注册：每个工作区按语言（package.json/pyproject.toml/go.mod 探测）动态发现 server 配置；server 生命周期绑定会话 scope，随 plugin 卸载回收（Cordis 可逆副作用）。
- 扩展走 seam 的既有词汇（`LspQueryRequest` 增加 operation 枚举 + 对应 result 类型），不 fork seam——保持"换 provider 即换行为"的 DSH 哲学。
- 延迟诊断注入：`tools/post-execute`（或 fs 变更事件）后批量拉 diagnostics → 经 `agent.inject()` 在 turn 边界注入，注入前查文件是否已被更新编辑覆盖（stale 检查）。
- 与沙箱一致：language server 子进程经 `ctx.subprocess` 起，受同一沙箱约束。

## 5. 验收标准（本包）

- PASS：TS/Python 项目各一个：definition/references/hover/implementation 四基础 op 可用；一期 op（diagnostics/rename）可用；编辑后诊断 1 个 turn 内注入且无 stale 误报；
- KILL：无 provider 时工具必须返回 `LSP_UNAVAILABLE` 而非空结果；server 进程泄漏（session 结束必须回收）。

## 6. 备注

- 简洁原则（D22）同样适用：op 枚举与 result 类型保持最小，不在 seam 上堆 OMP 的全部 14 op，按需分期加。
- 若一期资源有限，本项整体后置——DSH 基础 4 op 已可满足多数导航需求（三桶清单里 LSP 原判"放弃"，此文档将其改为"可选自建"）。
