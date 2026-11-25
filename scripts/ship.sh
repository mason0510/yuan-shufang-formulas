#!/bin/sh
: <<'TAG'
/**
 * 保证：当前分支是 main 且已跟踪文件没有未提交改动时，把已提交的 main 推到 origin，不使用强推。
 * 不保证：远端拒绝、网络失败，或远端另有新提交时本次仍能发出。不改写已推送的历史。未跟踪文件不进这次推送。
 * 输入：当前 git 仓库，远端 origin，分支 main。
 * 触发：本仓库任务核对通过后执行。
 * 停止：不在 main、已跟踪文件有未提交改动、拉取冲突或推送失败时以非 0 退出。
 */
TAG

set -eu

# /**
#  * 保证：打印原因并以 1 退出。
#  * 不保证：调用方还能继续。
#  */
fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  fail "当前分支是 ${branch}，只推 main"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "已跟踪文件还有未提交改动，先提交再推"
fi

git fetch origin main
git pull --rebase origin main
git push origin main
printf '%s\n' "已推 origin main"
printf '%s\n' "https://github.com/mason0510/yuan-shufang-formulas/actions"
