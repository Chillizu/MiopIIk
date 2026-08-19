# 通信协议设计

> 上一级：[PLAN.md](../PLAN.md)。对应决策 D5、D7、D9、D10。DSH 通信事实：`send_message` 父→子、`report` 子→父（continuable 子另有面向父的 send_message）、`list_agents`/`interrupt_agent` 归根会话；**无兄弟直连**（无 OMP 式 IRC，树形替代）。

## 1. 拓扑

```
用户
 │
审查层（根会话，preset review）
 │  ├─ send_message ──► 规划层（continuable 子，preset planner）
 │  │                     │  ├─ 派发 ► 执行层×N（one-shot，workflow/subagent）
 │  │                     │  └─ send_message ──► 监督层（continuable 子，preset supervisor，U1）
 │  │                     │        └─ report（仅 concern 时）──► 规划层
 │  └─ list_agents(descendants) 观察整棵树；interrupt 任意卡死代理
```

- 审查层↔规划层 = 父↔子双向（send_message / report）；
- 规划层↔监督层 = 父↔子双向（默认拓扑下）；监督层沉默即通过；
- 执行层↔规划层 = 工具返回（workflow schema 化结果）+ 结束报告，无自由会话。

## 2. 消息模板（固定字段，零设计决策）

### 2.1 审查层 → 规划层（任务下达）

```
# 项目总目标
（一句话）
## 项目意图与约束
（为什么做、不做什么、1-2 条硬约束）
## 优先级排序
（必须 > 应该 > 可以）
## 验收标准
（量化门：PASS/KILL/NULL 或阈值）
## 边界
（不做的范围、禁停项、授权状态：已确认派发 / 需逐批确认）
```

### 2.2 规划层 → 执行层（见 [task-template](templates/task-template.md)）

核心：合约文件路径 + `# Target / # Change / # Acceptance` 三段式 + 项目全景摘要段 + 禁止项。

### 2.3 规划层 → 监督层（定期工作报告，见 [report-template](templates/report-template.md)）

```
[EXEC] 周期 #N <时间戳>
- 目标：本周期对照的规划目标
- 做了什么：执行动作清单
- 进展：完成/进行中/阻塞（附量化证据）
- 交付物：路径 + 验证状态
- 下一步：接下来 1 个周期的动作与预期
```

监督层默认不回复（沉默 = 路径没问题）；仅在偏离时 `report` concern（偏离定义：与验收标准矛盾 / 范围蔓延 / 反复失败同一源 / 量化门未预注册）。

### 2.4 监督层 → 规划层（仅 concern 时）

```
[CONCERN] 级别（info/warn/block）｜依据（协议条目/验收标准）
- 问题描述
- 证据（文件/行号/日志）
- 建议（改哪、怎么改）
```

### 2.5 规划层 → 审查层（里程碑汇报，D17 上游报告模式）

结构化 md：方法 / 过程 / 结果 / 证据等级（URL+日期）/ 与既有文档冲突标注 / 未完成清单。供用户转交远端高级模型评估。

## 3. 监督层可知性三通道（D10）

1. **报告推送**：规划层每周期 send_message 推送 [EXEC] 报告（主动通道）；
2. **日志读取**：监督层用 session_query 被动翻阅规划层会话日志（被动通道；U2 spike：若子代无权读父日志，本通道降级，以 1/3 通道为准）；
3. **落盘事实**：规划层把进展同步写 `.dsh/progress/current.md`（报告之外的持久事实；大内容走文件不走消息）。

## 4. 协议规则

- 大内容（>1000 字符）一律走文件引用，不走消息正文（用户 OMP 教训）；
- 每个消息带时间戳（WATCHDOG 习惯：一次消息一个时间戳）；
- 报告周期默认：每个规划周期末 + 每 N 次执行层交付后（预设默认，可调）；
- 任何人不得绕过协议直接对话（执行层无自由会话工具）。
