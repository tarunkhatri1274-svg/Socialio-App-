import { useState, useCallback, useEffect } from "react";
import { Alert } from "react-native";
import socket from "../../sockets/Sockets";
import { apiFetch } from "../../api/authToken"; // adjust relative path
import { useFollowStore } from "./UseFollowState";
import Config from "react-native-config";
const API = Config.API_URL;
// ─────────────────────────────────────────────────────────────────────────
// useFollowAction — the ONE place that knows how to follow/unfollow/cancel
// a request and keep the global store + backend in sync. Every card-style
// component (PostCard, video screen, ExploreReels, TextPostView,
// UserProfileVideoPost, UserProfileView, Home's feed cards) should call
// this instead of hand-rolling its own fetch + setFollowState logic.
//
// Why this fixes cross-screen desync:
// Previously each file independently decided what "Follow" should do,
// and only some of them wrote into the shared store. A "Requested" state
// in particular never made it into the store at all in most files, so a
// different screen rendering the SAME author would show "Follow" again.
// Centralizing means every consumer reads/writes the identical status.
//
// RN CHANGES vs web:
// - localStorage → AsyncStorage, so authHeaders() is now async and must
//   be awaited before every fetch call.
// - window.confirm → Alert.alert with a callback; since Alert.alert has
//   no return value to await, the unfollow branch is restructured into a
//   confirm-then-continue callback instead of an early-return guard.
// ─────────────────────────────────────────────────────────────────────────
export function useFollowAction(authorId, { isPrivate, onChange } = {}) {
  const { statusOf, follow, unfollow, requestFollow, cancelRequest } = useFollowStore();
  const [busy, setBusy] = useState(false);
  const status = statusOf(authorId); // 'following' | 'requested' | 'none'

  const performFollow = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`${API}/auth/follow/${authorId}`, {
        method: "POST"
      });
      const data = await res.json();
      if (!data.success) return;

      if (isPrivate || data.requested) {
        requestFollow(authorId);
      } else {
        follow(authorId);
        onChange?.(authorId, true);
      }
    } catch (err) {
      console.error("Follow action failed:", err);
    } finally {
      setBusy(false);
    }
  }, [authorId, isPrivate, onChange, follow, requestFollow]);

  const performCancelRequest = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`${API}/auth/cancel-follow/${authorId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!data.success) return;
      cancelRequest(authorId);
    } catch (err) {
      console.error("Follow action failed:", err);
    } finally {
      setBusy(false);
    }
  }, [authorId, cancelRequest]);

  const performUnfollow = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`${API}/auth/unfollow/${authorId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!data.success) return;
      unfollow(authorId);
      onChange?.(authorId, false);
      socket.emit("unfollowUser", { toUserId: authorId });
    } catch (err) {
      console.error("Follow action failed:", err);
    } finally {
      setBusy(false);
    }
  }, [authorId, onChange, unfollow]);

  const handleFollowBtn = useCallback(() => {
    if (!authorId || busy) return;
    const current = statusOf(authorId);

    if (current === "none") {
      performFollow();
    } else if (current === "requested") {
      performCancelRequest();
    } else if (current === "following") {
      Alert.alert(
        "Unfollow user",
        "Unfollow this user?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Unfollow", style: "destructive", onPress: performUnfollow },
        ]
      );
    }
  }, [authorId, busy, statusOf, performFollow, performCancelRequest, performUnfollow]);

  // ── live socket sync: another screen accepted/rejected a pending
  // request, or someone followed/unfollowed this author while we have
  // them rendered. Keeps the store correct even without a refetch.
  useEffect(() => {
    if (!authorId) return;

    const onFollowAccepted = ({ from, toUserId }) => {
      if (toUserId === authorId) follow(authorId);
    };
    const onFollowRejected = ({ from }) => {
      if (from === authorId && statusOf(authorId) === "requested") cancelRequest(authorId);
    };
    const onUserFollowed = ({ fromUserId, toUserId }) => {
      // someone else followed `authorId` — doesn't affect MY status, ignore
    };

    socket.on("followAccepted", onFollowAccepted);
    socket.on("followRejected", onFollowRejected);
    socket.on("userFollowed", onUserFollowed);

    return () => {
      socket.off("followAccepted", onFollowAccepted);
      socket.off("followRejected", onFollowRejected);
      socket.off("userFollowed", onUserFollowed);
    };
  }, [authorId, follow, cancelRequest, statusOf]);

  const label =
    status === "following" ? "Following" : status === "requested" ? "Requested" : isPrivate ? "Follow" : "Follow";

  return { status, label, busy, handleFollowBtn };
}