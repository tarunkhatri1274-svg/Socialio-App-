// services/authService.js
import Config from "react-native-config";
import { getAuthToken, getRefreshToken, saveAuthSession, clearAuthSession } from "./authToken";
const API = Config.API_URL;

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

let refreshPromise = null;

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
      await saveAuthSession({ token: data.token }); // only overwrites "token"
      return data.token;
    }
  } catch {}
  return null;
}

// Use this for every authenticated call across the whole app.
export async function apiFetch(url, options = {}) {
  const token = await getAuthToken();
  let res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    if (!refreshPromise) refreshPromise = doRefresh().finally(() => (refreshPromise = null));
    const newToken = await refreshPromise;

    if (newToken) {
      res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
          ...(options.headers || {}),
        },
      });
    } else {
      await clearAuthSession();
      onUnauthorized?.();
    }
  }

  return res;
}

// ── your existing pre-auth calls, unchanged (login/register don't need a token) ──
export const registerUser = async (username, password, email) => {
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Registration failed");
    return data;
  } catch (error) {
    throw error;
  }
};

export const loginUser = async (username, password) => {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Login failed");
    return data;
  } catch (error) {
    throw error;
  }
};