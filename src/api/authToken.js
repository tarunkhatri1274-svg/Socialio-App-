import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";

const API = Config.API_URL;

/* ============================================================
   STORAGE — READ
   ============================================================ */
export async function getAuthToken() {
  return await AsyncStorage.getItem("token");
}

export async function getRefreshToken() {
  return await AsyncStorage.getItem("refreshToken");
}

export async function getCachedUser() {
  const raw = await AsyncStorage.getItem("user");
  return raw && raw !== "undefined" && raw !== "null" ? JSON.parse(raw) : {};
}

/* ============================================================
   STORAGE — WRITE
   ============================================================ */
export async function saveAuthSession(data) {
  if (data?.token) await AsyncStorage.setItem("token", data.token);
  if (data?.refreshToken) await AsyncStorage.setItem("refreshToken", data.refreshToken);
  if (data?._id || data?.username || data?.email) {
    await AsyncStorage.setItem(
      "user",
      JSON.stringify({ _id: data._id, username: data.username, email: data.email })
    );
  }
}

export async function clearAuthSession() {
  await AsyncStorage.multiRemove(["token", "refreshToken", "user"]);
}
export async function updateCachedUser(user) {
  await AsyncStorage.setItem("user", JSON.stringify(user || {}));
}
/* ============================================================
   UNAUTHORIZED HANDLER — wired once in App.js
   ============================================================ */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

/* ============================================================
   REFRESH — internal, de-duped so parallel 401s don't all fire it
   ============================================================ */
let refreshPromise = null;

let onTokenRefreshed = null;
export function setTokenRefreshedHandler(fn) {
  onTokenRefreshed = fn;
}

export async function forceLogout() {
  await clearAuthSession();
  onUnauthorized?.();
}

async function doRefresh() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API}/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json();
    if (data?.success && data?.token) {
      await AsyncStorage.setItem("token", data.token);
      onTokenRefreshed?.(data.token);
      return data.token;
    }
  } catch {}
  return null;
}

/* ============================================================
   apiFetch — the only way any screen/component should call the
   backend for anything that needs auth. Handles JSON bodies AND
   FormData (file uploads) correctly, and auto-refreshes on 401.
   ============================================================ */
export async function apiFetch(url, options = {}) {
  const token = await getAuthToken();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const buildHeaders = (authToken) => ({
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  });

  let res = await fetch(url, { ...options, headers: buildHeaders(token) });

  if (res.status === 401) {
    if (!refreshPromise) refreshPromise = doRefresh().finally(() => (refreshPromise = null));
    const newToken = await refreshPromise;

    if (newToken) {
      res = await fetch(url, { ...options, headers: buildHeaders(newToken) });
    } else {
      await clearAuthSession();
      onUnauthorized?.();
    }
  }

  return res;
}

/* ============================================================
   REACT CONTEXT — merged in from AuthContext.js.
   Wrap the app once with <AuthProvider> (see App.js), then any
   component can call useAuth() to read { token, user } reactively,
   or call refreshAuth()/clearAuth() to sync state after login/logout.
   ============================================================ */
const AuthContext = createContext({
  token: null,
  user: {},
  refreshAuth: async () => {},
  clearAuth: async () => {},
});

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState({});

  const refreshAuth = useCallback(async () => {
    const t = await getAuthToken();
    setToken(t || null);
    const u = await getCachedUser();
    setUser(u);
  }, []);

  const clearAuth = useCallback(async () => {
    await clearAuthSession();
    setToken(null);
    setUser({});
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  return (
    <AuthContext.Provider value={{ token, user, refreshAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);