import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeviceEventEmitter } from "react-native";

// ── Shared runtime store for saved posts/videos.
//
// The web version read/wrote localStorage synchronously on every call —
// isPostSaved() and toggleSavedPost() are both called synchronously
// elsewhere in this app (e.g. `useState(() => isPostSaved(p?._id))` in
// several already-converted PostCard-style components), so this keeps
// that same synchronous call shape. AsyncStorage is async, so instead of
// hitting it directly on every read, this keeps an in-memory mirror of
// both lists that's loaded once via initSavedPostsCache() (call this
// once near app start, e.g. alongside initAuthCache()/refreshAuthCache()
// in App.js) and kept in sync with AsyncStorage on every write.
//
// window.dispatchEvent(CustomEvent(...)) has no RN equivalent — swapped
// for DeviceEventEmitter, which is the closest RN analogue for a global
// event bus reachable from outside the React tree. Event names
// ("postSaved"/"postUnsaved") and payload shapes are unchanged, so any
// other part of the app that was listening for those (if you have
// non-React code relying on them) just needs to swap
// window.addEventListener for DeviceEventEmitter.addListener.

const listeners = new Set();

let savedPostsCache = [];
let savedVideosCache = [];
let cacheLoaded = false;

export async function initSavedPostsCache() {
  try {
    const rawPosts = await AsyncStorage.getItem("savedPosts");
    const rawVideos = await AsyncStorage.getItem("savedVideos");
    savedPostsCache = rawPosts ? JSON.parse(rawPosts) : [];
    savedVideosCache = rawVideos ? JSON.parse(rawVideos) : [];
  } catch {
    savedPostsCache = [];
    savedVideosCache = [];
  } finally {
    cacheLoaded = true;
  }
}

function getCache(key) {
  return key === "savedVideos" ? savedVideosCache : savedPostsCache;
}

function setCache(key, list) {
  if (key === "savedVideos") savedVideosCache = list;
  else savedPostsCache = list;
  // Fire-and-forget persistence — callers don't await this, matching the
  // original's synchronous-feeling API.
  AsyncStorage.setItem(key, JSON.stringify(list)).catch(() => {});
}

function storageKeyFor(post) {
  return post?.postType === "video" ? "savedVideos" : "savedPosts";
}

export function isPostSaved(postId) {
  if (!postId) return false;
  if (!cacheLoaded) {
    // initSavedPostsCache() hasn't resolved yet — same fail-open
    // behavior as the web version returning false before localStorage
    // was ever read. Callers that need this correct on first paint
    // should await initSavedPostsCache() before mounting, same as this
    // app's other *Cache modules.
    console.warn("isPostSaved called before initSavedPostsCache() resolved");
  }
  return savedPostsCache.some((p) => p._id === postId) || savedVideosCache.some((v) => v._id === postId);
}

export function toggleSavedPost(post) {
  if (!post?._id) return false;
  const key = storageKeyFor(post);
  let list = getCache(key);
  const alreadySaved = list.some((item) => item._id === post._id);

  if (alreadySaved) {
    list = list.filter((item) => item._id !== post._id);
  } else {
    list = [...list, post];
  }
  setCache(key, list);

  const nextState = !alreadySaved;
  listeners.forEach((fn) => fn(post._id, nextState));

  DeviceEventEmitter.emit(
    nextState ? "postSaved" : "postUnsaved",
    nextState ? { post } : { postId: post._id, postType: post.postType }
  );

  return nextState;
}

export function subscribeSavedPosts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}