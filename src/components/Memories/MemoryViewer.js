import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Modal,
  Alert,
  StyleSheet,
} from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import IonIcon from "react-native-vector-icons/Ionicons";
import LinearGradient from "react-native-linear-gradient";
import Video from "react-native-video";
import Config from "react-native-config";
import { apiFetch, getCachedUser } from "../../api/authToken"; 
import { useNavigation } from "@react-navigation/native";
import socket from "../../sockets/Sockets";
import MemoryLikesSheet from "./MemoryLikesSheet";
import MemoryCommentsSheet from "./MemoryCommentSheet";
import MemoryViewsSheet from "./MemoryViewsSheet";

const API = Config.API_URL;
const GOLDEN = "rgb(234,182,118)";

function confirmAsync(message) {
  return new Promise((resolve) => {
    Alert.alert("Confirm", message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

function formatCount(num) {
  const n = Number(num) || 0;
  if (n < 1000) return `${n}`;
  const units = [
    { value: 1_000_000_000, symbol: "B" },
    { value: 1_000_000, symbol: "M" },
    { value: 1_000, symbol: "K" },
  ];
  for (const u of units) {
    if (n >= u.value) {
      const scaled = n / u.value;
      const rounded = scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1);
      return `${rounded}${u.symbol}`;
    }
  }
  return `${n}`;
}

function Avatar({ src, username, size = 36 }) {
  if (src) {
    return (
      <Image
        source={{ uri: src }}
        style={[styles.avatarBase, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }
  return (
    <View style={[styles.avatarBase, styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>
        {username?.[0]?.toUpperCase() || "?"}
      </Text>
    </View>
  );
}

// ── MemoryViewer — full-screen, story-viewer visual language, for ONE
// memory group ("Highlight"). Fetches the group's items itself (so it
// always reflects the latest add/delete), and moves between items in
// that same group with the progress bar at top. Bottom bar: a quick
// comment input (posts directly), a comment-thread icon (opens the full
// CRUD comments sheet), a like button + count (tap count for the Likes
// sheet), a views count (owner only — tap for the Views sheet), and —
// owner only — a ⋮ menu with Hide from non-followers / Add another
// memory (adds into THIS group) / Delete this memory.
//
// `initialItemId` lets a caller land directly on a specific slide instead
// of just an index — used when opening the viewer from a notification
// (memory_like / memory_comment / memory_reply / memory_like_comment),
// since the item's position in the group can change over time but its id
// can't.
// `initialSheet` ("likes" | "comments" | null), `initialCommentId`, and
// `initialReplyId` come from the same notification handoff (see
// consumePendingOpenMemory() in ActivityPage.js) — once the target item is
// loaded, the matching sheet pops open automatically, and for comment/reply
// notifications the specific comment/reply is highlighted.
function MemoryViewer({ groupId, groupIds = [], onSwitchGroup, isOwner, initialIndex = 0, initialItemId = null, initialSheet = null, initialCommentId = null, initialReplyId = null, onClose, onGroupEmptied, onRequestAddItem, onItemDeleted }) {
  const navigation = useNavigation();
  const [currentUser, setCurrentUser] = useState({});
  useEffect(() => {
    getCachedUser().then(setCurrentUser).catch(() => setCurrentUser({}));
  }, []);
  const MY_ID = (currentUser?._id || currentUser?.id)?.toString();

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [items, setItems] = useState([]);
  const [current, setCurrent] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [viewsCount, setViewsCount] = useState(0);
  const [comment, setComment] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showLikes, setShowLikes] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [accessDenied, setAccessDenied] = useState(null);
  const [isHidden, setIsHidden] = useState(false);
  // Mirrors item.disableComments locally so the ⋮ menu label and the
  // comments sheet (which reads this as a prop) update instantly after
  // toggling, instead of waiting for a full re-fetch of the group.
  const [commentsOff, setCommentsOff] = useState(false);
  // ← NEW — which comment/reply (if any) to scroll to + highlight once
  // the comments sheet auto-opens from a notification.
  const [highlightCommentId, setHighlightCommentId] = useState(initialCommentId);
  const [highlightReplyId, setHighlightReplyId] = useState(initialReplyId);
  // Guards against re-opening the sheet again if the group refetches
  // (e.g. after a like/comment socket event) while it's still open.
  const sheetAppliedRef = useRef(false);

  const timerRef = useRef(null);
  // Duration (seconds) of whichever video is currently loaded, captured
  // from <Video>'s onLoad below. Used together with onProgress to drive
  // the top progress bar for video items — the timer effect right below
  // deliberately skips video (it only handles the fixed-duration image
  // case; video advances on its own via onEnd), so without this the
  // video's progress segment just sat empty at 0% for its entire
  // playback instead of filling up like the image segments do.
  const videoDurationRef = useRef(0);

  const item = items[current] || null;
  const isVideo = item?.media?.type === "video";
  const isOwn = isOwner ?? (item?.author?.toString() === MY_ID);

  // ── Fetch the group's items on mount / whenever groupId changes ────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAccessDenied(null);
    (async () => {
      try {
        const res = await apiFetch(`${API}/memories/groups/${groupId}/items`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setGroup(data.group);
          setItems(data.items);
          // Deep-link: if we were told a specific item to land on (from a
          // notification tap), find its current index. Falls back to
          // initialIndex/0 if that item no longer exists (e.g. it was
          // deleted since the notification fired).
          if (initialItemId) {
            const idx = data.items.findIndex((it) => it._id === initialItemId);
            setCurrent(idx >= 0 ? idx : Math.min(initialIndex ?? 0, Math.max(data.items.length - 1, 0)));
          } else {
            setCurrent((prev) => Math.min(initialIndex ?? prev, Math.max(data.items.length - 1, 0)));
          }
        } else if (res.status === 403) {
          setAccessDenied("not_following");
        }
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // ← NEW — once the deep-linked item is actually the current slide, pop
  // open whichever sheet the notification pointed at. Waits for `item`
  // (not just `loading`) so it fires after `current` has been resolved to
  // the right index above.
  useEffect(() => {
    if (sheetAppliedRef.current) return;
    if (!initialSheet || !item) return;
    if (initialItemId && item._id !== initialItemId) return;

    if (initialSheet === "likes") setShowLikes(true);
    if (initialSheet === "comments") setShowComments(true);
    sheetAppliedRef.current = true;
  }, [initialSheet, initialItemId, item]);

  // Auto-close if the group ends up with zero visible items (e.g. the
  // last one was just deleted, or none of them are visible to this
  // viewer). Deferred with a zero-delay timeout so this doesn't try to
  // update a parent's state in the same render pass this component is
  // committing in — same reasoning as the web version's comment about
  // avoiding a "setState during another component's render" warning.
  useEffect(() => {
    if (loading || items.length !== 0) return;
    const t = setTimeout(() => {
      onGroupEmptied?.(groupId);
      onClose();
    }, 0);
    return () => clearTimeout(t);
  }, [loading, items.length]);

  // ── Join/leave the current item's socket room for live likes/comments/views ──
  useEffect(() => {
    if (!item?._id) return;
    socket.emit("joinMemoryItem", item._id);
    return () => socket.emit("leaveMemoryItem", item._id);
  }, [item?._id]);

  // ── Seed like/view state from the item payload, then confirm from server ────
  useEffect(() => {
    if (!item?._id) return;
    setLiked(!!item.liked);
    setLikesCount(item.likesCount || 0);
    setViewsCount(item.viewsCount || 0);
    setIsHidden(!!item.isHiddenFromNonFollowers);
    setCommentsOff(!!item.disableComments);

    (async () => {
      try {
        const res = await apiFetch(`${API}/memories/items/${item._id}/view`, { method: "PUT"});
        const data = await res.json();
        if (data?.success) setViewsCount(data.viewsCount);
      } catch {
        /* non-fatal */
      }
    })();

    const onLikes = ({ likesCount: count }) => setLikesCount(count);
    const onViews = ({ viewsCount: count }) => setViewsCount(count);
    socket.on(`memoryItem:${item._id}:likes`, onLikes);
    socket.on(`memoryItem:${item._id}:views`, onViews);
    return () => {
      socket.off(`memoryItem:${item._id}:likes`, onLikes);
      socket.off(`memoryItem:${item._id}:views`, onViews);
    };
  }, [item?._id]);

  // ── Progress timer (image auto-advance; video advances on end) ─────────
  useEffect(() => {
    setProgress(0);
    videoDurationRef.current = 0;
    clearInterval(timerRef.current);
    if (paused || accessDenied || isVideo || !item) return;
    timerRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          handleNext();
          return 0;
        }
        return p + 2;
      });
    }, 100);
    return () => clearInterval(timerRef.current);
  }, [current, paused, accessDenied, isVideo, item]);

  useEffect(() => {
    setPaused(showMenu || showLikes || showComments || showViews);
  }, [showMenu, showLikes, showComments, showViews]);

  // At the end of this group's items, move into the next group instead of
  // just closing — same "keep going" behavior as Instagram Stories.
  // Requires the parent to pass the full ordered `groupIds` list and an
  // `onSwitchGroup(nextId)` callback that updates its own viewerGroupId
  // state; if either is missing, this just falls back to the old
  // close-on-finish behavior.
  const goToAdjacentGroup = (direction) => {
    if (!onSwitchGroup || groupIds.length === 0) {
      if (direction === "next") onClose();
      return;
    }
    const idx = groupIds.indexOf(groupId);
    const nextId = idx >= 0 ? groupIds[idx + (direction === "next" ? 1 : -1)] : null;
    if (nextId) onSwitchGroup(nextId);
    else if (direction === "next") onClose();
    // direction === "prev" with no earlier group: just stay put, nothing to do.
  };

  const handleNext = () => {
    if (current < items.length - 1) setCurrent((c) => c + 1);
    else goToAdjacentGroup("next");
  };
  const handlePrev = () => {
    if (current > 0) setCurrent((c) => c - 1);
    else goToAdjacentGroup("prev");
  };

  const handleLike = async () => {
    if (!item?._id) return;
    try {
      const res = await apiFetch(`${API}/memories/items/${item._id}/like`, { method: "PUT" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikesCount(data.likesCount);
      } else if (res.status === 403) setAccessDenied("not_following");
    } catch {
      /* non-fatal */
    }
  };

  const handleSendComment = async () => {
    if (!comment.trim() || !item?._id) return;
    if (commentsOff && !isOwn) return;
    const text = comment;
    setComment("");
    try {
      await apiFetch(`${API}/memories/items/${item._id}/comments`, {
        method: "POST",
        
        body: JSON.stringify({ text }),
      });
      // The comments sheet (if open elsewhere) picks this up live via
      // the `memoryItem:{id}:newComment` socket broadcast.
    } catch {
      /* non-fatal */
    }
  };

  const handleDelete = async () => {
    if (!item?._id) return;
    const ok = await confirmAsync("Delete this memory?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/memories/items/${item._id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        onItemDeleted?.(item._id, groupId, data.groupDeleted);
        if (data.groupDeleted) {
          onGroupEmptied?.(groupId);
          onClose();
        } else {
          setItems((prev) => prev.filter((it) => it._id !== item._id));
          setCurrent((c) => Math.max(0, Math.min(c, items.length - 2)));
        }
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (e) {
      console.log(e);
    }
  };

  const handleToggleHide = async () => {
    if (!item?._id) return;
    try {
      const res = await apiFetch(`${API}/memories/items/${item._id}/hide`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHiddenFromNonFollowers);
        setShowMenu(false);
      } else {
        Alert.alert("Error", data.message || "Couldn't update visibility");
      }
    } catch (e) {
      console.log(e);
    }
  };

  // Flips disableComments on THIS item. This is the fix for memories that
  // got stuck permanently comment-locked from before the FormData boolean
  // parsing was corrected — previously the only way out was deleting and
  // re-uploading the whole memory.
  const handleToggleComments = async () => {
    if (!item?._id) return;
    try {
      const res = await apiFetch(`${API}/memories/items/${item._id}/toggle-comments`, { method: "PATCH"});
      const data = await res.json();
      if (res.ok) {
        setCommentsOff(data.disableComments);
        setShowMenu(false);
      } else {
        Alert.alert("Error", data.message || "Couldn't update comment settings");
      }
    } catch (e) {
      console.log(e);
    }
  };

  const goToProfile = () => {
    if (group?.author?._id) navigation.navigate("UserProfile", { userId: group.author._id });
  };

  // ══════════════════════════════════════════════════════════════════════
  // Every hook above runs on every render regardless of state — only the
  // JSX below branches. This is the ONLY place we conditionally return.
  // ══════════════════════════════════════════════════════════════════════

  if (accessDenied) {
    return (
      <Modal visible animationType="fade" onRequestClose={onClose}>
        <View style={styles.container}>
          <View style={styles.deniedWrap}>
            <Avatar src={group?.author?.profilePic} username={group?.author?.username} size={64} />
            <Text style={styles.deniedTitle}>Follow to view this memory</Text>
            <Text style={styles.deniedText}>
              {group?.author?.username
                ? `Only ${group.author.username}'s followers can see this.`
                : "You need to follow this account first."}
            </Text>
            <TouchableOpacity style={styles.deniedBtn} onPress={onClose}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  if (loading || !item) {
    return (
      <Modal visible animationType="fade" onRequestClose={onClose}>
        <View style={styles.container}>
          <Text style={{ margin: "auto", color: "rgba(255,255,255,0.6)", fontSize: 14 }}>Loading...</Text>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* MEDIA */}
        {isVideo ? (
          <Video
            key={item.media.url}
            source={{ uri: item.media.url }}
            style={styles.media}
            resizeMode="contain"
            paused={paused}
            onLoad={(data) => {
              videoDurationRef.current = data?.duration || 0;
            }}
            onProgress={(data) => {
              if (!videoDurationRef.current) return;
              setProgress(Math.min(100, (data.currentTime / videoDurationRef.current) * 100));
            }}
            onEnd={handleNext}
          />
        ) : (
          <Image source={{ uri: item.media.url }} style={styles.media} />
        )}

        <LinearGradient colors={["rgba(0,0,0,0.55)", "transparent"]} style={styles.topGradient} pointerEvents="none" />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.7)"]} style={styles.bottomGradient} pointerEvents="none" />

        {/* PROGRESS BARS — one per item in this group */}
        <View style={styles.progressWrap} pointerEvents="none">
          {items.map((_, i) => (
            <View key={i} style={styles.progressBg}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${i < current ? 100 : i === current ? progress : 0}%` },
                ]}
              />
            </View>
          ))}
        </View>

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity disabled={isOwn} onPress={!isOwn ? goToProfile : undefined}>
            <Avatar src={group?.author?.profilePic} username={group?.author?.username} size={36} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerInfo} disabled={isOwn} onPress={!isOwn ? goToProfile : undefined}>
            <Text style={styles.username}>{group?.author?.username}</Text>
            <Text style={styles.memoryName}>{group?.name}</Text>
          </TouchableOpacity>
          {isOwn && (
            <TouchableOpacity style={styles.viewsBadge} onPress={() => setShowViews(true)}>
              <Icon name="eye" size={13} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "600" }}>{formatCount(viewsCount)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <IonIcon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* NAV ZONES */}
        <TouchableOpacity style={styles.navLeft} activeOpacity={1} onPress={handlePrev} />
        <TouchableOpacity style={styles.navRight} activeOpacity={1} onPress={handleNext} />

        {/* BOTTOM BAR */}
        <View style={styles.bottom}>
          <View style={styles.bottomRow}>
            {/* Comments-off + viewer (not owner): the quick-comment input
                is simply not rendered at all — no greyed-out box, no
                placeholder explaining why, no way to trigger a 403. The
                owner still sees (and can use) it, since disableComments
                never applies to the owner's own comments. */}
            {(isOwn || !commentsOff) && (
              <TextInput
                placeholder="Comment..."
                placeholderTextColor="rgba(255,255,255,0.6)"
                value={comment}
                onChangeText={setComment}
                onSubmitEditing={handleSendComment}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                style={styles.input}
              />
            )}
            <TouchableOpacity onPress={() => setShowComments(true)} style={styles.iconBtn}>
              <Icon name="comment" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleLike} style={styles.iconBtn}>
              <Icon name="thumbs-up" solid={liked} size={17} color={liked ? GOLDEN : "#fff"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowLikes(true)}>
              <Text style={styles.likeCount}>{formatCount(likesCount)}</Text>
            </TouchableOpacity>
            {isOwn && (
              <View style={{ position: "relative" }}>
                <TouchableOpacity style={styles.iconBtn} onPress={() => setShowMenu((v) => !v)}>
                  <Icon name="ellipsis-v" size={17} color="#fff" />
                </TouchableOpacity>
                {showMenu && (
                  <>
                    <TouchableOpacity
                      style={styles.menuOverlay}
                      activeOpacity={1}
                      onPress={() => setShowMenu(false)}
                    />
                    <View style={styles.feedStyleMenu}>
                      <TouchableOpacity style={styles.feedMenuItem} onPress={handleToggleHide}>
                        <Text style={styles.feedMenuItemText}>
                          {isHidden ? "Show to everyone" : "Hide from non-followers"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.feedMenuItem} onPress={handleToggleComments}>
                        <Text style={styles.feedMenuItemText}>
                          {commentsOff ? "Turn comments on" : "Turn comments off"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.feedMenuItem}
                        onPress={() => {
                          setShowMenu(false);
                          onRequestAddItem?.(groupId);
                        }}
                      >
                        <Text style={styles.feedMenuItemText}>Add another memory</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.feedMenuItem, { borderBottomWidth: 0 }]} onPress={handleDelete}>
                        <Text style={[styles.feedMenuItemText, { color: "#ff3b30" }]}>Delete this memory</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </View>

        {showLikes && <MemoryLikesSheet itemId={item._id} onClose={() => setShowLikes(false)} />}
        {showComments && (
          <MemoryCommentsSheet
            itemId={item._id}
            disableComments={commentsOff}
            onClose={() => { setShowComments(false); setHighlightCommentId(null); setHighlightReplyId(null); }}
            highlightCommentId={highlightCommentId}
            highlightReplyId={highlightReplyId}
          />
        )}
        {showViews && <MemoryViewsSheet itemId={item._id} onClose={() => setShowViews(false)} />}
      </View>
    </Modal>
  );
}

export default MemoryViewer;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000",objectFit:"contain" },
  media: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 120, zIndex: 3 },
  bottomGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 180, zIndex: 3 },

  progressWrap: { flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingTop: 10, position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  progressBg: { flex: 1, height: 2, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },

  header: { position: "absolute", top: 20, left: 0, right: 0, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  headerInfo: { flexDirection: "column", gap: 1 },
  username: { color: "#fff", fontSize: 14, fontWeight: "600" },
  memoryName: { color: "rgba(255,255,255,0.75)", fontSize: 11 },
  viewsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: "auto",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  closeBtn: { marginLeft: 8 },

  navLeft: { position: "absolute", left: 0, top: 0, width: "40%", height: "100%", zIndex: 5 },
  navRight: { position: "absolute", right: 0, top: 0, width: "60%", height: "100%", zIndex: 5 },

  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 14, paddingBottom: 32 },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 14,
  },
  iconBtn: { alignItems: "center", justifyContent: "center" },
  likeCount: { color: "#fff", fontSize: 13, fontWeight: "600" },

  feedStyleMenu: {
    position: "absolute",
    right: 0,
    bottom: 44,
    backgroundColor: "#fff",
    borderRadius: 14,
    minWidth: 210,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#eee",
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 8,
  },
  feedMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 0.5,
    borderBottomColor: "#f0f0f0",
  },
  feedMenuItemText: { fontSize: 14, fontWeight: "500", color: "#222" },
  menuOverlay: { position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },

  avatarBase: { borderWidth: 2, borderColor: "#fff" },
  avatarFallback: { backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },

  deniedWrap: { margin: "auto", alignItems: "center", gap: 10, paddingHorizontal: 32 },
  deniedTitle: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 10 },
  deniedText: { color: "rgba(255,255,255,0.6)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  deniedBtn: {
    marginTop: 16,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 24,
  },
});