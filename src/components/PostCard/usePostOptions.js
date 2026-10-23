// src/components/PostCard/usePostOptions.js
//
// ONE place for every "⋮" menu action on a post / video / text post:
//   Owner:     Delete, Hide from non-followers / Show to everyone, Remove collab
//   Non-owner: Not Interested / Interested, Block, Remove myself as collaborator
//
// Used by Post.js, Video.js, TextPostView.js, and the cards inside
// HomePage.js / ExplorePage.js / ExploreReels.js / UserProfileVideoPost.js.
// Add or change an option HERE and it changes everywhere.
//
// Every request logs "[POST_OPTIONS] METHOD path -> status body" to logcat and
// shows an Alert on failure, so nothing fails silently any more.

import { useState, useCallback, useEffect } from "react";
import { Alert } from "react-native";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // same relative path Post.js uses
import { useBlockedIds, setBlocked } from "../State/BlockStore";

const API = Config.API_URL;

// Last value set from the ⋮ menu, per post, for the lifetime of the app session.
// Why: RN lists unmount cards that scroll off-screen, and profile screens hand the
// card a `post` object fetched earlier. Without this, a remounted card re-reads the
// stale flags from `post` and the toggle looks like it never saved.
const optionCache = new Map(); // postId -> { isHidden?, isNotInterested? }
const listeners = new Set();   // (postId, state) => void — every mounted card + list screens
const remember = (postId, patch) => {
  if (!postId) return;
  const key = String(postId);
  const next = { ...(optionCache.get(key) || {}), ...patch };
  optionCache.set(key, next);
  listeners.forEach((fn) => fn(key, next));
};
const recall = (postId) => optionCache.get(String(postId)) || {};

// Read the shared option state of a post (lists use this to filter hidden / not-interested posts).
export const getOptionState = (postId) => recall(postId);
// Be told whenever ANY page changes a post option.
export const subscribeOptionChanges = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

// Safe request: never throws, never loses the status, tolerates HTML error pages
// (e.g. Render cold-start 502/503) instead of crashing on res.json().
async function request(path, method, body) {
  try {
    const res = await apiFetch(
      `${API}${path}`,
      body ? { method, body: JSON.stringify(body) } : { method }
    );
    const text = await res.text();
    console.log(`[POST_OPTIONS] ${method} ${path} -> ${res.status}`, text.slice(0, 150));
    let data = {};
    try { data = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.log(`[POST_OPTIONS] ${method} ${path} ERROR`, err?.message);
    return { ok: false, status: 0, data: {}, networkError: err?.message || "Network error" };
  }
}

function failAlert(r) {
  Alert.alert(
    "Error",
    r.data?.message || (r.networkError ? `Network error: ${r.networkError}` : `Request failed (${r.status})`)
  );
}

export default function usePostOptions({
  post,                       // the post object (p)
  isOwner,                    // boolean
  authorId,                   // author's id (string)
  username,                   // author's username (for "Block <name>")
  noun = "post",              // "post" | "video" -> "Delete this video?"
  menu,                       // from useAnchoredMenu(); only .close() is used
  currentUserId,              // logged-in user's id (string)
  collaborators = [],         // current collaborators array of the post
  onCollaboratorsChange,      // (newCollaborators) => void   — keep your setCollaborators here
  // Optional list-level callbacks (feeds use these to drop the card from the list):
  onBlock,                    // (authorId) => void
  onDeleted,                  // (postId) => void
  onNotInterested,            // (postId) => void   — only called when turning it ON
  onHide,                     // (postId) => void   — only called when hiding
}) {
  const postId = post?._id;

  const [isHidden, setIsHidden] = useState(
    () => recall(postId).isHidden ?? (post?.isHiddenFromNonFollowers || false)
  );
  const [isNotInterested, setIsNotInterested] = useState(
    () => recall(postId).isNotInterested ?? (post?.isNotInterested || false)
  );
  // Block state is shared app-wide (BlockStore), not per card.
  const isBlocked = useBlockedIds().has(String(authorId));
  const setIsBlocked = () => {}; // kept so existing callers don't break
  const [removedFromView, setRemovedFromView] = useState(false);

  // Stay in sync with every other card / page showing the same post.
  useEffect(() => {
    if (!postId) return;
    const key = String(postId);
    const apply = (state) => {
      if (state.isHidden !== undefined) setIsHidden(state.isHidden);
      if (state.isNotInterested !== undefined) setIsNotInterested(state.isNotInterested);
    };
    const listener = (changedKey, state) => {
      if (changedKey === key) apply(state);
    };
    listeners.add(listener);
    apply(recall(postId));
    return () => listeners.delete(listener);
  }, [postId]);

  const acceptedCollaborators = (collaborators || []).filter((c) => c.status === "accepted");
  const myCollabEntry = acceptedCollaborators.find(
    (c) => (c.user?._id ?? c.user)?.toString() === currentUserId?.toString()
  );

  // ───────────────────────── handlers ─────────────────────────

  const toggleHide = useCallback(async () => {
    const r = await request(`/auth/hide-from-non-followers/${postId}`, "PATCH");
    if (!r.ok) return failAlert(r);
    setIsHidden(!!r.data.isHidden);
    remember(postId, { isHidden: !!r.data.isHidden });
    if (r.data.isHidden && onHide) onHide(postId);
    else Alert.alert("", r.data.message || (r.data.isHidden ? "Hidden from non-followers" : "Visible to everyone"));
  }, [postId, onHide]);

  const toggleNotInterested = useCallback(async () => {
    const wasOn = isNotInterested;
    const r = await request(`/auth/not-interested/${postId}`, "PATCH");
    if (!r.ok || !r.data.success) return failAlert(r);
    setIsNotInterested(!wasOn);
    remember(postId, { isNotInterested: !wasOn });
    if (!wasOn && onNotInterested) onNotInterested(postId);
    else Alert.alert("", r.data.message || (wasOn ? "Marked as interested" : "Marked as not interested"));
  }, [postId, isNotInterested, onNotInterested]);

  const blockAuthor = useCallback(async () => {
    if (isBlocked) return;
    const ok = await confirmAsync(`Block ${username}?`);
    if (!ok) return;
    const r = await request(`/auth/block/${authorId}`, "POST");
    if (!r.ok || r.data.success === false) return failAlert(r);
    setBlocked(authorId, true);
    onBlock?.(authorId?.toString());
  }, [isBlocked, username, authorId, onBlock]);

  const deletePost = useCallback(async () => {
    const ok = await confirmAsync(`Delete this ${noun}?`);
    if (!ok) return;
    const r = await request(`/auth/delete-post/${postId}`, "DELETE");
    if (!r.ok) return failAlert(r);
    setRemovedFromView(true);
    onDeleted?.(postId);
  }, [noun, postId, onDeleted]);

  const removeCollab = useCallback(
    async (collabUser) => {
      const isLeavingSelf = collabUser?._id?.toString() === currentUserId?.toString();
      const msg = isLeavingSelf
        ? "Remove yourself as a collaborator on this post? It will no longer show on your profile."
        : `Remove ${collabUser?.username} as a collaborator? The post will no longer show on their profile.`;
      const ok = await confirmAsync(msg);
      if (!ok) return;
      const r = await request(`/auth/remove-collaborator/${postId}`, "PATCH", { userId: collabUser._id });
      if (!r.ok || !r.data.success) return failAlert(r);
      onCollaboratorsChange?.(r.data.collaborators ?? []);
      if (isLeavingSelf && !isOwner) {
        setRemovedFromView(true);
        onDeleted?.(postId);
      }
    },
    [postId, currentUserId, isOwner, onCollaboratorsChange, onDeleted]
  );

  // ───────────────────────── menu options ─────────────────────────
  // Shape works for every existing menu renderer:
  //   { key, label, icon, color, danger, disabled, action }
  // action() already closes the menu, so either `opt.action()` or
  // `handleMenuAction(opt)` is fine.

  const make = (key, label, fn, extra = {}) => ({
    key,
    label,
    danger: !!extra.danger,
    disabled: !!extra.disabled,
    icon: extra.icon,
    color: extra.disabled ? "#888" : extra.danger ? "#e53935" : "#222",
    action: () => {
      menu?.close?.();
      if (!extra.disabled) fn();
    },
  });

  const options = [];
  if (isOwner) {
    options.push(make("delete", "Delete", deletePost, { danger: true, icon: "trash" }));
    options.push(
      make("hide", isHidden ? "Show to everyone" : "Hide from non-followers", toggleHide, { icon: "eye-slash" })
    );
    acceptedCollaborators.forEach((c, i) => {
      const uid = c.user?._id || c.user || i;
      options.push(
        make(`remove-${uid}`, `Remove collab: ${c.user?.username ?? "Unknown"}`, () => removeCollab(c.user), {
          danger: true,
          icon: "ban",
        })
      );
    });
  } else if (isBlocked) {
    options.push(make("blocked", "Blocked", () => {}, { disabled: true, icon: "ban" }));
  } else {
    options.push(
      make("interest", isNotInterested ? "Interested" : "Not Interested", toggleNotInterested, { icon: "thumbs-down" })
    );
    options.push(make("block", `Block ${username ?? ""}`.trim(), blockAuthor, { danger: true, icon: "ban" }));
    if (myCollabEntry) {
      options.push(
        make("leave-collab", "Remove myself as collaborator", () => removeCollab(myCollabEntry.user), {
          danger: true,
          icon: "ban",
        })
      );
    }
  }

  const handleMenuAction = (opt) => {
    if (opt.disabled) return;
    opt.action();
  };

  return {
    options,
    handleMenuAction,
    // state the card needs for rendering
    isHidden,
    isNotInterested,
    isBlocked,
    removedFromView,
    acceptedCollaborators,
    myCollabEntry,
    // raw setters, for cards that flip these from elsewhere (sockets, effects)
    setIsHidden,
    setIsNotInterested,
    setIsBlocked,
    setRemovedFromView,
    // raw handlers, if a card wants to call one directly
    toggleHide,
    toggleNotInterested,
    blockAuthor,
    deletePost,
    removeCollab,
  };
}