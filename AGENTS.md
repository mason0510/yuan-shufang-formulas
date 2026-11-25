# 袁淑芳验方库

本仓库任务核对通过后，立刻执行 `scripts/ship.sh` 推 `origin main`。不要停在本地提交，不要等再说推。

推送后由 `.github/workflows/ci.yml` 测试、打包并发布页面。测试失败就不发布页面。`backend/` 变更才发布 Worker，`auth/` 变更才发布登录服务。这两路缺密钥时该作业失败，不挡住页面作业。

不强推。远端有新提交时先拉再推。
