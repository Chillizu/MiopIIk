# 轻量模式（三档 preset）设计

> 上一级：[PLAN.md](../../PLAN.md)。对应决策 D32。原则：只给事实与验收，不给方法说教（D22）。

## 1. 结论（先读）

工具面收窄的正确命题不是「越少越好」，而是「每个 agent 的工具面 = 它的职责恰好够用」。审查层「只用 bash」否决；真瘦身空间在 prompt + 上下文。落地 = 三档 preset（miopiik-lite / miopiik / miopiik-full），不是给审查层砍工具。

## 2. 纠正「极简模式最好」

官方极简模式（持久 bash + str_replace_editor）是**基准测试用**，非生产推荐：它关上下文压缩、系统提示词固定一句话，实测者直言「日常没法用」。所以「V4 Pro 极简性能最好」的准确含义 = 裸能力在极简环境下测出，归因评测公平，非「工具少模型聪明」。可迁移的洞察：生产价值落在「删掉什么/替换什么」，K3 对照 minimal vs 全量工具面正确性 15/15 打平，只是步骤更碎。

## 3. 逐层审视

- **执行层（7 件）、监督层（6 件只读）**：已接近职责最小集；可砍的只有执行层 `todo_write`（one-shot 短命会话用 todo 意义存疑），边际收益很小。
- **审查层「只用 bash」否决**，三条：① 安全悖论——bash 是无差别管道，`cat`=read、`sed -i`=edit、`curl`=web，把所有能力藏进一个管道还丢 sandboxPolicy 对文件写的细粒度管控；瘦身减的是选择负担不是权限，别混淆两目标。② 砍掉体系在用能力——会话开首读全局记忆（read）、里程碑验收（read/grep）、小改动自处（edit）、`session_search`（recall D12）、`list_agents`/`send_message`（追踪规划层 D10）。③ D29 里 pro 优势恰在「计数/结构类」核查（审查层验收本职），工具收窄对此无收益证据。
- **真瘦身点**：四层都背着 persona 全文 + 记忆注入 + **可见工具** schema（visible 数 = 模型 token）。已实测：**toolFilter 隐藏的工具 schema 不计入上下文**——`tools.restrict()` 在 view 层过滤，`view.visible` 只含 admitted 工具，模型侧 schema 唯一来源 `systemPrompt.tools(() => wireSchemas(scope))` 从 visible 构建（证据 harness `core/tools/src/index.ts:832/984/1071` + `scoped.spec.ts`）。故减 schema token 的真杠杆 = **少挂工具行**（root 会话 visible 数），而非更狠 toolFilter——lite 档靠「不挂 subagent 行」减 token。

## 4. 三档

| 档位 | 形态 | 工具面 | 场景 |
|---|---|---|---|
| miopiik-lite | 单会话，无 subagent 行 | read/edit/write/grep/glob/bash + mop 恢复工具包 + 记忆 read | 小任务：单文件改动、问答、小脚本 |
| miopiik | 审查 + 规划 + 执行（现状） | 现有 | 中任务：多功能开发、重构 |
| miopiik-full | 四层全装 + 监督 + 授权闸全开 | 现有 + supervisor 行 | 大任务：多阶段项目、需审计链的实验 |

## 5. 关键设计点

1. 三档共享同一 persona 段落 + mop 插件；lite 无 subagent 工具行，「派发」路径自然消失（比 prompt 规则硬）= U3 场景级禁停机制化（评测开 lite preset，替代口头「不许 subagent」）。
2. mop 插件分档友好：tool-recovery/learn/capabilities 薄工具任意档可挂；model-auth 在 lite 无 subagent 可闸、空转无害。插件无需改动。
3. 升档路径写入审查层 persona：lite 会话发现任务长大（切片 >N / 需并行），提示用户「值得换 miopiik 重开」——人在环路里升档，符合 D28。

## 6. 红线（不动）

- 不动 compaction：D24 上下文管理哲学（自动压缩 + 自主 compact + 落盘先行）建在它上，砍掉后长任务规划层会上下文爆炸无声死。
- 不动 session_query / 记忆文件：D12 recall 通道 + D10 监督层可知性来源，成本极小、砍掉的安全损失极大。

## 7. 实验建议（待办）

- ~~工具 schema 是否计入上下文~~ **已实测（结论：不计入）**：toolFilter 在 view 层过滤，隐藏 schema 不进 `systemPrompt.tools`；真杠杆 = 少挂工具行（见 §3）。
- **工具面瘦身**：D29 方法跑 {现有执行 7 工具} vs {再收窄}，门 = 首轮通过率 + token；借机接 run-stats 可编程出口（D18 缺口）。
