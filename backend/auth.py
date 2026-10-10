"""Account system: register / login / Google OAuth / Email OTP / me.

Supports:
- Email + password with scrypt hashing
- Google OAuth credential verification (via google-auth & Google API)
- Email 6-digit OTP login with SMTP delivery and dev fallback
- JWT sessions with 7-day TTL
"""

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel

logger = logging.getLogger("rag.auth")

AUTH_DB_PATH = (os.getenv("AUTH_DB_PATH") or "./auth.db").strip()
TOKEN_TTL_SECONDS = int((os.getenv("TOKEN_TTL_HOURS") or "168").strip()) * 3600  # 7 days
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128

JWT_SECRET = (os.getenv("JWT_SECRET") or os.getenv("AUTH_SECRET") or "").strip()
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
    logger.warning("JWT_SECRET is not set - using a temporary secret.")

GOOGLE_CLIENT_ID = (os.getenv("GOOGLE_CLIENT_ID") or os.getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID") or "").strip()

# SMTP Configuration
SMTP_HOST = (os.getenv("SMTP_HOST") or "").strip()
SMTP_PORT = int((os.getenv("SMTP_PORT") or "587").strip())
SMTP_USER = (os.getenv("SMTP_USER") or "").strip()
SMTP_PASSWORD = (os.getenv("SMTP_PASSWORD") or "").strip()
SMTP_FROM = (os.getenv("SMTP_FROM") or SMTP_USER or "noreply@docqa.app").strip()
SMTP_CONFIGURED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
OTP_TTL_SECONDS = 600  # 10 minutes

# scrypt parameters
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
        conn.execute(
            """CREATE TABLE IF NOT EXISTS email_otps (
                   email TEXT PRIMARY KEY,
                   otp_code TEXT NOT NULL,
                   expires_at REAL NOT NULL,
                   attempts INTEGER DEFAULT 0,
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
        if "$" in stored:
            parts = stored.split("$")
            salt_bytes = bytes.fromhex(parts[-2])
            digest = hashlib.sha256(salt_bytes + password.encode()).hexdigest()
            return hmac.compare_digest(digest, parts[-1])
        return False
    except Exception:
        return False


_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))

# --------------------------------------------------------------------------- #
# Throttling
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
            raise HTTPException(429, "Too many failed attempts. Please wait a few minutes and try again.")


def _record_failure(key: str) -> None:
    with _fail_lock:
        _failures.setdefault(key, []).append(time.time())


def _clear_failures(key: str) -> None:
    with _fail_lock:
        _failures.pop(key, None)


# --------------------------------------------------------------------------- #
# Token & User Helpers
# --------------------------------------------------------------------------- #
def create_token(user_id: int | str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": str(user_id), "email": email, "iat": now, "exp": now + TOKEN_TTL_SECONDS},
        JWT_SECRET,
        algorithm="HS256",
    )


def _get_or_create_user(email: str) -> dict:
    with _db_lock, closing(_connect()) as conn, conn:
        row = conn.execute("SELECT id, email FROM users WHERE email = ?", (email,)).fetchone()
        if row is not None:
            return {"id": row["id"], "email": row["email"]}
        # Create user with a secure random dummy password hash
        dummy_hash = hash_password(secrets.token_urlsafe(32))
        cursor = conn.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (email, dummy_hash, time.time()),
        )
        return {"id": cursor.lastrowid, "email": email}


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict:
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
        logger.warning("DB lookup during auth check: %s", e)

    return {"id": sub or email, "email": email or sub}


# --------------------------------------------------------------------------- #
# Email Dispatcher
# --------------------------------------------------------------------------- #
def send_otp_email(recipient: str, otp_code: str) -> bool:
    """Send OTP code via SMTP if configured. Return True if sent via SMTP."""
    logger.info("--------------------------------------------------")
    logger.info(">>> [OTP VERIFICATION CODE for %s]: %s <<<", recipient, otp_code)
    logger.info("--------------------------------------------------")

    if not SMTP_CONFIGURED:
        logger.info("SMTP is not configured. OTP code logged above for developer/demo use.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Your DocQ&A Verification Code: {otp_code}"
        msg["From"] = f"DocQ&A <{SMTP_FROM}>"
        msg["To"] = recipient

        text_content = f"Your verification code is: {otp_code}\n\nThis code will expire in 10 minutes.\nIf you did not request this, please ignore this email."
        html_content = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0;">
          <h2 style="color: #4f46e5; margin: 0 0 16px; font-size: 24px; font-weight: 700;">DocQ&amp;A</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.5; margin: 0 0 20px;">Use the verification code below to sign in to your DocQ&amp;A account:</p>
          <div style="background: #f8fafc; border: 2px dashed #6366f1; border-radius: 12px; padding: 18px; text-align: center; margin: 0 0 24px;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1e1b4b; font-family: monospace;">{otp_code}</span>
          </div>
          <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">This code is valid for 10 minutes. If you did not request this code, no action is required.</p>
        </div>
        """
        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)

        logger.info("Sent OTP email successfully to %s", recipient)
        return True
    except Exception as exc:
        logger.exception("Failed to deliver OTP email via SMTP to %s: %s", recipient, exc)
        return False


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str


class OtpSendRequest(BaseModel):
    email: str


class OtpVerifyRequest(BaseModel):
    email: str
    otp: str


class GoogleAuthRequest(BaseModel):
    credential: str


def _normalize_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(400, "Please enter a valid email address.")
    return email


# Standard Registration
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
    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": {"id": user_id, "email": email},
    }


# Standard Password Login
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
    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": {"id": row["id"], "email": row["email"]},
    }


# OTP: Request One-Time Passcode
@router.post("/otp/send")
def send_otp(body: OtpSendRequest, request: Request):
    email = _normalize_email(body.email)
    key = _throttle_key(f"otp:{email}", request)
    _check_throttle(key)

    # 6-digit numeric OTP code
    otp_code = f"{secrets.randbelow(1000000):06d}"
    expires_at = time.time() + OTP_TTL_SECONDS

    with _db_lock, closing(_connect()) as conn, conn:
        conn.execute(
            """INSERT INTO email_otps (email, otp_code, expires_at, attempts, created_at)
               VALUES (?, ?, ?, 0, ?)
               ON CONFLICT(email) DO UPDATE SET
                   otp_code = excluded.otp_code,
                   expires_at = excluded.expires_at,
                   attempts = 0,
                   created_at = excluded.created_at""",
            (email, otp_code, expires_at, time.time()),
        )

    sent_smtp = send_otp_email(email, otp_code)
    return {
        "message": f"Verification code sent to {email}.",
        "dev_otp": None if sent_smtp else otp_code,
        "expires_in": OTP_TTL_SECONDS,
    }


# OTP: Verify and Sign In
@router.post("/otp/verify")
def verify_otp(body: OtpVerifyRequest, request: Request):
    email = _normalize_email(body.email)
    code = body.otp.strip()
    key = _throttle_key(f"otp:{email}", request)
    _check_throttle(key)

    with _db_lock, closing(_connect()) as conn, conn:
        row = conn.execute(
            "SELECT otp_code, expires_at, attempts FROM email_otps WHERE email = ?",
            (email,),
        ).fetchone()

        if row is None:
            raise HTTPException(400, "No verification code requested for this email. Request a new code.")

        if time.time() > row["expires_at"]:
            conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
            raise HTTPException(400, "Verification code has expired. Please request a new one.")

        if row["attempts"] >= 5:
            conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
            _record_failure(key)
            raise HTTPException(429, "Too many incorrect attempts. Please request a new code.")

        if not hmac.compare_digest(row["otp_code"], code):
            conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?", (email,))
            _record_failure(key)
            raise HTTPException(400, "Incorrect verification code. Please check and try again.")

        # OTP verified: delete it immediately to prevent reuse
        conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))

    _clear_failures(key)
    user = _get_or_create_user(email)
    token = create_token(user["id"], user["email"])
    logger.info("User authenticated via OTP: %s", email)

    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": user,
    }


# Google OAuth Token Verification & Login
@router.post("/google")
def google_auth(body: GoogleAuthRequest):
    credential = body.credential.strip()
    if not credential:
        raise HTTPException(400, "Google credential is required.")

    email: Optional[str] = None
    # 1. Try offline verification using google-auth library
    try:
        req = google_requests.Request()
        id_info = id_token.verify_oauth2_token(
            credential,
            req,
            audience=GOOGLE_CLIENT_ID if GOOGLE_CLIENT_ID else None,
        )
        email = id_info.get("email")
    except Exception as exc:
        logger.warning("Offline Google verification failed (%s); trying Google tokeninfo endpoint...", exc)

    # 2. Fallback to Google's tokeninfo API
    if not email:
        try:
            url = f"https://oauth2.googleapis.com/tokeninfo?id_token={credential}"
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                if GOOGLE_CLIENT_ID and data.get("aud") != GOOGLE_CLIENT_ID:
                    raise HTTPException(401, "Google token audience mismatch.")
                email = data.get("email")
        except Exception as exc:
            logger.error("Online Google token verification failed: %s", exc)
            raise HTTPException(401, "Invalid or expired Google sign-in credentials.") from exc

    if not email:
        raise HTTPException(401, "Unable to extract email from Google credential.")

    email = _normalize_email(email)
    user = _get_or_create_user(email)
    token = create_token(user["id"], user["email"])
    logger.info("User authenticated via Google: %s", email)

    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_TTL_SECONDS,
        "user": user,
    }


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "user": user,
        "email": user.get("email"),
    }
