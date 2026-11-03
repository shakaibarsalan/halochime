const STORAGE_KEY = "talkfront.visitorId";
const VALID_ID = /^[A-Za-z0-9_-]{8,100}$/;

let cached: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `v_${hex}`;
}

/**
 * Random visitor id kept in localStorage so returning visitors are recognised.
 * Storage can throw (private mode, blocked cookies, sandboxed iframes): then the id lives in memory only.
 */
export function getVisitorId(): string {
  if (cached) return cached;
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    id = null;
  }
  if (!id || !VALID_ID.test(id)) {
    id = randomId();
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Works without storage; the id just won't survive a reload.
    }
  }
  cached = id;
  return id;
}
