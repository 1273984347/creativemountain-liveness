#!/usr/bin/env bash
# 创界山·活人认证 — 设计链路归档打包脚本
# 用途：① 列出归档路径清单 + 校验存在 + 体积；② 加 --pack 打成一个不含 node_modules·dist 的 tar.gz
# 用法： bash spark-output/archive-package.sh          # 仅清单预览
#        bash spark-output/archive-package.sh --pack   # 生成压缩包
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 归档路径清单（相对仓库根）
PATHS=(
  spark-output/README-归档索引.md
  spark-output/README-归档索引.html
  spark-output/archive-package.sh
  spark-output/dashboard.html
  spark-output/context
  spark-output/brief
  spark-output/journey
  spark-output/stories
  spark-output/sitemap
  spark-output/check
  spark-output/edge
  spark-output/qa
  spark-output/retro
  creativemountain-host/src
  creativemountain-host/vite.config.js
  creativemountain-host/index.html
  creativemountain-host/package.json
  creativemountain-host/package-lock.json
)

# 排除（不打包）：依赖与构建产物、原型内的冗余 context 副本（根目录已留一份）
EXCLUDE=(
  creativemountain-host/node_modules
  creativemountain-host/dist
  creativemountain-host/spark-output
  node_modules
  dist
)

echo "== 归档路径清单 =="
present=0; missing=0
for p in "${PATHS[@]}"; do
  if [ -e "$p" ]; then
    sz="$(du -sh "$p" 2>/dev/null | cut -f1)"
    printf '  [OK]  %-46s %s\n' "$p" "$sz"; present=$((present+1))
  else
    printf '  [缺]  %s\n' "$p"; missing=$((missing+1))
  fi
done
echo "  → 存在 $present 项 / 缺失 $missing 项"
echo
echo "== 排除（不打包）=="
for e in "${EXCLUDE[@]}"; do echo "  - $e"; done
echo

if [ "${1:-}" = "--pack" ]; then
  OUT="creativemountain-archive-$(date +%Y%m%d).tar.gz"
  echo "== 打包 → $OUT =="
  EXARGS=()
  for e in "${EXCLUDE[@]}"; do EXARGS+=(--exclude="$e"); done
  tar "${EXARGS[@]}" -czf "$OUT" "${PATHS[@]}"
  echo "  压缩包体积：$(du -sh "$OUT" | cut -f1)"
  echo "  完成。分享/迁移该 tar.gz 即可（含上述清单路径，不含 node_modules/dist）。"
  echo "  还原后运行原型：tar xzf $OUT && cd creativemountain-host && npm install && npm run dev"
else
  echo "（仅清单预览。生成压缩包：bash spark-output/archive-package.sh --pack）"
fi
