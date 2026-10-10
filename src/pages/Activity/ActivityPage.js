import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  SectionList,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path
import Svg, { Path, Circle, Line } from "react-native-svg";
import Config from "react-native-config";
import { useNavigation } from "@react-navigation/native";
import { playAlertSound } from "./AlertSound"; // adjust path


import socket from "../../sockets/Sockets";

// ← NEW — same story-handoff mechanism Homepage.js exports
// (pendingOpenStoryUserId / setPendingOpenStoryUserId). Adjust this path
// to wherever your Home screen actually lives — this MUST point at the
// same module Homepage.js's setter comes from, or the two screens will
// each be talking to their own separate in-memory variable and the
// handoff will silently do nothing.
// ← This screen no longer needs anything from HomePage.js's pending-open
// module flags — StoryViewer is opened directly here now (see
// directStory below), with initialStoryId/initialShowViewers passed as
// plain props instead.

// NEW — Navbar wasn't rendered on this screen at all (that's why it was
// missing), plus the shared screen-wide swipe hook and the "tap the
// active tab to reload" bus.
import Navbar, { subscribeTabReload, useSwipeToChangeTab } from "../../components/Navbar/Navbar";
// ← NEW — StoryViewer is rendered directly on this screen now (see
// handleOpenStory/directStory below) instead of handing off through
// HomePage.js, so a story notification opens immediately without a
// visible stop on the home screen first.
import StoryViewer from "../../components/StoryBar/StoryViewer";

const API = Config.API_URL;

/* ─────────────────────────── memory ("Highlight") handoff ───────────────────────────
   Mirrors the story handoff above. sessionStorage doesn't exist in RN, so this
   is a plain in-memory value + setter, consumed once (read-and-clear) by
   Profilepage.js / UserProfileView.js on mount — same "leave a note, burn it
   on read" pattern discussed for the tab-memory fix earlier in this app. */
let pendingOpenMemory = null;
export function setPendingOpenMemory(payload) {
  pendingOpenMemory = payload;
}
export function consumePendingOpenMemory() {
  const val = pendingOpenMemory;
  pendingOpenMemory = null;
  return val;
}

// notif.type -> which sheet MemoryViewer should auto-open once it lands on
// the right item. Mirrors SHEET_FOR_POST_NOTIF above.
const SHEET_FOR_MEMORY_NOTIF = {
  memory_like: "likes",
  memory_like_comment: "comments",
  memory_like_reply: "comments",
  memory_comment: "comments",
  memory_reply: "comments",
};

/* ─────────────────────────── auth cache ─────────────────────────── */
let cachedMyId = null;
let cachedNotifSettings = null;

async function loadLocalCaches() {
  try {
    const user = await getCachedUser();
    cachedMyId = (user?._id || user?.id)?.toString() || null;
    const rawSettings = await AsyncStorage.getItem("notifSettings");
    cachedNotifSettings = rawSettings ? JSON.parse(rawSettings) : null;
  } catch {
    cachedMyId = null;
    cachedNotifSettings = null;
  }
}

// Same synchronous call shape as before, so the three getMyId() call
// sites below don't change. The token itself is handled by apiFetch.
const getMyId = () => cachedMyId;




/* ─────────────────────────── API calls (unchanged shape, just cached token) ─────────────────────────── */
const fetchNotifications = async (page = 1) => {
  const res = await apiFetch(`${API}/auth/notifications?page=${page}&limit=20`);
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
};

const markRead = async (notificationId) => {
  await apiFetch(`${API}/auth/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
};

const deleteNotificationApi = async (notificationId) => {
  await apiFetch(`${API}/auth/notifications/${notificationId}`, {
    method: "DELETE",
  });
};

const acceptFollowRequestApi = async (requesterId) => {
  await apiFetch(`${API}/auth/follow/accept/${requesterId}`, {
    method: "POST",
  });
};

const rejectFollowRequestApi = async (requesterId) => {
  await apiFetch(`${API}/auth/follow/reject/${requesterId}`, {
    method: "POST",
  });
};

const respondToCollabApi = async (postId, accept) => {
  const res = await apiFetch(`${API}/auth/collaborator-respond/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ accept }),
  });
  return res.json();
};

/* ─────────────────────────── icon set (react-native-svg, same paths as the web glyphs) ─────────────────────────── */
const TYPE_DISPLAY = {
  follow: { icon: "follow" },
  follow_request: { icon: "request" },
  follow_accepted: { icon: "follow" },
  like_post: { icon: "like" },
  like_comment: { icon: "like" },
  like_reply: { icon: "like" },
  story_like: { icon: "like" },
  comment: { icon: "comment" },
  reply: { icon: "comment" },
  message: { icon: "message" },
  collab_request: { icon: "collab" },
  story_view: { icon: "story" },
  story_live: { icon: "story" },
  memory_like: { icon: "like" },
  memory_comment: { icon: "comment" },
  memory_reply: { icon: "comment" },
  memory_like_comment: { icon: "like" },
  memory_like_reply: { icon: "like" },
};

const ICON_COLOR = {
  follow: "#0095f6",
  request: "#8e44ad",
  like: "#e74c3c",
  comment: "#f39c12",
  message: "#16a085",
  collab: "#2980b9",
  story: "#d35400",
};

function NotifTypeIcon({ type }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "white", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (type) {
    case "follow":
      return (
        <Svg {...common}>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <Circle cx="12" cy="7" r="4" />
        </Svg>
      );
    case "request":
      return (
        <Svg {...common}>
          <Circle cx="12" cy="12" r="10" />
          <Line x1="12" y1="8" x2="12" y2="16" />
          <Line x1="8" y1="12" x2="16" y2="12" />
        </Svg>
      );
    case "like":
      return (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth={1.5}>
          <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </Svg>
      );
    case "comment":
      return (
        <Svg {...common}>
          <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Svg>
      );
    case "message":
      return (
        <Svg {...common}>
          <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </Svg>
      );
    case "collab":
      return (
        <Svg {...common}>
          <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <Circle cx="9" cy="7" r="4" />
          <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
      );
    case "story":
      return (
        <Svg {...common}>
          <Circle cx="12" cy="12" r="3" />
          <Circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
        </Svg>
      );
    default:
      return null;
  }
}

const timeAgo = (dateStr) => {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
};

/* ─────────────────────────── notification → navigation target ─────────────────────────── */
// Maps a postType to the RN screen+params it should open. story_view /
// story_like / story_live and memory_* are handled separately (see
// handleOpenStory / handleOpenMemory below) since they need extra
// liveness/lookup logic a plain route can't express.
//
// FIXED — screen name was "Post" (doesn't exist in App.js's Stack.Navigator,
// which registers it as "PostDetail") and param key was "postId" (Post.js /
// TextPostView.js both read route.params.id, not route.params.postId).
const POSTTYPE_TO_ROUTE = {
  image: (id, extra) => ({ screen: "PostDetail", params: { id, ...extra } }),
  carousel: (id, extra) => ({ screen: "PostDetail", params: { id, ...extra } }),
  video: (id, extra) => ({ screen: "ProfileReel", params: { videoId: id, ...extra } }),
  text: (id, extra) => ({ screen: "TextPost", params: { id, ...extra } }),
};

// notif.type -> which sheet the destination screen should auto-open.
// (Also exported so App.js/whatever registers routes can reuse the
// mapping if it ever needs it — harmless if unused elsewhere.)
const SHEET_FOR_POST_NOTIF = {
  like_post: "likes",
  like_comment: "comments",
  like_reply: "comments",
  comment: "comments",
  reply: "comments",
};

const getNotificationTarget = (n) => {
  const postId = n.post?._id || n.post || n.postId;
  const senderId = n.sender?._id || n.sender;

  switch (n.type) {
    case "comment":
    case "reply":
    case "like_post":
    case "like_comment":
    case "like_reply":
    case "new_post": // ← NEW — "shared a new post/reel/text post" now opens the post
    case "collab_request": {
      if (!postId) return null;
      const routeFor = POSTTYPE_TO_ROUTE[n.postType] || POSTTYPE_TO_ROUTE.image;
      const sheet = SHEET_FOR_POST_NOTIF[n.type] || null;
      // ← NEW — carries which sheet (Likes/Comments) the post/reel/text-post
      // screen should pop open on arrival, and for comment/reply
      // notifications, which exact comment/reply to scroll to + highlight.
      // See PostCard's `pendingSheet` handling in Post.js/TextPostView.js/
      // UserProfileVideoPost.js.
      // FIXED — schema stores these as `comment`/`reply` (see
      // notification.model.js), not `commentId`/`replyId`.
      return routeFor(postId, sheet ? { sheet, commentId: n.comment || null, replyId: n.reply || null } : {});
    }
    case "follow":
    case "follow_accepted":
      // FIXED — "Profile" is the own-profile tab screen (Profilepage.js)
      // and ignores a userId param entirely. The screen that actually
      // reads route.params.userId and shows someone else's profile is
      // "UserProfile" (UserProfileView.js).
      return senderId ? { screen: "UserProfile", params: { userId: senderId } } : null;
    case "message":
      // FIXED — "Chat" isn't registered anywhere in App.js's
      // Stack.Navigator (only "Messages" is), so this used to fail
      // silently. Routing to "Messages" with a chatId param instead —
      // confirm Messages.js reads route.params.chatId (or swap the key
      // to whatever it actually expects, e.g. userId).
      return { screen: "Messages", params: { chatId: n.chatId } };
    default:
      return null;
  }
};

/* ─────────────────────────── notification sound ───────────────────────────
   The web version synthesizes a two-tone "ding" with the Web Audio API,
   which has no RN equivalent. There's no bundled asset to play here, so
   this is a best-effort stub: if the app has react-native-sound (or
   expo-av) installed, wire actual playback in here. Left as a silent
   no-op otherwise so a missing package doesn't crash the app. */
const playNotificationSound = () => {
  try {
    // Example if using react-native-sound:
    // const Sound = require("react-native-sound");
    // const s = new Sound("notification.mp3", Sound.MAIN_BUNDLE, (err) => {
    //   if (!err) s.play(() => s.release());
    // });
  } catch (err) {
    console.log("Notification sound failed:", err?.message);
  }
};

/* ─────────────────────────── per-category mute gate (same mapping as Navbar.js) ─────────────────────────── */
const NOTIF_TYPE_TO_SETTING_KEY = {
  message: "message",
  story_view: "story",
  story_like: "story",
  story_live: "story",
  collab_request: "post",
  memory_like: "post",
  memory_comment: "post",
  memory_reply: "post",
  memory_like_comment: "post",
  memory_like_reply: "post",
};
const POSTTYPE_TO_SETTING_KEY = { image: "post", carousel: "post", video: "reel", text: "text" };
const POST_DEPENDENT_TYPES = new Set(["comment", "reply", "like_post", "like_comment", "like_reply", "new_post"]);

const isNotifTypeAllowed = (type, postType) => {
  try {
    let settingKey = NOTIF_TYPE_TO_SETTING_KEY[type];
    if (!settingKey && POST_DEPENDENT_TYPES.has(type)) {
      settingKey = POSTTYPE_TO_SETTING_KEY[postType] || "post";
    }
    if (!settingKey) return true;
    if (!cachedNotifSettings) return true;
    return cachedNotifSettings[settingKey] !== false;
  } catch {
    return true;
  }
};

/* ─────────────────────────── post previews on cards ───────────────────────────
   - image / video / carousel posts → small square thumbnail on the right
   - text posts → the text under the message, with the post's images in a
     rounded strip below it (mini TextPostView)
   Uses the stored media url as-is (no URL tricks). React Native has no
   built-in way to grab a video's first frame, so videos show a dark tile
   with a ▶ badge. (If you use react-native-create-thumbnail you can swap a
   real frame in inside MediaThumb.)
   Needs the backend to populate `post` with `media postType text`. */
const THUMB_TYPES = new Set([
  "like_post", "like_comment", "like_reply",
  "comment", "reply", "collab_request", "new_post",
]);

const isTextPostWithText = (post) =>
  !!post && typeof post === "object" && post.postType === "text" && !!post.text?.trim();

function MediaThumb({ m }) {
  if (!m?.url) return null;
  if (m.type === "video") {
    return (
      <View style={styles.videoTile}>
        <Text style={styles.videoTilePlay}>▶</Text>
      </View>
    );
  }
  return <Image source={{ uri: m.url }} style={styles.thumbImg} resizeMode="cover" />;
}

// image / video posts → small square on the right (text posts use
// TextPostPreview instead, so this returns null for them)
function PostThumb({ post }) {
  if (!post || typeof post !== "object") return null;
  if (isTextPostWithText(post)) return null;

  const first = post.media?.[0];
  if (!first?.url) return null;

  return (
    <View style={styles.thumbWrap}>
      <MediaThumb m={first} />
      {first.type === "video" && <Text style={styles.thumbPlay}>▶</Text>}
    </View>
  );
}

// text post → text first, images underneath
function TextPostPreview({ post }) {
  if (!isTextPostWithText(post)) return null;

  const text = post.text.trim();
  const media = post.media || [];
  const shown = media.slice(0, 2);
  const extra = media.length - shown.length;

  return (
    <View style={styles.tpCard}>
      <Text style={styles.tpText} numberOfLines={3}>
        {text.length > 90 ? text.slice(0, 90).trimEnd() + "..." : text}
      </Text>

      {shown.length > 0 && (
        <View style={styles.tpStrip}>
          {shown.map((m, i) => {
            if (!m?.url) return null;
            return (
              <View key={i} style={[styles.tpImgBox, { flex: 1 }]}>
                <MediaThumb m={m} />
                {i === shown.length - 1 && extra > 0 && (
                  <View style={styles.tpMore}>
                    <Text style={styles.tpMoreText}>+{extra}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────── NotifCard ─────────────────────────── */
function NotifCard({ n, busy, onAccept, onReject, onCollabRespond, onDismiss, onOpen, onOpenStory, onOpenMemory }) {
  const username = n.sender?.username || "Someone";
  const avatar = n.sender?.profilePic || null;
  const display = TYPE_DISPLAY[n.type] || { icon: "comment" };
  const isFollowRequest = n.type === "follow_request";

  const isStoryType = n.type === "story_view" || n.type === "story_like" || n.type === "story_live";
  const isMemoryType =
    n.type === "memory_like" || n.type === "memory_comment" || n.type === "memory_reply" ||
    n.type === "memory_like_comment" || n.type === "memory_like_reply";

  const isCollabInvite = n.type === "collab_request" && n.message?.toLowerCase().includes("invited you");

  const target = getNotificationTarget(n);
  const isClickable = isStoryType
    ? !!(n.sender?._id || n.sender)
    : isMemoryType
    ? !!(n.memoryItem?._id || n.memoryItem)
    : !!target && !isFollowRequest;

  const handleCardPress = () => {
    if (!isClickable) return;
    if (isStoryType) return onOpenStory(n);
    if (isMemoryType) return onOpenMemory(n);
    return onOpen(n);
  };

  return (
    <TouchableOpacity
      activeOpacity={isClickable ? 0.7 : 1}
      onPress={handleCardPress}
      disabled={!isClickable}
      style={[styles.card, { backgroundColor: n.isRead ? "#fff" : "#f0f7ff", opacity: busy ? 0.6 : 1 }]}
    >
      <View style={styles.avatarWrapper}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={{ fontSize: 18, fontWeight: "600", color: "#666" }}>{username.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.typeIcon, { backgroundColor: ICON_COLOR[display.icon] }]}>
          <NotifTypeIcon type={display.icon} />
        </View>
      </View>

      <View style={styles.textContainer}>
        <Text style={styles.notifText}>
          {n.message ? (
            <Text style={styles.text}>{n.message}</Text>
          ) : (
            <>
              <Text style={styles.username}>{username}</Text>
              <Text style={styles.text}> sent you a notification</Text>
            </>
          )}
        </Text>
        <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>

        {/* text posts: text + images shown under the message */}
        {THUMB_TYPES.has(n.type) && <TextPostPreview post={n.post} />}
      </View>

      {isFollowRequest && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.acceptBtn} disabled={busy} onPress={() => onAccept(n)}>
            <Text style={styles.acceptBtnText}>Confirm</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rejectBtn} disabled={busy} onPress={() => onReject(n)}>
            <Text style={styles.rejectBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {isCollabInvite && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.acceptBtn} disabled={busy} onPress={() => onCollabRespond(n, true)}>
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rejectBtn} disabled={busy} onPress={() => onCollabRespond(n, false)}>
            <Text style={styles.rejectBtnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* image / video posts: small square thumbnail on the right */}
      {THUMB_TYPES.has(n.type) && <PostThumb post={n.post} />}

      {!isFollowRequest && !isCollabInvite && (
        <TouchableOpacity style={styles.dismissBtn} onPress={() => onDismiss(n)}>
          <Text style={styles.dismissBtnText}>×</Text>
        </TouchableOpacity>
      )}

      {!n.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

/* ─────────────────────────── main screen ─────────────────────────── */
function ActivityPage() {
  const navigation = useNavigation();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  // ← NEW — holds the single-author "reel" to hand StoryViewer when a
  // story notification is tapped, so it renders right here in an
  // overlay instead of routing through HomePage.js first.
  const [directStory, setDirectStory] = useState(null);
  const markedReadRef = useRef(new Set());
  const sectionListRef = useRef(null);

  // NEW — screen-wide swipe to switch tabs. capture:false so a swipe that
  // starts on something scrollable elsewhere on the screen still behaves
  // normally; this only kicks in when nothing more specific claims the
  // gesture first.
  const { panHandlers } = useSwipeToChangeTab({ capture: false });

  const loadPage = useCallback(async (pageNum) => {
    try {
      const data = await fetchNotifications(pageNum);
      setNotifications((prev) => (pageNum === 1 ? data.notifications : [...prev, ...data.notifications]));
      setHasMore(data.hasMore);
      setPage(pageNum);
      setError(null);
    } catch (err) {
      setError("Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
          await loadLocalCaches();
      setLoading(true);
      loadPage(1);
    })();
  }, [loadPage]);

  // NEW — tapping the already-active "Notifications" tab reloads this
  // screen (refetch page 1 + scroll to top) instead of doing nothing.
  useEffect(() => {
    return subscribeTabReload("Notifications", () => {
      try {
        if (notifications.length > 0) {
          sectionListRef.current?.scrollToLocation?.({
            sectionIndex: 0,
            itemIndex: 0,
            animated: true,
            viewPosition: 0,
          });
        }
      } catch {
        // scrollToLocation throws if there's nothing to scroll to yet — ignore
      }
      setLoading(true);
      loadPage(1);
    });
  }, [loadPage, notifications.length]);

  useEffect(() => {
    // FIXED — "receiveNotification" socket payloads don't reliably carry
    // Mongo's _id the way the REST /notifications fetch does (e.g. if
    // it's emitted before the doc is saved). keyExtractor below is
    // `item._id`, so two or more real-time notifications missing _id
    // all collide on the literal key "undefined" — "Encountered two
    // children with the same key" in the SectionList. Stamping a
    // guaranteed-unique client-side id onto anything missing one, right
    // when it enters state, fixes it at the source instead of papering
    // over it in the list itself.
const handleNewNotification = (notif) => {
  const withId = notif?._id ? notif : { ...notif, _id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}` };
  // ← NEW — skip if this notification is already in the list (e.g. it
  // arrived over the socket AND was fetched on load), so no duplicate cards.
  setNotifications((prev) => (prev.some((x) => x._id === withId._id) ? prev : [withId, ...prev]));
  if (isNotifTypeAllowed(notif?.type, notif?.postType)) {
    playAlertSound({ title: notif?.sender?.username || "Socialio", body: notif?.message });
  }
};

    const handleCollabInviteResolved = ({ postId }) => {
      setNotifications((prev) =>
        prev.filter(
          (n) =>
            !(
              n.type === "collab_request" &&
              (n.post?._id || n.post)?.toString() === postId?.toString() &&
              n.message?.toLowerCase().includes("invited you")
            )
        )
      );
    };

    const handleFollowRequestResolved = ({ requesterId }) => {
      setNotifications((prev) =>
        prev.filter((n) => !(n.type === "follow_request" && (n.sender?._id || n.sender)?.toString() === requesterId?.toString()))
      );
    };

    const handleNotificationsExpired = ({ notificationIds }) => {
      if (!Array.isArray(notificationIds) || notificationIds.length === 0) return;
      const expiredSet = new Set(notificationIds.map((id) => id.toString()));
      setNotifications((prev) => prev.filter((n) => !expiredSet.has(n._id.toString())));
    };

    socket.on("receiveNotification", handleNewNotification);
    socket.on("collabInviteResolved", handleCollabInviteResolved);
    socket.on("followRequestResolved", handleFollowRequestResolved);
    socket.on("notificationsExpired", handleNotificationsExpired);

    return () => {
      socket.off("receiveNotification", handleNewNotification);
      socket.off("collabInviteResolved", handleCollabInviteResolved);
      socket.off("followRequestResolved", handleFollowRequestResolved);
      socket.off("notificationsExpired", handleNotificationsExpired);
    };
  }, []);

  // Mark unread notifications as read once loaded — guarded by a ref so
  // repeated renders (e.g. after new socket notifications arrive) don't
  // re-fire markRead for ids already sent.
  useEffect(() => {
    if (loading) return;
    const toMark = notifications.filter((n) => !n.isRead && !markedReadRef.current.has(n._id));
    if (toMark.length === 0) return;
    toMark.forEach((n) => {
      markedReadRef.current.add(n._id);
      markRead(n._id).catch(() => markedReadRef.current.delete(n._id));
    });
  }, [loading, notifications]);

  const withPending = (id) => setPendingIds((prev) => new Set(prev).add(id));
  const clearPending = (id) =>
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const handleAccept = async (notif) => {
    if (pendingIds.has(notif._id)) return;
    withPending(notif._id);
    try {
      await acceptFollowRequestApi(notif.sender._id);
      setNotifications((prev) => prev.filter((n) => n._id !== notif._id));
    } catch {
      // leave the card in place so the user can retry
    } finally {
      clearPending(notif._id);
    }
  };

  const handleReject = async (notif) => {
    if (pendingIds.has(notif._id)) return;
    withPending(notif._id);
    try {
      await rejectFollowRequestApi(notif.sender._id);
      setNotifications((prev) => prev.filter((n) => n._id !== notif._id));
    } catch {
      // leave the card in place so the user can retry
    } finally {
      clearPending(notif._id);
    }
  };

  const handleCollabRespond = async (notif, accept) => {
    if (pendingIds.has(notif._id)) return;
    withPending(notif._id);
    try {
      const postId = notif.post?._id || notif.post;
      const data = await respondToCollabApi(postId, accept);
      if (data?.success) setNotifications((prev) => prev.filter((n) => n._id !== notif._id));
    } catch {
      // leave the card in place so the user can retry
    } finally {
      clearPending(notif._id);
    }
  };

  const handleDismiss = async (notif) => {
    setNotifications((prev) => prev.filter((n) => n._id !== notif._id));
    try {
      await deleteNotificationApi(notif._id);
    } catch {
      // silent — worst case it reappears on next reload
    }
  };

  const handleOpen = (notif) => {
    const target = getNotificationTarget(notif);
    if (target) navigation.navigate(target.screen, target.params);
  };

  const handleOpenStory = async (n) => {
    if (pendingIds.has(n._id)) return;
    const senderId = n.sender?._id || n.sender;
    // FIXED — for story_like, `sender` is the person who liked the story,
    // not its owner (only story_view/story_live use sender as the poster).
    // `authorId` (added on the backend for story_like) always points at
    // whoever's stories we actually need to fetch — falls back to
    // senderId for the types where that already IS the owner.
    // FIXED — the schema field createNotification saves authorId into is
    // called `author`, not `authorId` (that's only the helper's incoming
    // parameter name).
    const targetUserId = n.author?._id || n.author || senderId;
    if (!targetUserId) return;

    const storyId = n.storyId || n.story?._id || n.story;
    const isLiveType = n.type === "story_live";

    withPending(n._id);
    try {
      const res = await apiFetch(`${API}/stories/get-user-stories/${targetUserId}`);
      const data = await res.json();

      if (res.status === 403) {
        Alert.alert("", data.message || "You can't view this story.");
        return;
      }

      const stories = data.success ? data.stories : [];
      const match = storyId
        ? stories.find((s) => s._id === storyId)
        : stories.find((s) => (isLiveType ? s.storyType === "live" : s.storyType !== "live"));

      if (!match) {
        Alert.alert("", isLiveType ? "This live story has ended." : "This story is no longer available.");
        return;
      }
      if (isLiveType && !match.liveRoomId) {
        Alert.alert("", "This live story has ended.");
        return;
      }

      // ← CHANGED — used to stash the target userId into the module-level
      // pendingOpenStory* vars and navigate("Home"), letting HomePage.js
      // pick it up and open StoryViewer over the feed. That meant a
      // visible stop on the home screen before the story appeared. Now
      // we build the same single-author "reel" shape HomePage.js would
      // have built (see its fetchStories grouping) directly from data
      // already fetched above, and open StoryViewer right here — no
      // navigation at all.
      // ← FIX — this preferred n.author/n.sender over match.author, but
      // for story_like, n.sender is the person who LIKED the story (not
      // its owner), and n.author often isn't populated into a full user
      // object by the backend (just a raw id) — so this was silently
      // falling through to n.sender and showing the LIKER's name/avatar
      // in the header while the actual story/viewers data underneath
      // was correctly the real owner's. match.author comes straight off
      // the story doc we just fetched FOR targetUserId (the real
      // owner), so it's the one source that's always right — check it
      // first, and only fall back to the notification's own fields if
      // the backend somehow didn't populate it.
      const authorObj =
        match.author ||
        (n.author && typeof n.author === "object" && n.author) ||
        (n.sender && typeof n.sender === "object" && n.sender) ||
        {};
      const authorIdStr = (authorObj._id || targetUserId)?.toString();
      const myId = getMyId();

      const slides = stories.map((s) => ({
        id: s._id,
        image: s.media?.url || "",
        type: s.media?.type || s.storyType,
        likes: s.likesCount || 0,
        isLive: s.storyType === "live",
        liveRoomId: s.liveRoomId || null,
        authorId: authorIdStr,
        isHiddenFromNonFollowers: s.isHiddenFromNonFollowers || false,
        viewedByMe: !!s.viewedByMe,
        textOverlays: s.textOverlays || [],
        mentions: s.mentions || [],
        repostAttribution: s.repostAttribution || null,
      }));

      // ← FIX — this used to call setPendingOpenStoryShowViewers(true),
      // a module-level flag that only HomePage.js's FeedStoryPreview
      // ever read. Since StoryViewer is now opened directly on this
      // screen, that flag had nothing listening to it — the sheet
      // never opened. Passed as a real prop (initialShowViewers) to the
      // StoryViewer rendered below instead, which now knows how to
      // resolve it itself (see its own initializer in StoryViewer.js).
      const wantsViewers = n.type === "story_like";
      setDirectStory({
        stories: [{
          id: authorIdStr,
          username: authorObj.username || "User",
          userProfile: authorObj.profilePic || "",
          isOwn: authorIdStr === myId?.toString(),
          slides,
        }],
        initialStoryId: match._id,
        initialShowViewers: wantsViewers,
      });
    } catch {
      Alert.alert("", "Couldn't open this story right now.");
    } finally {
      clearPending(n._id);
    }
  };

  const handleOpenMemory = (n) => {
    // FIXED — createNotification()'s `memoryGroupId`/`memoryItemId`/
    // `authorId` are only its own parameter names on the way IN. The
    // Notification schema (and what the notifications list actually
    // returns) stores these as `memoryGroup`/`memoryItem`/`author` — see
    // notification.model.js / notification.helper.js. They also come
    // back as raw unpopulated ObjectId strings (only `sender` gets
    // populated), so `n.memoryItem?.author` was never going to resolve —
    // `author` needed its own top-level schema field, which is why it
    // was missing entirely until now.
    const groupId = n.memoryGroup?._id || n.memoryGroup;
    const itemId = n.memoryItem?._id || n.memoryItem;
    const authorId = n.author?._id || n.author;

    if (!groupId || !itemId || !authorId) {
      Alert.alert("", "This memory is no longer available.");
      return;
    }

    // ← NEW — also tells MemoryViewer which sheet to open (Likes/Comments)
    // and, for comment/reply notifications, which one to highlight.
    // Same field-name fix: schema fields are `comment`/`reply`.
    setPendingOpenMemory({
      groupId,
      itemId,
      sheet: SHEET_FOR_MEMORY_NOTIF[n.type] || null,
      commentId: n.comment || null,
      replyId: n.reply || null,
    });

    const myId = getMyId();
    if (authorId === myId) navigation.navigate("Profile");
    else navigation.navigate("UserProfile", { userId: authorId });
  };

  const unread = notifications.filter((n) => !n.isRead);
  const earlier = notifications.filter((n) => n.isRead);

  const sections = [];
  if (unread.length > 0) sections.push({ title: "New", data: unread });
  if (earlier.length > 0) sections.push({ title: "Earlier", data: earlier });

  const renderItem = ({ item }) => (
    <NotifCard
      n={item}
      busy={pendingIds.has(item._id)}
      onAccept={handleAccept}
      onReject={handleReject}
      onCollabRespond={handleCollabRespond}
      onDismiss={handleDismiss}
      onOpen={handleOpen}
      onOpenStory={handleOpenStory}
      onOpenMemory={handleOpenMemory}
    />
  );

  return (
    <View style={styles.container} {...panHandlers}>
      <View style={styles.header}>
        <Text style={styles.heading}>Notifications</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0095f6" />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: "#999", fontSize: 14 }}>No notifications yet</Text>
        </View>
      ) : (
        <SectionList
          ref={sectionListRef}
          sections={sections}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
          stickySectionHeadersEnabled={Platform.OS === "ios"}
          contentContainerStyle={{ paddingBottom: 90 }}
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={() => loadPage(page + 1)}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#111" }}>Load more</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ height: 80 }} />
            )
          }
        />
      )}

      {/* NEW — Navbar was never rendered on this screen before. */}
      <View style={styles.navbarWrap}>
        <Navbar />
      </View>

      {/* ← NEW — opens directly on this screen; no navigation to Home. */}
      {directStory && (
        <StoryViewer
          stories={directStory.stories}
          index={0}
          initialStoryId={directStory.initialStoryId}
          initialShowViewers={directStory.initialShowViewers}
          currentUserId={getMyId()}
          close={() => setDirectStory(null)}
        />
      )}
    </View>
  );
}

export default ActivityPage;

/* ─────────────────────────── styles ─────────────────────────── */
const styles = {
  container: { flex: 1, backgroundColor: "#fafafa" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#efefef",
  },
  heading: { fontSize: 18, fontWeight: "700", color: "#111" },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: "#fafafa",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    position: "relative",
  },
  avatarWrapper: { position: "relative", flexShrink: 0 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#ddd", alignItems: "center", justifyContent: "center" },
  typeIcon: {
    position: "absolute",
    bottom: -2,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: { flex: 1, minWidth: 0 },
  notifText: { fontSize: 13.5, lineHeight: 18, color: "#111", marginBottom: 2 },
  username: { fontWeight: "700" },
  text: { color: "#333" },
  time: { fontSize: 12, color: "#999" },

  // ── image / video thumbnail (right side) ──
  thumbWrap: { width: 44, height: 44, borderRadius: 6, overflow: "hidden", flexShrink: 0, backgroundColor: "#efefef" },
  thumbImg: { width: "100%", height: "100%" },
  thumbPlay: { position: "absolute", bottom: 2, right: 3, color: "#fff", fontSize: 10 },
  videoTile: { width: "100%", height: "100%", backgroundColor: "#222", alignItems: "center", justifyContent: "center" },
  videoTilePlay: { color: "#fff", fontSize: 14 },

  // ── text post preview (under the message) ──
  tpCard: { marginTop: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ececec", borderRadius: 12, padding: 8 },
  tpText: { fontSize: 12, lineHeight: 17, color: "#111" },
  tpStrip: { flexDirection: "row", gap: 6, marginTop: 8 },
  tpImgBox: { height: 78, borderRadius: 10, overflow: "hidden", backgroundColor: "#f0f0f0" },
  tpMore: { position: "absolute", bottom: 4, right: 6, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  tpMoreText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  actions: { flexDirection: "column", gap: 6, flexShrink: 0 },
  acceptBtn: { backgroundColor: "#0095f6", paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8 },
  acceptBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  rejectBtn: { backgroundColor: "#efefef", paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8 },
  rejectBtnText: { color: "#111", fontSize: 13, fontWeight: "600" },
  dismissBtn: { padding: 6, flexShrink: 0 },
  dismissBtnText: { color: "#999", fontSize: 20, lineHeight: 20 },
  unreadDot: { position: "absolute", right: 10, top: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: "#0095f6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { textAlign: "center", color: "#e74c3c", padding: 20, fontSize: 14 },
  loadMoreBtn: { alignSelf: "center", marginVertical: 16, backgroundColor: "#efefef", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18 },
  // NEW — same fixed bottom placement as Homepage.js's Navbar wrapper.
  navbarWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
};