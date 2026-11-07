#!/usr/bin/env python3
"""Visitor register and login for 袁淑芳.

Stores rows in the shared ChainFuel Postgres database, tables prefixed ysf_.
The database password comes from the process environment, never from this file.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$")
COUNTRIES = ("中国", "中国香港", "中国澳门", "中国台湾", "美国", "加拿大", "英国", "日本", "韩国", "新加坡", "马来西亚", "澳大利亚", "德国", "法国", "其他")
OCCUPATIONS = ("中医师", "中药师", "西医师", "医学生", "药学", "古籍整理", "文史研究", "患者或家属", "软件开发", "其他")
INTERESTS = ("古方", "碑方", "民间验方", "地方志", "妇科", "儿科", "外科", "内科", "本草", "针灸", "骨伤", "其他")
FOUND_VIA = ("搜索引擎", "GitHub", "微信", "朋友介绍", "新闻报道", "小红书", "微博", "其他")
ORIGINS = {
    "https://mason0510.github.io",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
}
SESSION_DAYS = 30


def hash_password(password: str) -> str:
    """Hash a password with scrypt.

    Guarantees: the stored string contains the salt and does not contain the password.
    Does not guarantee: the same password produces the same string twice.
    """
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384${salt.hex()}${digest.hex()}"


def password_ok(password: str, stored: str) -> bool:
    """Check a password against a stored scrypt string.

    Guarantees: a malformed stored string returns False.
    Does not guarantee: timing is identical for unknown users. Callers still answer 401.
    """
    try:
        scheme, rounds, salt_hex, digest_hex = stored.split("$", 3)
        if scheme != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expect = bytes.fromhex(digest_hex)
        got = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=int(rounds), r=8, p=1, dklen=len(expect))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, expect)


def psql(sql: str, variables: dict[str, str]) -> str:
    """Run one SQL statement with psql variables.

    Guarantees: values are passed as psql variables, not pasted into the SQL text.
    Does not guarantee: the statement succeeds. Raises when psql exits non-zero.
    """
    cmd = [
        "psql",
        "-h",
        os.environ["PGHOST"],
        "-p",
        os.environ.get("PGPORT", "5432"),
        "-U",
        os.environ["PGUSER"],
        "-d",
        os.environ["PGDATABASE"],
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
    ]
    for key, value in variables.items():
        cmd.extend(["-v", f"{key}={value}"])
    env = os.environ.copy()
    result = subprocess.run(cmd, input=sql, capture_output=True, text=True, env=env, timeout=8)
    if result.returncode != 0:
        lines = [line.strip() for line in result.stderr.splitlines() if line.strip()]
        error = next((line for line in lines if line.startswith("ERROR")), lines[-1] if lines else "psql failed")
        raise RuntimeError(error)
    return result.stdout.strip()


def clean_email(raw: str) -> str:
    """Normalize an email. Empty string means it is not acceptable.

    Guarantees: the result is lowercase and matches EMAIL_RE, or is empty.
    Does not guarantee: the mailbox exists.
    """
    email = (raw or "").strip().lower()
    if len(email) > 80 or not EMAIL_RE.match(email):
        return ""
    return email


def clean_name(raw: str) -> str:
    """Keep a short display name.

    Guarantees: no control characters, at most 16 characters.
    Does not guarantee: the name is unique.
    """
    text = "".join(ch for ch in (raw or "") if ord(ch) >= 32 and ch != "\x7f").strip()
    return text[:16]


def clean_choice(raw: str, allowed: tuple[str, ...]) -> str:
    """Keep one selected label.

    Guarantees: the result is one of allowed, or empty.
    Does not guarantee: the person told the truth.
    """
    text = "".join(ch for ch in (raw or "") if ord(ch) >= 32 and ch != "\x7f").strip()
    if text in allowed:
        return text
    return ""


def clean_interests(raw) -> str:
    """Keep selected directions, joined by a comma.

    Guarantees: every stored piece is in INTERESTS. An empty result means nothing valid was chosen.
    Does not guarantee: the list matches a real specialty.
    """
    if not isinstance(raw, list):
        return ""
    picked = []
    for item in raw:
        text = clean_choice(str(item), INTERESTS)
        if text and text not in picked:
            picked.append(text)
    if not picked:
        return ""
    return ",".join(picked[:8])


def profile_from(data: dict) -> dict | None:
    """Read nationality, job, interests, and how they found the site.

    Guarantees: a returned dict has only allow-listed values.
    Does not guarantee: a partial form is accepted. Missing any field returns None.
    """
    country = clean_choice(str(data.get("country", "")), COUNTRIES)
    occupation = clean_choice(str(data.get("occupation", "")), OCCUPATIONS)
    interests = clean_interests(data.get("interests"))
    found_via = clean_choice(str(data.get("found_via", "")), FOUND_VIA)
    if not country or not occupation or not interests or not found_via:
        return None
    return {"country": country, "occupation": occupation, "interests": interests, "found_via": found_via}


def public_user(found: dict, token: str | None = None) -> dict:
    """Shape an account for the browser.

    Guarantees: the password hash is not included.
    Does not guarantee: country is filled. Older accounts can be empty until they update.
    """
    body = {
        "email": found.get("email", ""),
        "name": found.get("name", ""),
        "country": found.get("country", "") or "",
        "occupation": found.get("occupation", "") or "",
        "interests": found.get("interests", "") or "",
        "found_via": found.get("found_via", "") or "",
    }
    if token:
        body["token"] = token
    return body


def register(email: str, password: str, name: str, profile: dict) -> dict:
    """Create one visitor.

    Guarantees: a new row gets a scrypt hash, never the raw password, plus the four profile fields.
    Does not guarantee: the email was free. Duplicate raises.
    """
    stored = hash_password(password)
    row = psql(
        "INSERT INTO ysf_users (email, name, password_hash, country, occupation, interests, found_via) "
        "VALUES (:'email', :'name', :'phash', :'country', :'occupation', :'interests', :'found_via') "
        "RETURNING id::text;",
        {
            "email": email,
            "name": name or "访客",
            "phash": stored,
            "country": profile["country"],
            "occupation": profile["occupation"],
            "interests": profile["interests"],
            "found_via": profile["found_via"],
        },
    )
    return {"id": row, "email": email, "name": name or "访客", **profile}


def login(email: str, password: str) -> dict | None:
    """Open a session when the password matches.

    Guarantees: a returned token is stored in ysf_sessions and expires in 30 days.
    Does not guarantee: an unknown email and a wrong password look different. Both return None.
    """
    row = psql(
        "SELECT json_build_object('id', id, 'password_hash', password_hash, 'name', name, "
        "'email', email, 'country', country, 'occupation', occupation, "
        "'interests', interests, 'found_via', found_via)::text "
        "FROM ysf_users WHERE email = :'email';",
        {"email": email},
    )
    if not row:
        return None
    found = json.loads(row)
    user_id = str(found["id"])
    stored = found["password_hash"]
    name = found["name"]
    if not password_ok(password, stored):
        return None
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
    psql(
        "INSERT INTO ysf_sessions (token, user_id, expires_at) "
        "VALUES (:'token', :'user_id'::bigint, :'expires'::timestamptz);",
        {"token": token, "user_id": user_id, "expires": expires},
    )
    return public_user(found, token)


def current_user(token: str) -> dict | None:
    """Resolve a bearer token.

    Guarantees: an expired token returns None.
    Does not guarantee: the token is still present after logout.
    """
    if not token or len(token) > 200:
        return None
    row = psql(
        "SELECT json_build_object('id', u.id, 'email', u.email, 'name', u.name, "
        "'country', u.country, 'occupation', u.occupation, 'interests', u.interests, "
        "'found_via', u.found_via)::text FROM ysf_sessions s "
        "JOIN ysf_users u ON u.id = s.user_id "
        "WHERE s.token = :'token' AND s.expires_at > now();",
        {"token": token},
    )
    if not row:
        return None
    return json.loads(row)


def clip_chat(raw: str) -> str:
    """Keep one stored turn within a fixed size.

    Guarantees: no control characters except newline and tab, and at most 8000 characters.
    Does not guarantee: the text is a complete formula.
    """
    text = "".join(ch for ch in (raw or "") if ord(ch) >= 32 or ch in "\n\t")
    return text.strip()[:8000]


def list_chats(user_id: str) -> list:
    """Return this account's turns, oldest first, at most 80.

    Guarantees: the result is a list of role and content. Does not guarantee: a turn saved a second ago is already visible.
    """
    row = psql(
        "SELECT coalesce(json_agg(json_build_object('role', role, 'content', content) ORDER BY id), '[]'::json)::text "
        "FROM (SELECT id, role, content FROM ysf_chats WHERE user_id = :'user_id'::bigint "
        "ORDER BY id DESC LIMIT 80) recent;",
        {"user_id": user_id},
    )
    found = json.loads(row or "[]")
    return found if isinstance(found, list) else []


def save_chats(user_id: str, messages: list) -> None:
    """Append user and assistant turns for one account.

    Guarantees: only the roles user and assistant are written, and each body is clipped.
    Does not guarantee: a second request with the same text is skipped.
    """
    sql = []
    variables = {"user_id": user_id}
    for index, item in enumerate(messages[:4]):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", ""))
        if role not in ("user", "assistant"):
            continue
        content = clip_chat(str(item.get("content", "")))
        if not content:
            continue
        key = f"c{index}"
        variables[key] = content
        variables[f"r{index}"] = role
        sql.append(
            "INSERT INTO ysf_chats (user_id, role, content) "
            f"VALUES (:'user_id'::bigint, :'r{index}', :'{key}');"
        )
    if not sql:
        raise ValueError("empty")
    psql("\n".join(sql), variables)


def clear_chats(user_id: str) -> None:
    """Delete every stored turn for one account. Does nothing when that account has none."""
    psql("DELETE FROM ysf_chats WHERE user_id = :'user_id'::bigint;", {"user_id": user_id})


def logout(token: str) -> None:
    """Delete one session. Does nothing when the token is unknown."""
    if not token:
        return
    psql("DELETE FROM ysf_sessions WHERE token = :'token';", {"token": token})


def update_profile(user_id: str, profile: dict) -> None:
    """Fill nationality, job, interests, and how this account found the site.

    Guarantees: only the four profile columns change.
    Does not guarantee: the account exists. A missing id updates zero rows.
    """
    psql(
        "UPDATE ysf_users SET country = :'country', occupation = :'occupation', "
        "interests = :'interests', found_via = :'found_via' WHERE id = :'user_id'::bigint;",
        {"user_id": user_id, **profile},
    )


def profile_ready(user: dict) -> bool:
    """True when the four registration answers are already stored.

    Guarantees: empty strings are not ready.
    Does not guarantee: the answers are still in today's allow-list.
    """
    return bool(user.get("country") and user.get("occupation") and user.get("interests") and user.get("found_via"))


def clip_note(raw: str, limit: int) -> str:
    """Keep one contributed field within a fixed size.

    Guarantees: no control characters except newline and tab, and at most limit characters.
    Does not guarantee: the text is a real formula.
    """
    text = "".join(ch for ch in (raw or "") if ord(ch) >= 32 or ch in "\n\t")
    return text.strip()[:limit]


def list_contributions(user_id: str) -> list:
    """Return this account's formulas and clues, newest first, at most 50.

    Guarantees: other accounts' rows are not included.
    Does not guarantee: a row saved a second ago is already visible.
    """
    row = psql(
        "SELECT coalesce(json_agg(json_build_object("
        "'id', id, 'kind', kind, 'title', title, 'body', body, 'source', source, 'at', created_at) "
        "ORDER BY id DESC), '[]'::json)::text "
        "FROM (SELECT id, kind, title, body, source, created_at FROM ysf_contributions "
        "WHERE user_id = :'user_id'::bigint ORDER BY id DESC LIMIT 50) recent;",
        {"user_id": user_id},
    )
    found = json.loads(row or "[]")
    return found if isinstance(found, list) else []


def save_contribution(user_id: str, kind: str, title: str, body: str, source: str) -> str:
    """Store one formula or one clue for this account.

    Guarantees: kind is formula or clue, and the row belongs to user_id.
    Does not guarantee: the text is medically valid, or that it joins the tombstone library.
    """
    if kind not in ("formula", "clue"):
        raise ValueError("kind")
    return psql(
        "INSERT INTO ysf_contributions (user_id, kind, title, body, source) "
        "VALUES (:'user_id'::bigint, :'kind', :'title', :'body', :'source') RETURNING id::text;",
        {"user_id": user_id, "kind": kind, "title": title, "body": body, "source": source},
    )


class Handler(BaseHTTPRequestHandler):
    """JSON auth endpoints. Does not log the request body."""

    def log_message(self, fmt: str, *args) -> None:
        return

    def _origin(self) -> str:
        origin = self.headers.get("Origin", "")
        return origin if origin in ORIGINS else "https://mason0510.github.io"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self._origin())
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self, limit: int = 4000) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > limit:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _bearer(self) -> str:
        header = self.headers.get("Authorization", "")
        if header.lower().startswith("bearer "):
            return header[7:].strip()
        return ""

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self._origin())
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._send(200, {"ok": True, "service": "ysf-auth"})
            return
        if path == "/v1/auth/me":
            user = current_user(self._bearer())
            if not user:
                self._send(401, {"error": {"message": "未登录"}})
                return
            self._send(200, public_user(user))
            return
        if path == "/v1/contributions":
            user = current_user(self._bearer())
            if not user:
                self._send(401, {"error": {"message": "登录后才能查看"}})
                return
            self._send(200, {"items": list_contributions(str(user["id"]))})
            return
        if path == "/v1/chats":
            user = current_user(self._bearer())
            if not user:
                self._send(401, {"error": {"message": "登录后才保存聊天"}})
                return
            self._send(200, {"messages": list_chats(str(user["id"]))})
            return
        self._send(404, {"error": {"message": "Not Found"}})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        data = self._read_json(80000 if path == "/v1/chats" else 4000)
        if path == "/v1/chats":
            user = current_user(self._bearer())
            if not user:
                self._send(401, {"error": {"message": "登录后才保存聊天"}})
                return
            messages = data.get("messages")
            if not isinstance(messages, list):
                self._send(400, {"error": {"message": "没有可保存的话"}})
                return
            try:
                save_chats(str(user["id"]), messages)
            except ValueError:
                self._send(400, {"error": {"message": "没有可保存的话"}})
                return
            except RuntimeError:
                self._send(500, {"error": {"message": "聊天没有写成"}})
                return
            self._send(201, {"ok": True})
            return
        if path == "/v1/auth/logout":
            logout(self._bearer())
            self._send(200, {"ok": True})
            return
        if path == "/v1/auth/profile":
            user = current_user(self._bearer())
            if not user:
                self._send(401, {"error": {"message": "未登录"}})
                return
            profile = profile_from(data)
            if not profile:
                self._send(400, {"error": {"message": "请选择国籍、职业、感兴趣的方向，以及你是怎么找到这里的"}})
                return
            try:
                update_profile(str(user["id"]), profile)
            except RuntimeError:
                self._send(500, {"error": {"message": "资料没有写成"}})
                return
            user.update(profile)
            self._send(200, public_user(user))
            return
        if path == "/v1/contributions":
            user = current_user(self._bearer())
            if not user:
                self._send(401, {"error": {"message": "登录后才能提交"}})
                return
            if not profile_ready(user):
                self._send(400, {"error": {"message": "请先补全国籍、职业、感兴趣的方向，以及你是怎么找到这里的"}})
                return
            kind = str(data.get("kind", "")).strip()
            title = clip_note(str(data.get("title", "")), 80)
            body = clip_note(str(data.get("body", "")), 4000)
            source = clip_note(str(data.get("source", "")), 200)
            if kind not in ("formula", "clue") or len(title) < 2 or len(body) < 4:
                self._send(400, {"error": {"message": "请写明是方子还是线索，并写上标题和内容"}})
                return
            try:
                new_id = save_contribution(str(user["id"]), kind, title, body, source)
            except RuntimeError:
                self._send(500, {"error": {"message": "没有写进库"}})
                return
            self._send(201, {"id": new_id})
            return
        email = clean_email(str(data.get("email", "")))
        password = str(data.get("password", ""))
        if path == "/v1/auth/register":
            if not email or len(password) < 8 or len(password) > 72:
                self._send(400, {"error": {"message": "邮箱要有效，密码至少 8 位"}})
                return
            profile = profile_from(data)
            if not profile:
                self._send(400, {"error": {"message": "请选择国籍、职业、感兴趣的方向，以及你是怎么找到这里的"}})
                return
            try:
                register(email, password, clean_name(str(data.get("name", ""))), profile)
            except RuntimeError as err:
                if "ysf_users_email_uniq" in str(err) or "duplicate key" in str(err):
                    self._send(409, {"error": {"message": "这个邮箱已经注册"}})
                    return
                self._send(500, {"error": {"message": "注册没有写成"}})
                return
            session = login(email, password)
            self._send(201, session or user)
            return
        if path == "/v1/auth/login":
            if not email or not password:
                self._send(400, {"error": {"message": "请填写邮箱和密码"}})
                return
            session = login(email, password)
            if not session:
                self._send(401, {"error": {"message": "邮箱或密码不对"}})
                return
            self._send(200, session)
            return
        self._send(404, {"error": {"message": "Not Found"}})


    def do_DELETE(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/v1/chats":
            self._send(404, {"error": {"message": "Not Found"}})
            return
        user = current_user(self._bearer())
        if not user:
            self._send(401, {"error": {"message": "登录后才保存聊天"}})
            return
        try:
            clear_chats(str(user["id"]))
        except RuntimeError:
            self._send(500, {"error": {"message": "聊天没有清空"}})
            return
        self._send(200, {"ok": True})

def main() -> None:
    """Listen on localhost. Stop when the process is killed."""
    host = os.environ.get("YSF_AUTH_HOST", "127.0.0.1")
    port = int(os.environ.get("YSF_AUTH_PORT", "18113"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
