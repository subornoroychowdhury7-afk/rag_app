const TOKEN_KEYS = ["docqa_token", "docqa.access_token", "auth_token"];
const EMAIL_KEYS = ["docqa_email", "docqa.email", "auth_email"];
export const AUTH_CHANGED_EVENT = "docqa:auth-changed";
export const AUTH_UNAUTHORIZED_EVENT = "auth:unauthorized";

export function setAuthSession(token: string, email: string) {
  if (typeof window === "undefined") return;
  try {
    for (const key of TOKEN_KEYS) {
      localStorage.setItem(key, token);
      sessionStorage.setItem(key, token);
    }
    for (const key of EMAIL_KEYS) {
      localStorage.setItem(key, email);
      sessionStorage.setItem(key, email);
    }
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {}
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of TOKEN_KEYS) {
      const val = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (val) return val;
    }
  } catch {}
  return null;
}

export function getAuthEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of EMAIL_KEYS) {
      const val = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (val) return val;
    }
  } catch {}
  return null;
}

export function getAuthEmailSnapshot(): string | null {
  if (typeof window === "undefined" || !getAuthToken()) return null;
  return getAuthEmail();
}

export function subscribeAuthSession(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AUTH_CHANGED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  try {
    for (const key of TOKEN_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
    for (const key of EMAIL_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  } catch {}
}
