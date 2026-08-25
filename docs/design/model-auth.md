# 模型授权闸（D30）

## 结论

subagent 的模型必须 ∈ **授权集**（全局默认 ∪ allowlist），否则在派发的首个 LLM 请求前硬拦并抛错。鉴权对象 = **资源（model）**，不是动作。

## 实证动机

根会话落在 kimi（配额耗尽）→ 原生 subagent 继承 kimi → 403 静默失败。要拦的不是"调用"这个动作，而是"某个未授权 model 被 subagent 拉取"。

## 闸点

`agent/request` 全局 waterfall——所有 subagent 派发路径（原生 `subagent` 工具、`workflow agent({provider,model})`、`ralph`、`mop_spawn_executor`、continuable planner/supervisor）的每次 LLM 请求都在此汇合，payload 带 `agent`（`session.header.origin === 'subagent'` 判定），`next()` 返回即将用的 `{provider, model}`。throw 被 agent-loop `kick` 吞掉且不触发 `llm-retry`（后者只监听 `agent/request-error`），干净终止子 turn 并回报父 agent。

## 规则

1. 非 subagent（主会话）不拦——用户自选模型自担。
2. subagent 的 `config.provider/model` 缺失 → **fail-closed** 拒绝（INCONCLUSIVE），不静默放行（缺失 = 模型路由未成功解析，放行会让未授权模型溜进子代理）。
3. key `provider/model` ∈ {默认模型, allowlist} → 放行；否则 throw 含授权指引。

## 数据

- allowlist：`~/.dsh/memory/global/model-allowlist.md`，每行 `provider/model`（支持 `#` 注释、`- ` list）。初始预置 `deepseek-official/deepseek-v4-pro`（planner 预设）。
- 默认模型：`ctx.get('agentDefaultModel').currentSelection()`。
- 读缓存于内存（首次读 + 授权后刷新），避免每 request 读盘。
- **可信配置路径**：allowlist 是全局主机级配置（非工作区产物），故 `mop-model-auth` 直接经 `node:fs/promises` 读写、不经 DSH fs/sandboxPolicy seam。这是有意设计，不是 sandbox 绕过；工作区内的写仍受 sandbox 约束。

## 工具

- `mop_model_authorize(provider, model)`：追加 allowlist（幂等）。
- `mop_model_list()`：显示默认 + allowlist。

## 落地（v1）

单包 `@chillizu/mop-model-auth`，inject `tools`。28 单测过（含闸放行/拦截/主会话豁免/授权幂等/列表）。

## 边界

- kimi 配额耗尽属**运行时额度问题**，不是授权问题：闸挡"未授权拉取"，不治"已授权但没钱"。授权后仍 403 时，错误原样回报（证据），不静默降级。
- planner 预设 pro 需预置进 allowlist（否则被拦）。
- **自授权环**（已收口）：闸只认"当前会话是否主会话"，不认"谁在调用"——若不设防，规划层子代理自己调 `mop_model_authorize` 即可绕开 allowlist。防线上移到组合层：examples/miopiik 的 planner 行 toolFilter deny 追加 `mop_model_authorize` / `mop_model_revoke`（supervisor/executor 走 allow 面或内嵌 filter，天然不含）。授权动作只属于用户主会话；任何 preset 自带 delegation 行都应照抄这条 deny。
- **fork/rewind 会逃出闸门**（上游语义的已知边界）：`origin: 'subagent'` 只在 child-agent 创建时写入 header；上游 `sessions.fork(source, boundary?)` 的 meta 只传播 `cwd/parentSession/seedLength`，不传播 origin 与 delegationDepth。因此 mop_rewind 把 subagent 会话 fork 回检查点后，子会话 header 不再带 `origin: 'subagent'`，本闸会把它视作主会话放行。考虑到 rewind 后的会话是同源已授权上下文的延续，风险有限，作为已知边界接受；若上游未来让 fork 传播 origin，本闸无需改动即自动恢复覆盖。
