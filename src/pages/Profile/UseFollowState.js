import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";
// ─────────────────────────────────────────────────────────────────────────
// Global follow store (React Native version).
//
// Same 3-state status map as the web version: 'following' | 'requested' |
// 'none'. The only structural difference from the web store is how
// persistence works:
//
// - localStorage is synchronous; AsyncStorage is NOT. So the in-memory
//   globalStatusMap is now the only synchronous source of truth, and it
//   starts EMPTY until loadPersistedStore() finishes reading AsyncStorage
//   on app boot. Call loadPersistedStore() once, early (e.g. in your root
//   App component's useEffect), before relying on getFollowStatus etc.
//   Every read/write function here still works synchronously against the
//   in-memory map either way — persistence to disk just happens in the
//   background afterward.
// - No "storage" event / cross-tab sync — RN only ever runs one instance
//   of the app, so that whole cross-tab reconciliation block is dropped.
// - BACKWARD COMPATIBLE: same exported function names/signatures as the
//   web version (followingIds / isFollowing / follow / unfollow /
//   addFollowing / removeFollowing / getFollowingIds / getIsFollowing /
//   initFollowStore), so any RN screen not yet migrated to the new status
//   API keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "followingIds";       // legacy key — array of "following" ids only
const STATUS_KEY  = "followStatusMap";    // new key — { id: 'following'|'requested' }

let globalStatusMap = {};
let globalFollowingIds = [];
let listeners = [];
let hasLoadedFromStorage = false;
let loadingPromise = null;

function deriveIdsFromStatus() {
  return Object.keys(globalStatusMap).filter(
    (id) => globalStatusMap[id] === "following"
  );
}

async function saveIdsToStorage(ids) {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
}

async function saveStatusToStorage(statusMap) {
  try { await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(statusMap)); } catch {}
}

function persistAndNotify() {
  globalFollowingIds = deriveIdsFromStatus();
  // fire-and-forget — writes happen in the background, reads/renders
  // never wait on them
  saveStatusToStorage(globalStatusMap);
  saveIdsToStorage(globalFollowingIds);
  listeners.forEach((fn) => fn());
}

// ── Call this once on app boot (e.g. root App.js useEffect) before
// relying on the store. Safe to call more than once — subsequent calls
// just resolve the same in-flight/completed promise.
export function loadPersistedStore() {
  if (hasLoadedFromStorage) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const [rawIds, rawStatus] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(STATUS_KEY),
      ]);
      const legacyIds = rawIds ? JSON.parse(rawIds) : [];
      const statusMap = rawStatus ? JSON.parse(rawStatus) : {};

      // Reconcile: anything in the legacy ids-array but missing from the
      // status map (e.g. user upgraded from the old store) gets promoted
      // to 'following' in the status map too.
      let changed = false;
      for (const id of legacyIds) {
        if (statusMap[id] !== "following") {
          statusMap[id] = "following";
          changed = true;
        }
      }

      globalStatusMap = statusMap;
      globalFollowingIds = deriveIdsFromStatus();
      hasLoadedFromStorage = true;

      if (changed) await saveStatusToStorage(globalStatusMap);
      listeners.forEach((fn) => fn());
    } catch {
      // leave store empty on failure — non-fatal
      hasLoadedFromStorage = true;
    }
  })();

  return loadingPromise;
}

// ── Bulk init (e.g. after fetching /auth/profile) ──────────────────────
// Accepts either a plain array of "following" ids (legacy call shape) or
// a status map { id: status }. Anything not passed defaults to 'none'
// implicitly (i.e. just isn't in the map).
export function initFollowStore(idsOrStatusMap) {
  if (Array.isArray(idsOrStatusMap)) {
    const next = {};
    idsOrStatusMap.forEach((id) => { next[id.toString()] = "following"; });
    globalStatusMap = next;
  } else if (idsOrStatusMap && typeof idsOrStatusMap === "object") {
    const next = {};
    Object.entries(idsOrStatusMap).forEach(([id, status]) => {
      if (status === "following" || status === "requested") next[id] = status;
    });
    globalStatusMap = next;
  }
  hasLoadedFromStorage = true;
  persistAndNotify();
}

// ── Status read/write ───────────────────────────────────────────────────
export function getFollowStatus(id) {
  return globalStatusMap[id?.toString()] || "none";
}

export function setFollowStatus(id, status) {
  const s = id?.toString();
  if (!s) return;
  if (status === "none") {
    delete globalStatusMap[s];
  } else {
    globalStatusMap[s] = status;
  }
  hasLoadedFromStorage = true;
  persistAndNotify();
}

// ── Legacy boolean API (kept for old call sites) ───────────────────────
export function addFollowing(id) {
  setFollowStatus(id, "following");
}

export function removeFollowing(id) {
  setFollowStatus(id, "none");
}

export function getFollowingIds() {
  return [...globalFollowingIds];
}

export function getIsFollowing(id) {
  return getFollowStatus(id) === "following";
}

// ── New explicit helpers for the requested/private-account flow ────────
export function requestFollow(id) {
  setFollowStatus(id, "requested");
}

export function cancelRequest(id) {
  setFollowStatus(id, "none");
}

// ── Hook ─────────────────────────────────────────────────────────────────
export function useFollowStore() {
  const [, forceTick] = useState(0);
  const didKickOffLoad = useRef(false);

  useEffect(() => {
    // Safety net: if the app root never called loadPersistedStore()
    // itself, kick it off here on first mount of any consumer so the
    // store still ends up populated rather than silently staying empty.
    if (!didKickOffLoad.current) {
      didKickOffLoad.current = true;
      if (!hasLoadedFromStorage) loadPersistedStore();
    }

    const listener = () => forceTick((t) => t + 1);
    listeners.push(listener);

    // No cross-tab "storage" event equivalent in RN — a single app
    // instance means every consumer already re-renders via `listeners`
    // whenever any setFollowStatus/persistAndNotify call happens.

    return () => {
      listeners = listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const follow = useCallback((id) => setFollowStatus(id, "following"), []);
  const unfollow = useCallback((id) => setFollowStatus(id, "none"), []);
  const requestFollowCb = useCallback((id) => setFollowStatus(id, "requested"), []);
  const cancelRequestCb = useCallback((id) => setFollowStatus(id, "none"), []);
  const isFollowing = useCallback((id) => getFollowStatus(id) === "following", []);
  const isRequested = useCallback((id) => getFollowStatus(id) === "requested", []);
  const statusOf = useCallback((id) => getFollowStatus(id), []);

  return {
    // legacy shape — unchanged for old consumers
    followingIds: [...globalFollowingIds],
    follow,
    unfollow,
    isFollowing,
    // new 3-state shape
    statusMap: { ...globalStatusMap },
    statusOf,
    isRequested,
    requestFollow: requestFollowCb,
    cancelRequest: cancelRequestCb,
  };
}