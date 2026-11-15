// src/components/State/ViewStore.js
// Counts each post once per device (remembered across app restarts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken";

const API = Config.API_URL;
const KEY = "viewed_posts_v1";
const MAX = 3000; // keeps only the newest 3000 ids on the device

const recorded = new Set();
let loadPromise = null;

function load() {
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(KEY)
      .then((raw) => {
        try {
          JSON.parse(raw || "[]").forEach((id) => recorded.add(id));
        } catch {}
      })
      .catch(() => {});
  }
  return loadPromise;
}

function persist() {
  AsyncStorage.setItem(KEY, JSON.stringify([...recorded].slice(-MAX))).catch(() => {});
}

export async function recordPostView(postId) {
  if (!postId) return;
  const key = String(postId);
  await load();
  if (recorded.has(key)) return;
  recorded.add(key);
  try {
    const res = await apiFetch(`${API}/auth/views/posts/${key}/views`, { method: "POST" });
    if (!res.ok) {
      recorded.delete(key);
      return;
    }
    persist();
  } catch {
    recorded.delete(key);
  }
}