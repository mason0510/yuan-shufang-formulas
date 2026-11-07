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


def register(email: str, password: str, name: str) -> dict:
    """Create one visitor.

    Guarantees: a new row gets a scrypt hash, never the raw password.
    Does not guarantee: the email was free. Duplicate raises.
    """
    stored = hash_password(password)
    row = psql(
        "INSERT INTO ysf_users (email, name, password_hash) "
        "VALUES (:'email', :'name', :'phash') RETURNING id::text;",
        {"email": email, "name": name or "访客", "phash": stored},
    )
    return {"id": row, "email": email, "name": name or "访客"}


def login(email: str, password: str) -> dict | None:
    """Open a session when the password matches.

    Guarantees: a returned token is stored in ysf_sessions and expires in 30 days.
    Does not guarantee: an unknown email and a wrong password look different. Both return None.
    """
    row = psql(
        "SELECT json_build_object('id', id, 'password_hash', password_hash, 'name', name)::text "
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
    return {"token": token, "email": email, "name": name}


def current_user(token: str) -> dict | None:
    """Resolve a bearer token.

    Guarantees: an expired token returns None.
    Does not guarantee: the token is still present after logout.
    """
    if not token or len(token) > 200:
        return None
    row = psql(
        "SELECT json_build_object('email', u.email, 'name', u.name)::text FROM ysf_sessions s "
        "JOIN ysf_users u ON u.id = s.user_id "
        "WHERE s.token = :'token' AND s.expires_at > now();",
        {"token": token},
    )
    if not row:
        return None
    return json.loads(row)


def logout(token: str) -> None:
    """Delete one session. Does nothing when the token is unknown."""
    if not token:
        return
    psql("DELETE FROM ysf_sessions WHERE token = :'token';", {"token": token})


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

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > 4000:
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
            self._send(200, user)
            return
        self._send(404, {"error": {"message": "Not Found"}})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        data = self._read_json()
        if path == "/v1/auth/logout":
            logout(self._bearer())
            self._send(200, {"ok": True})
            return
        email = clean_email(str(data.get("email", "")))
        password = str(data.get("password", ""))
        if path == "/v1/auth/register":
            if not email or len(password) < 8 or len(password) > 72:
                self._send(400, {"error": {"message": "邮箱要有效，密码至少 8 位"}})
                return
            try:
                user = register(email, password, clean_name(str(data.get("name", ""))))
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


def main() -> None:
    """Listen on localhost. Stop when the process is killed."""
    host = os.environ.get("YSF_AUTH_HOST", "127.0.0.1")
    port = int(os.environ.get("YSF_AUTH_PORT", "18113"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
