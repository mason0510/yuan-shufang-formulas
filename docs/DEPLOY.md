# 部署

三块是分开的。页面在 GitHub Pages，开方代理和留言在 Cloudflare Worker，注册、会话和 open-medical 在登录服务。密钥不进仓库。

```
改完代码
   │
   ├─ docs/ 推到 main ─────────► GitHub Pages
   ├─ backend/ wrangler deploy ► ysf-api.tap365.org
   └─ auth/server.py 换上并重启 ► progress.tap365.org
```

## 1. 页面

仓库 Settings → Pages → Deploy from a branch → `main` → `/docs`。

推送 `main` 后，GitHub 会发布 `docs/`。线上是 https://mason0510.github.io/yuan-shufang-formulas/ 。

页面里的 `app.js?v=`、`styles.css?v=` 是缓存号。改了脚本或样式，把引用它们的 HTML 版本号加一，否则访客还会拿到旧文件。

验收：打开首页，能看见开方框；`/bio.md`、`/open-medical.html` 能打开。只看到 HTTP 200 不算页面验收。

回滚：把对应提交 revert 后再推 `main`。

## 2. Worker

代码在 `backend/`。Worker 名 `yuan-shufang-cors`，用 workers-rs 编成 Wasm。`wrangler.toml` 里的构建命令是 `worker-build --release`。

线上域名 `ysf-api.tap365.org` 绑在这个 Worker 上。绑定不在 `wrangler.toml` 里。新账号要在 Cloudflare 给这个 Worker 加上该自定义域。KV 绑定 `SUPPORT` 的 id 已写在 `wrangler.toml`。

本机需要 Rust、`wasm32-unknown-unknown`、`worker-build`、Node，以及已登录的 Wrangler。

```bash
rustup target add wasm32-unknown-unknown
cargo install worker-build
cd backend
npm install
npx wrangler deploy
```

本机如果设了已经失效的 `http_proxy`，先 `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy` 再部署。否则 Wrangler 可能连不上 Cloudflare。

库外方剂密钥不要写进 `wrangler.toml`，也不要写进代码：

```bash
cd backend
npx wrangler secret put BCPM_API_KEY
```

Worker 提供：

- `GET /` 健康信息
- `POST /v1/responses`、`POST /v1/chat/completions` 转发到 `DEFAULT_UPSTREAM`
- `GET/POST /v1/support` 献花计数
- `GET/POST/DELETE /v1/comments` 留言
- `POST /v1/formulas/external` 库外方剂。没配密钥时这条不可用，开方仍走碑方库

验收：

```bash
curl -fsS https://ysf-api.tap365.org/v1/support
```

应返回带 `count` 的 JSON。

回滚：Cloudflare 控制台回到上一个 Worker 版本，或重新部署上一个 git 提交。

## 3. 登录与入库

代码在 `auth/server.py`。它只用 Python 标准库，听 `YSF_AUTH_HOST`（默认 `127.0.0.1`）和 `YSF_AUTH_PORT`（默认 `18113`）。

数据库连接从环境变量读：`PGHOST`、`PGPORT`、`PGUSER`、`PGDATABASE`，口令用 `PGPASSWORD`。这些只放服务器上的 `/etc/ysf-auth.env`，权限 `600`。不要把这个文件提交进仓库。

表结构在 `auth/ysf_tables.sql`。现有生产库是 ChainFuel 那台 Postgres 里的 `ysf_` 表，应用角色名是 `ysf_app`。这份 SQL 目前只给 `ysf_fixes` 写了授权。新库还要让 `ysf_app` 能读写 `ysf_users`、`ysf_sessions`、`ysf_chats`、`ysf_contributions`，以及这些表的 identity 序列。

systemd 单元是 `auth/ysf-auth.service`。生产上的文件在 `/opt/ysf-auth/server.py`，服务名 `ysf-auth`。`Restart=on-failure`，不要改成 `Restart=always`。

更换程序：

```bash
sudo cp -a /opt/ysf-auth/server.py /opt/ysf-auth/server.py.bak-$(date +%Y%m%d%H%M)
sudo cp auth/server.py /opt/ysf-auth/server.py
sudo systemctl restart ysf-auth
systemctl is-active ysf-auth
```

表有变更时，先备份，再把 `auth/ysf_tables.sql` 送进这台库执行。SQL 是 `IF NOT EXISTS`，重复执行不会清数据。

公网入口是 https://progress.tap365.org ，由这台机器上的 Caddy 反代到 `127.0.0.1:18113`。改 Caddy 前先备份，只追加这一站点，不要覆盖整个 Caddyfile。

```
progress.tap365.org {
  reverse_proxy 127.0.0.1:18113
}
```

接口：

- `GET /health`
- `POST /v1/auth/register`、`/v1/auth/login`、`/v1/auth/logout`、`GET /v1/auth/me`、`POST /v1/auth/profile`
- `GET/POST /v1/contributions` 登录且资料齐全才能交方子或线索
- `GET/POST/DELETE /v1/chats` 登录用户的会话
- `POST /v1/fixes` 聊天纠错。游客也可以交，登录则记下账号

验收：

```bash
curl -fsS https://progress.tap365.org/health
```

应返回正常 JSON。再用一个测试账号走注册或登录，确认之后删掉该用户和会话，不要留 `ysf-*-check` 这种测试行。

回滚：把 `server.py.bak-*` 拷回 `/opt/ysf-auth/server.py`，再 `sudo systemctl restart ysf-auth`。表可以留着。
