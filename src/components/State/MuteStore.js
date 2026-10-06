import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path to this file's location

const API = Config.API_URL;

let mutedMap = {};
const listeners = new Set();

export async function loadMutedMap() {
  try {
    const res = await apiFetch(`${API}/mute`);
    const data = await res.json();
    if (data.success) {
      mutedMap = data.muted;
      listeners.forEach((l) => l(mutedMap));
    }
  } catch {}
  return mutedMap;
}

export function getMutedMap() {
  return mutedMap;
}

export function subscribeMuted(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function toggleMuteApi(userId, type) {
  try {
    const res = await apiFetch(`${API}/mute/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ type }),
    });
    const data = await res.json();
    if (data.success) {
      mutedMap = {
        ...mutedMap,
        [userId]: { muteStory: data.muteStory, mutePost: data.mutePost, muteMessage: data.muteMessage },
      };
      listeners.forEach((l) => l(mutedMap));
    }
    return data;
  } catch (err) {
    console.log("toggleMuteApi failed:", err);
    return { success: false };
  }
}