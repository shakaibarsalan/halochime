/** Only same-site relative paths, so `?next=` can't send people to another website. */
export function safeNext(next: string | null, fallback: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) {
    return fallback;
  }
  try {
    const base = "http://same-origin.invalid";
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** `path?next=...` when there is somewhere to go back to. */
export const withNext = (path: string, next: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

/** The email typed on one auth screen, handed to the next one without putting it in the URL. */
const EMAIL_KEY = "tf-auth-email";

export function rememberEmail(email: string) {
  try {
    if (email) sessionStorage.setItem(EMAIL_KEY, email);
  } catch {
    // Storage blocked: the next screen just starts empty.
  }
}

export function recallEmail(): string {
  try {
    return sessionStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}
