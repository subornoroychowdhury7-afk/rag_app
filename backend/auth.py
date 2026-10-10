"""Account system: register / login / me, with scrypt-hashed passwords and JWT sessions.

Users live in a SQLite database (AUTH_DB_PATH).
JWT_SECRET / AUTH_SECRET is used for token signing.
Both 'token' and 'access_token' are returned in responses for full client compatibility.
"""

import hashlib
import hmac
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

logger = logging.getLogger("rag.auth")

AUTH_DB_PATH = (os.getenv("AUTH_DB_PATH") or "./auth.db").strip()
TOKEN_TTL_SECONDS = int((os.getenv("TOKEN_TTL_HOURS") or "168").strip()) * 3600  # default 7 days
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128

JWT_SECRET = (os.getenv("JWT_SECRET") or os.getenv("AUTH_SECRET") or "").strip()
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
    logger.warning(
        "JWT_SECRET is not set - using a temporary secret. "
        "Set JWT_SECRET or AUTH_SECRET in production to persist user sessions across restarts."
    )

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# scrypt parameters (memory ~16 MB per hash)
_N, _R, _P = 2 ** 14, 8, 1

# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #
_db_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(AUTH_DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    except Exception:
        pass
    return conn


def init_db() -> None:
    directory = os.path.dirname(os.path.abspath(AUTH_DB_PATH))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with _db_lock, closing(_connect()) as conn, conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS users (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   email TEXT NOT NULL UNIQUE,
                   password_hash TEXT NOT NULL,
                   created_at REAL NOT NULL
               )"""
        )


init_db()

# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        if stored.startswith("scrypt$"):
            _, n, r, p, salt_hex, digest_hex = stored.split("$")
            digest = hashlib.scrypt(
                password.encode(),
                salt=bytes.fromhex(salt_hex),
                n=int(n),
                r=int(r),
                p=int(p),
                dklen=len(digest_hex) // 2,
            )
            return hmac.compare_digest(digest.hex(), digest_hex)
        # Fallback for plain hex or sha256 hashes if any
        if "$" in stored:
            parts = stored.split("$")
            salt_bytes = bytes.fromhex(parts[-2])
            digest = hashlib.sha256(salt_bytes + password.encode()).hexdigest()
            return hmac.compare_digest(digest, parts[-1])
        return False
    except Exception:
        return False


# Used to spend uniform time on unknown emails
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))

# --------------------------------------------------------------------------- #
# Login throttling (in-memory, per email+IP): 20 failures / 15 minutes
# --------------------------------------------------------------------------- #
_FAIL_LIMIT, _FAIL_WINDOW = 20, 15 * 60
_failures: dict[str, list[float]] = {}
_fail_lock = threading.Lock()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _throttle_key(email: str, request: Request) -> str:
    ip = _get_client_ip(request)
    return f"{email}|{ip}"


def _check_throttle(key: str) -> None:
    now = time.time()
    with _fail_lock:
        recent = [t for t in _failures.get(key, []) if now - t < _FAIL_WINDOW]
        _failures[key] = recent
        if len(recent) >= _FAIL_LIMIT:
            raise HTTPException(429, "Too many failed login attempts. Please wait a few minutes and try again.")


def _record_failure(key: str) -> None:
    with _fail_lock:
        _failures.setdefault(key, []).append(time.time())


def _clear_failures(key: str) -> None:
    with _fail_lock:
        _failures.pop(key, None)


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #
def create_token(user_id: int | str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": str(user_id), "email": email, "iat": now, "exp": now + TOKEN_TTL_SECONDS},
        JWT_SECRET,
        algorithm="HS256",
    )


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
    """FastAPI dependency: returns {"id": ..., "email": ...} or raises 401."""
    unauthorized = HTTPException(
        401, "Please log in to continue.", headers={"WWW-Authenticate": "Bearer"}
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        sub = str(payload.get("sub", ""))
        email = payload.get("email", "")
        if not sub and not email:
            raise unauthorized
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            401, "Your session has expired. Please log in again.", headers={"WWW-Authenticate": "Bearer"}
        ) from None
    except Exception:
        raise unauthorized from None

    try:
        with closing(_connect()) as conn:
            row = conn.execute(
                "SELECT id, email FROM users WHERE id = ? OR email = ?",
                (sub, email),
            ).fetchone()
            if row is not None:
                return {"id": str(row["id"]), "email": row["email"]}
    except Exception as e:
        logger.warning("DB lookup during auth check failed: %s", e)

    # If DB was reset on ephemeral instance restart but token is validly signed with JWT_SECRET:
    return {"id": sub or email, "email": email or sub}


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str


def _normalize_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(400, "Please enter a valid email address.")
    return email


@router.post("/register")
def register(body: Credentials, request: Request):
    email = _normalize_email(body.email)
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LEN} characters.")
    if len(body.password) > MAX_PASSWORD_LEN:
        raise HTTPException(400, f"Password must be at most {MAX_PASSWORD_LEN} characters.")

    password_hash = hash_password(body.password)
    try:
        with _db_lock, closing(_connect()) as conn, conn:
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
                (email, password_hash, time.time()),
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists. Try logging in.") from None

    token = create_token(user_id, email)
    logger.info("Registered user %s (%s)", user_id, email)
    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": {"id": user_id, "email": email},
    }


@router.post("/login")
def login(body: Credentials, request: Request):
    email = _normalize_email(body.email)
    key = _throttle_key(email, request)
    _check_throttle(key)

    with closing(_connect()) as conn:
        row = conn.execute(
            "SELECT id, email, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    password_ok = verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH)
    if row is None or not password_ok:
        _record_failure(key)
        raise HTTPException(401, "Incorrect email or password.")

    _clear_failures(key)
    token = create_token(row["id"], row["email"])
    logger.info("User logged in: %s", email)
    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": {"id": row["id"], "email": row["email"]},
    }


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "user": user,
        "email": user.get("email"),
    }
