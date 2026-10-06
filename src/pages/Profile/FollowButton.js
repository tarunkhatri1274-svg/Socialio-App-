import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { useFollowAction } from "./UseFollowAction";

// ─────────────────────────────────────────────────────────────────────────
// <FollowButton /> — drop this anywhere instead of hand-rolling a button +
// local followState. It reads/writes the SAME global store as every other
// instance of this component, so following someone on Home immediately
// shows "Following" on Explore, VideoPage, their profile, etc. — no
// refetch, no reload required.
//
// Usage:
//   <FollowButton
//     authorId={post.author._id}
//     isPrivate={post.author.isPrivate}
//     isOwner={isOwner}
//     isBlocked={isBlocked}
//     onChange={(id, followed) => { ...optional side effect... }}
//     variant="pill" // "pill" (default, light bg) | "outline" (dark video overlay style)
//   />
// ─────────────────────────────────────────────────────────────────────────
export default function FollowButton({
  authorId,
  isPrivate,
  isOwner,
  isBlocked,
  onChange,
  variant = "pill",
  style: extraStyle = {},
}) {
  const { status, label, busy, handleFollowBtn } = useFollowAction(authorId, {
    isPrivate,
    onChange,
  });

  if (isOwner || isBlocked || !authorId) return null;

  const isPillActive = status !== "none";
  const baseStyle = variant === "outline"
    ? [styles.outline, isPillActive && styles.outlineActive]
    : [styles.pill, isPillActive && styles.pillActive];

  const textStyle = variant === "outline"
    ? styles.outlineText
    : [styles.pillText, isPillActive && styles.pillTextActive];

  return (
    <TouchableOpacity
      onPress={handleFollowBtn}
      disabled={busy}
      activeOpacity={0.7}
      style={[...baseStyle, busy && styles.busy, extraStyle]}
    >
      <Text style={textStyle}>{busy ? "…" : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#0095f6",
  },
  pillActive: {
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  pillTextActive: {
    color: "#333",
  },
  outline: {
    borderWidth: 1,
    borderColor: "#fff",
    backgroundColor: "transparent",
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  outlineActive: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  outlineText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  busy: {
    opacity: 0.7,
  },
});