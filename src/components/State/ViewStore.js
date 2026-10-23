// src/components/State/ViewStore.js
// One shared "record a view" call, so Home, ExploreReels, VideoPage etc. never
// count the same video twice in a session, and every page uses the same endpoint.
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken";

const API = Config.API_URL;
const recorded = new Set();

export async function recordPostView(postId) {
  if (!postId) return;
  const key = String(postId);
  if (recorded.has(key)) return;
  recorded.add(key);
  try {
    const res = await apiFetch(`${API}/auth/views/posts/${key}/views`, { method: "POST" });
    if (!res.ok) recorded.delete(key);
  } catch {
    recorded.delete(key);
  }
}