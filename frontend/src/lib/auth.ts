export const AUTH_URL = (
  process.env.NEXT_PUBLIC_AUTH_URL ?? ""
).replace(/\/+$/, "");

/** Returns true when an external PHP Auth Portal URL is configured. */
export function isExternalAuthEnabled(): boolean {
  return AUTH_URL.length > 0;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin" | string;
}

export interface AuthSession {
  user: AuthUser;
  logoutToken: string;
}

const STORAGE_KEY = "docqa_auth_session_v1";
const POST_AUTH_KEY = "docqa_post_auth_view_v1";
const LOCAL_USERS_KEY = "docqa_local_users_v1";

interface LocalUserRecord {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
  salt: string;
  passwordHash: string;
}

export function getStoredAuth(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (parsed?.user?.id && parsed?.user?.email && parsed?.logoutToken) {
      return parsed;
    }
  } catch {
    // Ignore malformed sessionStorage payloads
  }
  return null;
}

export function saveStoredAuth(session: AuthSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearStoredAuth(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function savePostAuthView(target: "app" | "landing"): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(POST_AUTH_KEY, target);
  } catch {
    // Ignore storage errors
  }
}

export function consumePostAuthView(): "app" | "landing" | null {
  if (typeof window === "undefined") return null;
  try {
    const val = sessionStorage.getItem(POST_AUTH_KEY);
    sessionStorage.removeItem(POST_AUTH_KEY);
    if (val === "app" || val === "landing") return val;
  } catch {
    // Ignore storage errors
  }
  return null;
}

export async function verifySsoToken(
  token: string,
  signal?: AbortSignal
): Promise<AuthSession> {
  if (!AUTH_URL) {
    throw new Error("Auth Portal URL is not configured.");
  }

  const res = await fetch(`${AUTH_URL}/api/verify_sso.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal,
  });

  const data = (await res.json().catch(() => null)) as {
    valid?: boolean;
    user?: AuthUser;
    logout_token?: string;
    error?: string;
  } | null;

  if (!res.ok || !data?.valid || !data.user || !data.logout_token) {
    throw new Error(data?.error || "Authentication token expired or invalid.");
  }

  return {
    user: data.user,
    logoutToken: data.logout_token,
  };
}

export function getAuthLoginUrl(tab: "login" | "register" = "login"): string {
  const params = new URLSearchParams({ next: "docqa" });
  if (tab === "register") {
    params.set("tab", "register");
  }
  return `${AUTH_URL}/index.php?${params.toString()}`;
}

export function getAuthLogoutUrl(logoutToken?: string): string {
  if (!AUTH_URL) return "/";
  if (!logoutToken) {
    return `${AUTH_URL}/index.php?next=docqa`;
  }
  return `${AUTH_URL}/actions/sso_logout.php?token=${encodeURIComponent(logoutToken)}&next=docqa`;
}

/* ---------- Built-in Web Crypto fallback when AUTH_URL is unset ---------- */

async function hashWithSalt(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readLocalUsers(): LocalUserRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalUserRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalUsers(users: LocalUserRecord[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

export function validatePasswordStrength(password: string, email = ""): string[] {
  const errs: string[] = [];
  if (password.length < 8 || password.length > 72) {
    errs.push("Password must be 8–72 characters.");
  }
  if (!/[A-Z]/.test(password)) {
    errs.push("Include at least one uppercase letter.");
  }
  if (!/[a-z]/.test(password)) {
    errs.push("Include at least one lowercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    errs.push("Include at least one number.");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errs.push("Include at least one special character.");
  }
  if (email.includes("@")) {
    const local = email.split("@")[0].toLowerCase();
    if (local.length >= 3 && password.toLowerCase().includes(local)) {
      errs.push("Password must not contain your email username.");
    }
  }
  return errs;
}

export async function registerLocalUser(input: {
  name: string;
  email: string;
  password: string;
  role: "user" | "admin";
}): Promise<AuthUser> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 100) {
    throw new Error("Full name must be 2–100 characters.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Please enter a valid email address.");
  }
  const pwErrors = validatePasswordStrength(input.password, email);
  if (pwErrors.length > 0) {
    throw new Error(pwErrors[0]);
  }

  const users = readLocalUsers();
  if (users.some((u) => u.email === email)) {
    throw new Error("An account with that email already exists.");
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const passwordHash = await hashWithSalt(input.password, salt);

  const record: LocalUserRecord = {
    id: users.length > 0 ? Math.max(...users.map((u) => u.id)) + 1 : 1,
    name,
    email,
    role: input.role === "admin" ? "admin" : "user",
    salt,
    passwordHash,
  };
  writeLocalUsers([...users, record]);

  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
  };
}

export async function loginLocalUser(
  emailRaw: string,
  password: string
): Promise<AuthSession> {
  const email = emailRaw.trim().toLowerCase();
  const users = readLocalUsers();
  const found = users.find((u) => u.email === email);
  if (!found) {
    throw new Error("Invalid email or password.");
  }

  const computed = await hashWithSalt(password, found.salt);
  if (computed !== found.passwordHash) {
    throw new Error("Invalid email or password.");
  }

  return {
    user: {
      id: found.id,
      name: found.name,
      email: found.email,
      role: found.role,
    },
    logoutToken: "local",
  };
}
