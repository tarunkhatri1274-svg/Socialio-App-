import Config from "react-native-config";
export { apiFetch, setUnauthorizedHandler } from "./authToken";
const API = Config.API_URL;

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