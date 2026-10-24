"""账号密码认证与角色（原型版）。

- 密码：PBKDF2-HMAC-SHA256 加盐哈希，无外部依赖；
- 会话：随机令牌存 SQLite（只存哈希），HttpOnly Cookie 携带；
- 角色：admin / manager / reviewer / viewer，与实施方案 §3.1 对应；
- 生产部署替换为厅统一身份（SSO/OIDC）+ RBAC，本模块接口保持不变。
"""
from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import datetime, timedelta

from . import db

ROLES = ("admin", "manager", "reviewer", "viewer")
ROLE_LABELS = {
    "admin": "管理员",
    "manager": "科研管理",
    "reviewer": "评审专家",
    "viewer": "访客",
}
SESSION_COOKIE = "yanxin_session"
SESSION_DAYS = 7
MIN_PASSWORD_LEN = 6
_DUMMY_SALT = "0" * 32


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000
    ).hex()


def _public_user(row) -> dict:
    return {
        "username": row["username"],
        "role": row["role"],
        "display_name": row["display_name"] or row["username"],
    }


def create_user(username: str, password: str, role: str, display_name: str = "") -> bool:
    username = (username or "").strip()
    if not username or len(username) > 32 or role not in ROLES or len(password or "") < MIN_PASSWORD_LEN:
        return False
    with db.connect() as conn:
        row = conn.execute(
            "SELECT username FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row:
            return False
        salt = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO users (username, password_hash, salt, role, display_name, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                username,
                _hash_password(password, salt),
                salt,
                role,
                (display_name or "").strip() or username,
                db.now(),
            ),
        )
    return True


def verify_login(username: str, password: str) -> dict | None:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", ((username or "").strip(),)
        ).fetchone()
    if not row:
        # 未知用户也执行一次等价哈希，避免用户名枚举的时序差
        _hash_password(password or "", _DUMMY_SALT)
        return None
    expected = row["password_hash"]
    actual = _hash_password(password or "", row["salt"])
    if not hmac.compare_digest(expected, actual):
        return None
    return _public_user(row)


def change_password(username: str, old_password: str, new_password: str) -> bool:
    username = (username or "").strip()
    if len(new_password or "") < MIN_PASSWORD_LEN:
        return False
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            return False
        if not hmac.compare_digest(
            row["password_hash"], _hash_password(old_password or "", row["salt"])
        ):
            return False
        salt = uuid.uuid4().hex
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE username = ?",
            (_hash_password(new_password, salt), salt, username),
        )
    return True


def delete_user_sessions(username: str) -> None:
    with db.connect() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE username = ?", ((username or "").strip(),)
        )


def create_session(username: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex
    expires = (
        datetime.now() + timedelta(days=SESSION_DAYS)
    ).isoformat(timespec="seconds")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, username, expires_at, created_at)"
            " VALUES (?, ?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), username, expires, db.now()),
        )
        # 顺手清理过期会话
        conn.execute(
            "DELETE FROM sessions WHERE expires_at < ?", (db.now(),)
        )
    return token


def resolve_session(token: str) -> dict | None:
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db.connect() as conn:
        session = conn.execute(
            "SELECT * FROM sessions WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if not session or session["expires_at"] <= db.now():
            return None
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (session["username"],)
        ).fetchone()
    return _public_user(row) if row else None


def delete_session(token: str) -> None:
    if not token:
        return
    with db.connect() as conn:
        conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (hashlib.sha256(token.encode()).hexdigest(),),
        )


def list_users() -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT username, role, display_name, created_at FROM users ORDER BY created_at"
        ).fetchall()
    return [dict(r) for r in rows]
