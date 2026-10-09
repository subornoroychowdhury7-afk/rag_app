const TOKEN_KEY = "docqa.access_token";
const EMAIL_KEY = "docqa.email";
const AUTH_CHANGED_EVENT = "docqa:auth-changed";

export function setAuthSession(token: string, email: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EMAIL_KEY, email);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function getAuthToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getAuthEmail() {
  return sessionStorage.getItem(EMAIL_KEY);
}

export function getAuthEmailSnapshot() {
  if (typeof window === "undefined" || !getAuthToken()) return null;
  return getAuthEmail();
}

export function subscribeAuthSession(callback: () => void) {
  window.addEventListener(AUTH_CHANGED_EVENT, callback);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, callback);
}

export function clearAuthSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EMAIL_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
