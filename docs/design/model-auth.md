# 模型授权闸（D30）

## 结论

subagent 的模型必须 ∈ **授权集**（全局默认 ∪ allowlist），否则在派发的首个 LLM 请求前硬拦并抛错。鉴权对象 = **资源（model）**，不是动作。

## 实证动机

根会话落在 kimi（配额耗尽）→ 原生 subagent 继承 kimi → 403 静默失败。要拦的不是"调用"这个动作，而是"某个未授权 model 被 subagent 拉取"。

## 闸点

`agent/request` 全局 waterfall——所有 subagent 派发路径（原生 `subagent` 工具、`workflow agent({provider,model})`、`ralph`、`mop_spawn_executor`、continuable planner/supervisor）的每次 LLM 请求都在此汇合，payload 带 `agent`（`session.header.origin === 'subagent'` 判定），`next()` 返回即将用的 `{provider, model}`。throw 被 agent-loop `kick` 吞掉且不触发 `llm-retry`（后者只监听 `agent/request-error`），干净终止子 turn 并回报父 agent。

## 规则

1. 非 subagent（主会话）不拦——用户自选模型自担。
2. `config.provider/model` 缺失不拦。
3. key `provider/model` ∈ {默认模型, allowlist} → 放行；否则 throw 含授权指引。

## 数据

- allowlist：`~/.dsh/memory/global/model-allowlist.md`，每行 `provider/model`（支持 `#` 注释、`- ` list）。初始预置 `deepseek-official/deepseek-v4-pro`（planner 预设）。
- 默认模型：`ctx.get('agentDefaultModel').currentSelection()`。
- 读缓存于内存（首次读 + 授权后刷新），避免每 request 读盘。

## 工具

- `mop_model_authorize(provider, model)`：追加 allowlist（幂等）。
- `mop_model_list()`：显示默认 + allowlist。

## 落地（v1）

单包 `@chillizu/mop-model-auth`，inject `tools`。28 单测过（含闸放行/拦截/主会话豁免/授权幂等/列表）。

## 边界

- kimi 配额耗尽属**运行时额度问题**，不是授权问题：闸挡"未授权拉取"，不治"已授权但没钱"。授权后仍 403 时，错误原样回报（证据），不静默降级。
- planner 预设 pro 需预置进 allowlist（否则被拦）。
