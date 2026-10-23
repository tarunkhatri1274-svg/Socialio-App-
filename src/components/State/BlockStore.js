// src/components/State/BlockStore.js
// App-wide source of truth for "who have I blocked". Every page reads from here,
// so blocking / unblocking on one page updates all the others instantly.
import { useState, useEffect } from "react";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken";

const API = Config.API_URL;

let blocked = new Set();
const listeners = new Set();
const emit = (id, isBlocked) => listeners.forEach((fn) => fn(id, isBlocked));

export const isUserBlocked = (id) => blocked.has(String(id));

export function subscribeBlocked(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initBlockedStore(ids = []) {
  blocked = new Set(ids.map((i) => String(i?._id ?? i)));
  emit(null, null);
}

export function setBlocked(id, isBlocked) {
  if (!id) return;
  const key = String(id);
  if (blocked.has(key) === !!isBlocked) return;
  const next = new Set(blocked);
  if (isBlocked) next.add(key);
  else next.delete(key);
  blocked = next;
  emit(key, !!isBlocked);
}

export async function loadBlockedStore() {
  try {
    const res = await apiFetch(`${API}/auth/blocked-users`);
    const data = await res.json();
    if (data.success) initBlockedStore(data.blockedUsers || []);
  } catch {}
}

export function useBlockedIds() {
  const [ids, setIds] = useState(blocked);
  useEffect(() => {
    setIds(blocked);
    return subscribeBlocked(() => setIds(blocked));
  }, []);
  return ids;
}