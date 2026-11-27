export const AUTH_URL = (
  process.env.NEXT_PUBLIC_AUTH_URL ?? ""
).replace(/\/+$/, "");

export function isAuthEnabled(): boolean {
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

export function getAuthLoginUrl(): string {
  return `${AUTH_URL}/index.php?next=docqa`;
}

export function getAuthPortalUrl(role?: string): string {
  return role === "admin"
    ? `${AUTH_URL}/admin_page.php`
    : `${AUTH_URL}/user_page.php`;
}

export function getAuthLogoutUrl(logoutToken?: string): string {
  if (!logoutToken) {
    return `${AUTH_URL}/index.php?next=docqa`;
  }
  return `${AUTH_URL}/actions/sso_logout.php?token=${encodeURIComponent(logoutToken)}&next=docqa`;
}
