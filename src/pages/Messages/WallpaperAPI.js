// src/chat/wallpaperApi.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path to this file's location
const API = Config.API_URL;

// 1:1 chats are mounted at /api/messages, groups at /api/groups — pick the
// right base depending on which kind of chat this is.
const baseUrl = (chatId, isGroup) => `${API}/${isGroup ? "groups" : "messages"}/${chatId}/wallpaper`;

export async function fetchWallpaper(chatId, isGroup) {
  let cached = null;
  try {
    const raw = await AsyncStorage.getItem(`wallpaper:${chatId}`);
    cached = raw ? JSON.parse(raw) : null;
  } catch {}

  try {
    const res = await apiFetch(baseUrl(chatId, isGroup));
    const data = await res.json();
    if (data.success) {
      await AsyncStorage.setItem(`wallpaper:${chatId}`, JSON.stringify(data.wallpaper || null));
      return data.wallpaper;
    }
  } catch (err) {
    console.log("[Wallpaper] fetch failed, using cache:", err.message);
  }
  return cached;
}

export async function saveWallpaper(chatId, isGroup, val) {
  await AsyncStorage.setItem(`wallpaper:${chatId}`, JSON.stringify(val));
  const res = await apiFetch(baseUrl(chatId, isGroup), {
    method: "PUT",
    body: JSON.stringify(val),
  });
  return res.json();
}

export async function uploadWallpaperPhoto(chatId, isGroup, asset) {
  const form = new FormData();
  form.append("photo", {
    uri: asset.uri,
    type: asset.type || "image/jpeg",
    name: asset.fileName || `wallpaper-${Date.now()}.jpg`,
  });
  const res = await apiFetch(baseUrl(chatId, isGroup), {
    method: "PUT",
    body: form, // apiFetch detects FormData and skips forcing Content-Type — boundary still set correctly
  });
  const data = await res.json();
  if (data.success) await AsyncStorage.setItem(`wallpaper:${chatId}`, JSON.stringify(data.wallpaper));
  return data;
}

export async function clearWallpaperOnServer(chatId, isGroup) {
  await AsyncStorage.removeItem(`wallpaper:${chatId}`);
  const res = await apiFetch(baseUrl(chatId, isGroup), { method: "DELETE" });
  return res.json();
}