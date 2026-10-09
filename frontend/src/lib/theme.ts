const THEME_CHANGED_EVENT = "docqa:theme-changed";

export function getDarkModeSnapshot() {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("theme");
  return stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function subscribeTheme(callback: () => void) {
  window.addEventListener(THEME_CHANGED_EVENT, callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener(THEME_CHANGED_EVENT, callback);
    media.removeEventListener("change", callback);
  };
}

export function setDarkMode(dark: boolean) {
  localStorage.setItem("theme", dark ? "dark" : "light");
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}
