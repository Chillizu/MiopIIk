#!/usr/bin/env bash
# tools/verify-crossrefs.sh
# 文档交叉引用校验（只读，不修改任何文件）：
#   1. docs/**/*.md 中的 D 编号引用 vs PLAN.md §2 决策表 → bad-decision-ref
#   2. docs/**/*.md 中的相对路径 .md 引用（./ 与 ../ 形式）→ 目标存在性校验 → broken-path
# 用法: verify-crossrefs.sh [PLAN.md 路径] [docs 目录]
#   缺省: 仓库根 PLAN.md 与 docs/
# 输出: 每问题一行 = 文件:行号:类型:引用内容
# 退出码: 0 = 无问题; 1 = 有问题; 2 = 用法错误
set -u

repo_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root" || exit 2

plan=${1:-docs/PLAN.md}
docs=${2:-docs}

usage() {
  echo "用法: $0 [PLAN.md 路径] [docs 目录]" >&2
  echo "缺省: 仓库根 PLAN.md 与 docs/" >&2
  exit 2
}

[ "$#" -le 2 ] || usage
[ -f "$plan" ] || usage
[ -d "$docs" ] || usage

# PLAN.md §2 决策表编号集合，形如 "1 2 3 ... 30 "
valid_set=$(awk '/^## 2\./,/^## 3\./' "$plan" \
  | grep -oE '^\| D[0-9]+' \
  | grep -oE '[0-9]+' \
  | sort -n | tr '\n' ' ')
[ -n "$valid_set" ] || usage

scan() {
  local f dir line ref num target
  while IFS= read -r -d '' f; do
    dir=$(dirname -- "$f")
    # D 编号引用: 按 token 整体提取（避免 D1 误配进 D10），再精确比对编号集合
    while IFS=: read -r line ref; do
      num=${ref#D}
      case " $valid_set " in
        *" $num "*) ;;
        *) printf '%s:%s:bad-decision-ref:%s\n' "$f" "$line" "$ref" ;;
      esac
    done < <(grep -noE 'D[0-9]+' "$f")
    # 相对路径 .md 引用: 解析目标（去锚点/标题/空白）后校验存在性
    while IFS=' ' read -r line target; do
      target=${target%%#*}
      target=${target%%\"*}
      target=${target%% *}
      if [ ! -e "$dir/$target" ]; then
        printf '%s:%s:broken-path:%s\n' "$f" "$line" "$target"
      fi
    done < <(grep -noE '\]\(\.\.?/[^)#" ]*\.md[^)]*\)' "$f" \
      | sed -E 's/^([0-9]+):.*\]\(([^)]*)\)$/\1 \2/')
  done < <(find "$docs" -name '*.md' -print0 | sort -z)
}

report=$(scan)
if [ -n "$report" ]; then
  printf '%s\n' "$report"
  exit 1
fi
exit 0
