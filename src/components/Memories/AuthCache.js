import AsyncStorage from "@react-native-async-storage/async-storage";

// ── ONE shared in-memory token/user cache, used by every component that
// needs synchronous access to the current auth token (AsyncStorage itself
// is async, so components can't just call it inline inside a header
// builder). Every screen/component must import from THIS file — do not
// re-declare a local `cachedToken` in individual files, or you'll end up
// with multiple independent caches that silently stay null, sending
// "Authorization: Bearer null" to the API (→ backend "jwt malformed").
//
// Call refreshAuthCache() once, right after login/signup succeeds and
// after logout (to clear it), and optionally once on app boot after
// restoring a persisted session. Everything else just imports the
// getters/header helpers below.

let cachedToken = null;
let cachedUser = {};

export async function refreshAuthCache() {
  try {
    cachedToken = await AsyncStorage.getItem("token");
    const raw = await AsyncStorage.getItem("user");
    cachedUser = raw && raw !== "undefined" && raw !== "null" ? JSON.parse(raw) : {};
  } catch {
    cachedToken = null;
    cachedUser = {};
  }
}

export function clearAuthCache() {
  cachedToken = null;
  cachedUser = {};
}

export const getCachedToken = () => cachedToken;
export const getCachedUser = () => cachedUser || {};

// Plain header (no Content-Type) — use for multipart/form-data requests
// where fetch needs to set its own boundary (file uploads etc).
export const authHeader = () => ({ Authorization: `Bearer ${cachedToken}` });

// JSON header — use for normal GET/POST/PUT JSON requests.
export const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${cachedToken}`,
});