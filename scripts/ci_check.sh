#!/bin/sh
: <<'TAG'
/**
 * 保证：页面入口、群码、方剂 JSON 和登录脚本能被本次检查读到且结构闭合时，以 0 退出。
 * 不保证：二维码能被扫码器解码，也不保证线上页面已经更新。
 * 输入：仓库根目录下的 docs、data、auth。
 * 触发：本机核对，或 GitHub Actions 的测试作业。
 * 停止：缺文件、页面未引用群码、JSON 解析失败或 Python 语法失败时以非 0 退出。
 */
TAG

set -eu
cd "$(dirname "$0")/.."

# /**
#  * 保证：路径不存在时打印缺失并退出 1。
#  * 不保证：文件内容正确。
#  */
need() {
  if [ ! -e "$1" ]; then
    printf '缺失：%s\n' "$1" >&2
    exit 1
  fi
}

need docs/index.html
need docs/styles.css
need docs/dev.js
need docs/app.js
need docs/group-qr.jpg
need data/formulas.json
need docs/formulas.json
need auth/server.py

python3 - <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(".")
page = (root / "docs/index.html").read_text(encoding="utf-8")
needles = ("group-qr.jpg", "styles.css", "dev.js", "app.js", "btnGroup")
missing = [item for item in needles if item not in page]
if missing:
    sys.stderr.write("首页未引用：" + "、".join(missing) + "\n")
    sys.exit(1)
qr = root / "docs/group-qr.jpg"
size = qr.stat().st_size
if size < 10000:
    sys.stderr.write("群码过小：%s\n" % size)
    sys.exit(1)
for name in ("data/formulas.json", "docs/formulas.json"):
    json.loads((root / name).read_text(encoding="utf-8"))
print("页面引用齐全，群码 %s 字节，方剂 JSON 可解析" % size)
PY

python3 -m py_compile auth/server.py
printf '%s\n' "登录脚本语法通过"
