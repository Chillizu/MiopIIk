# Changelog

所有对外可见的变更记录在本文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 SemVer，7 个插件包 + 套件包 `dsh-miopiik` 采用 **lockstep 版本**（同号同发）。

## [0.1.0] - 2026-08-26

首个公开版本（npm 首发 + 市场可发现形态）。

### Added

- 7 个单职责插件包（发行名 `dsh-miopiik-<feature>`）：
  - `dsh-miopiik-tool-recovery`：checkpoint / rewind / prune / 会话级规则注入（D13/D21）。
  - `dsh-miopiik-executor`：受控一次性执行层子代理 `mop_spawn_executor`（persona + 工具白名单 + 硬超时；`Config.strict` 可去 bash/write）（D25）。
  - `dsh-miopiik-magic-keywords`：ultrathink / workflowz 正文检测 → notice 注入（D15）。
  - `dsh-miopiik-model-auth`：模型授权闸，subagent 拉模型必须 ∈ allowlist（D30）。
  - `dsh-miopiik-capabilities`：DSH seam 探测，能力清单含「在场 / 实调」双证据与环境行（D27）。
  - `dsh-miopiik-learn`：`.dsh/skills/` 技能铸造与只读枚举（D12）。
  - `dsh-miopiik-run-stats`：会话累计 token 四桶可编程出口（D18）。
- 套件包 `dsh-miopiik`：一条 `dsh plugin --profile <p> add dsh-miopiik` 插入全部 7 行；附 `dsh-miopiik-init` 初始化 miopiik 四层工作流 preset。
- `examples/miopiik/`：脱敏 agent preset 模板（三层 + 监督层工作流，planner/supervisor delegation 行 + toolFilter 边界）。

### Security

- planner delegation 行 toolFilter deny 追加 `mop_model_authorize` / `mop_model_revoke`，收口子代理自授权环。

### Changed

- **BREAKING**（相对未发布的旧本地名）：包名由 `@chillizu/mop-*` 全量改为 `dsh-miopiik-*`；工具名 `mop_*` 保持不变。迁移步骤见 README「从旧名迁移」。

[0.1.0]: https://github.com/Chillizu/mop-plugins/releases/tag/v0.1.0
