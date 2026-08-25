# MiOpIIk preset 示例（脱敏模板）

这是「MiOpIIk 三层 + 监督层」agent preset 的**脱敏、可重建模板**，镜像本机 live preset
（`${DSH_HOME}/.agent-presets/miopiik/`）。用途：新机器/新用户可据此重建完整 workflow。

脱敏边界：不包含任何 API key、模型 allowlist 内容、用户偏好或私有路径——mop 行用裸名
`dsh-miopiik-*`（经 `${DSH_HOME}/profiles/node_modules` 解析，见安装），persona 内
引用的是路径（如 `~/.dsh/memory/global/AGENTS.md`），而非其内容。真实凭据、allowlist、
用户偏好留在本机。

## 安装

先装 7 个 mop 包（二选一）：

```bash
# 推荐：bundle 方式（自动并入 profile bundles，可被 dsh plugin list/remove 管理）
dsh plugin --profile web add \
  link:./packages/dsh-miopiik-tool-recovery \
  link:./packages/dsh-miopiik-executor \
  link:./packages/dsh-miopiik-magic-keywords \
  link:./packages/dsh-miopiik-model-auth \
  link:./packages/dsh-miopiik-capabilities \
  link:./packages/dsh-miopiik-learn \
  link:./packages/dsh-miopiik-run-stats

# 或：免发布等价做法——把包放到 ${DSH_HOME}/profiles/dsh-miopiik-*，并在
# ${DSH_HOME}/profiles/node_modules/ 下建同名 symlink（裸名才能解析，无 scope）：
#   for p in dsh-miopiik-tool-recovery dsh-miopiik-executor dsh-miopiik-magic-keywords dsh-miopiik-model-auth \
#            dsh-miopiik-capabilities dsh-miopiik-learn dsh-miopiik-run-stats; do
#     ln -sfn "${DSH_HOME}/profiles/$p" "${DSH_HOME}/profiles/node_modules/$p"
#   done
```

然后把本目录复制为 preset：

```bash
cp -r examples/miopiik "${DSH_HOME}/.agent-presets/miopiik"
```

重启 dsh 后 `standingKeyFor('miopiik')` 验证挂载。

## 最小 smoke task（无凭据）

在 `miopiik` 会话跑一遍以下提示，验证四层闭环的最小面（不触发真实 LLM 派发外部服务）：

> 调用 `mop_probe_capabilities` 生成能力清单，读回 `.dsh/memory/capabilities.md`；
> 然后 `mop_checkpoint(label="smoke", note=<git rev-parse HEAD>)`；
> 再 `mop_checkpoint_list` 确认该 checkpoint 已落盘。汇报 status（OK/DEGRADED）与
> checkpoint 行。

预期：manifest 带 `status: OK/DEGRADED`；checkpoint 出现在 `.dsh/memory/checkpoints.md`。

## 与仓库的边界

本示例 + `packages/`（7 插件）+ 主 README 组合起来才是「可重建的 MiOpIIk 插件层」。
监督/规划/执行层 persona 的定稿源在 [`docs/design/presets/drafts/`](../../docs/design/presets/drafts/)
（`executor.prompt.md` 逐字同步进 `dsh-miopiik-executor`，其余由 persona-sync 测试保持一致）。
改任一处须同步对应源，否则 `npm test` 的 persona-sync 用例失败。
