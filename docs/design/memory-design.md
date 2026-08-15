# 记忆分级设计

> 上一级：[PLAN.md](../../PLAN.md)。对应决策 D12。目标：把 OMP 记忆体系（mnemopi：retain/recall/reflect/memory_edit + learn/manage_skill）按用户分级要求迁移到 DSH，一期零新工具（符合"DSH 哲学就够"）。

## 1. 三级记忆

| 域 | 内容（用户定义） | DSH 落位 | 读写方 |
|---|---|---|---|
| 全局记忆 | 用户偏好、用户系统信息、跨项目的系统级改动（对应 OMP `~/.omp/agent/knowledge/*.md`） | `~/.dsh/memory/global/`（user-preferences.md / system-info.md，已建） | 审查层维护；各层按需 read |
| 项目记忆 | 项目进展、思路、长期需求 | 每工作区 `.dsh/memory/`（进度/决策/待办）+ `.dsh/skills/`（DSH 项目技能发现 rank 最高）+ `.dsh/contracts/`（契约） | 规划层维护；执行层只读注入 |
| recall | 历史会话检索（"另一种会话存储"） | **DSH 已内置**：session_search / session_trace / session_event_read/search | 各层按需调用，零开发 |

## 2. 写入规则（固化自用户 AGENTS.md 分流标准）

- 全局记忆写入条件：用户偏好、系统信息、系统级改动（任何项目/任何系统层面的变更都记）；内容自包含（who/what/when/why），不依赖会话上下文。
- 项目记忆写入条件：项目进展（里程碑/决策）、思路（方向探索结论）、长期需求；相关事实批量存一条便于去重合并。
- 分流：可泛化会被复用的程序 → skill；一次性或窄场景的事实 → 记忆条目；一条教训既是事实又是程序时，learn 可同时 mint skill。
- 维护节奏：周期性清理（窄场景 skill 转记忆、同域合并、空壳删除）；"发现新信息时更新知识库，忽略知识库为耻"。

## 3. 一期实现（零新工具）

| 操作 | 方式 |
|---|---|
| 记忆写入 | 审查/规划层用 write/edit 维护知识文件（沿用用户 OMP knowledge/ 目录习惯） |
| 记忆读取 | read + grep（知识文件）；session_search/session_trace（历史会话） |
| 发现触发 | preset 规则："对话里发现新信息 → 沉淀入对应域" |
| 注入 | 审查层会话开首读 `~/.dsh/memory/global/`（已写入 persona）；规划层注入项目记忆 + 全景摘要；执行层只注入任务相关切片 |

## 4. 二期（弃用）

- 语义检索（mnemopi/bge-m3 向量）已**弃用**（用户决定）：recall 用全文搜索（FTS）达成，不做向量嵌入。

## 5. 与 OMP 的差异

OMP mnemopi（per-project-tagged、polyphonic/enhanced recall、proactive linking、recallLimit 12、injectionTokenLimit 8000）的**行为语义**保留为参考基线；DSH 一期用"文件 + session-query"达成等价能力，换取零新工具与全透明。

## 6. 现状与进度（2026-08-14）

- 全局记忆已落位 `~/.dsh/memory/global/`（user-preferences.md + system-info.md，自包含跨项目）；审查层 persona 已写"会话开首读全局记忆"。
- 项目记忆已有：工作区 `.dsh/memory/` + `.dsh/plans/` + `.dsh/contracts/` + `.dsh/progress/`（phase1/2 实测验证）。
- recall：全文搜索**已生效**（profile patch `openAt: first-search` + durable path；实测 `listSnapshots=48`、`searchSessions("MiOpIIk")=20 hits`）。早前验收失败是重启前索引空窗口，重启后重建即好。
