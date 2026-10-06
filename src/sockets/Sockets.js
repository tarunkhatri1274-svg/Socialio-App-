import { io } from "socket.io-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";
import { playAlertSound } from "../pages/Activity/AlertSound";
import { getAuthToken, getCachedUser, forceLogout, setTokenRefreshedHandler } from "../api/authToken"; // adjust relative path



// ── RN has no "same origin" concept — there's no page being served from
// a URL, so (unlike the web version) we must always pass an explicit
// server URL. Set API_URL / SOCKET_URL in your .env (react-native-config),
// e.g. SOCKET_URL=https://your-ngrok-domain.ngrok-free.app or your LAN IP
// during dev (http://192.168.x.x:5000) — localhost will NOT reach your
// dev machine from a physical device or most emulators.
// Strip any path/query so socket.io-client doesn't misinterpret it as
// a namespace (e.g. API_URL=".../api" would otherwise try to connect
// to the "/api" namespace, which the server never registers).
function getSocketOrigin(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

const SOCKET_URL = getSocketOrigin(Config.SOCKET_URL || Config.API_URL);

setTokenRefreshedHandler((newToken) => {
  socket.auth = { token: newToken };
});

const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// ── In-memory cache of the current user, refreshed by initSocket() and by
// refreshSocketAuth() (call this after login/logout so the socket picks
// up the new/cleared token+user without needing an app restart). ──
let cachedUserId = null;

async function readCurrentUserId() {
  try {
    const user = await getCachedUser();
    return user?._id || null;
  } catch {
    return null;
  }
}

// ── Call this once at app startup (e.g. in App.js after your auth state
// is known) to connect the socket with the current token. ──
export async function initSocket() {
  try {
    const token = await getAuthToken();
    socket.auth = { token };
    cachedUserId = await readCurrentUserId();
    if (!socket.connected) socket.connect();
  } catch (err) {
    console.log("initSocket failed:", err.message);
  }
}

// ── Call this after login or logout to refresh the token the socket
// uses, and to reconnect/register under the new identity. ──
export async function refreshSocketAuth() {
  try {
    const token = await getAuthToken();
    socket.auth = { token };
    cachedUserId = await readCurrentUserId();
    if (socket.connected) {
      socket.disconnect().connect();
    } else {
      socket.connect();
    }
  } catch (err) {
    console.log("refreshSocketAuth failed:", err.message);
  }
}

socket.on("connect", () => {
  console.log("Socket connected, id:", socket.id);
  if (cachedUserId) {
    console.log("Registering as userId:", cachedUserId);
    socket.emit("register", cachedUserId);
  } else {
    console.log("No userId found — cannot register!");
  }
});
socket.on("disconnect", (reason) => {
  if (reason === "io server disconnect") {
    // Server forcibly closed the connection — client must reconnect manually.
    socket.connect();
  }
});
// ── Re-register on reconnect (e.g. after a network drop). Without this,
// the server's onlineUsers map loses this socket after a disconnect/
// reconnect cycle and all targeted emits (DMs, notifications, follow
// events) silently fail until the app is restarted. ──
socket.io.on("reconnect", async () => {
  const userId = cachedUserId || (await readCurrentUserId());
  if (userId) socket.emit("register", userId);

  // ← FIX — this used to stop at re-registering the user. Every post
  // room this socket had joined before the drop needs to be rejoined
  // too, or that screen goes silently "deaf" to new comments/replies/
  // likes for the rest of the session (see activePostRooms above).
  activePostRooms.forEach((postId) => {
    socket.emit("joinPost", postId);
  });
});

// ── In-app notification sound ───────────────────────────────────────────
// FIX — this used to build its own notifee.displayNotification() call
// with a hardcoded channelId ("socialio-default") that nothing ever
// created via notifee.createChannel(). Android 8+ requires every
// notification to belong to a channel that actually exists; firing one
// against a missing channel gets silently dropped (or shown with no
// sound/importance), which is why messages/notifications/follow events
// routed through this file never made a sound or showed a status-bar
// icon. Now this just delegates to the single shared implementation in
// AlertSound.js, which uses the real CHANNEL_ID from PushNotifications.js
// — so there's one notification code path instead of two disagreeing ones.
const playDefaultNotificationSound = (
  title = "Socialio",
  body = "You have a new notification"
) => playAlertSound({ title, body });

// ── Post "room" membership tracking ─────────────────────────────────────
// socket.join(room) on the server is tied to ONE underlying connection.
// Every time this socket disconnects and reconnects — which on mobile
// happens constantly (app backgrounded, screen locked, brief signal
// loss, switching wifi/cell) — the server drops all of this socket's
// room memberships. The old code only re-emitted "register" on
// reconnect, so the user's DMs/notifications kept working (those are
// targeted at the registered socket id directly), but every screen
// that had called socket.emit("joinPost", id) silently stopped
// receiving that post's newComment/newReply/commentLiked/etc. events
// after the FIRST reconnect, with no error and no way to tell from the
// UI — matching "existing comments load fine, nothing new ever
// arrives live, only in the app".
//
// Fix: track every currently-joined post id here, and rejoin all of
// them whenever the socket reconnects. Post.js / TextPostView.js /
// UserProfileVideoPost.js should call joinPostRoom(id)/leavePostRoom(id)
// (exported below) instead of emitting "joinPost"/"leavePost" directly,
// so this set always reflects what's actually supposed to be joined.
const activePostRooms = new Set();

export function joinPostRoom(postId) {
  if (!postId) return;
  activePostRooms.add(postId.toString());
  socket.emit("joinPost", postId);
}

export function leavePostRoom(postId) {
  if (!postId) return;
  activePostRooms.delete(postId.toString());
  socket.emit("leavePost", postId);
}

// ── Is the user currently viewing this chat? ───────────────────────────────
// window.__activeChatId doesn't exist in RN — replaced with a plain module
// variable. Call setActiveChatId(id) when a chat screen mounts/focuses,
// and setActiveChatId(null) when it unmounts/blurs.
let activeChatId = null;
export function setActiveChatId(chatId) {
  activeChatId = chatId;
}
const isChatCurrentlyOpen = (chatId) => {
  return activeChatId && chatId && activeChatId === chatId;
};

// ── Notification category → settings key map ──────────────────────────────
const NOTIF_TYPE_TO_SETTING_KEY = {
  message: "message",
  story_view: "story",
  story_like: "story",
  collab_request: "post",
  story_live: "story",
};

const POSTTYPE_TO_SETTING_KEY = {
  image: "post",
  carousel: "post",
  video: "reel",
  text: "text",
};

const POST_DEPENDENT_TYPES = new Set(["comment", "reply", "like_post", "like_comment", "new_post"]);

// AsyncStorage is async, so this settings check can't be sync like the
// web version. Cache the parsed settings and refresh them lazily.
let cachedNotifSettings = null;
export async function refreshNotifSettingsCache() {
  try {
    const raw = await AsyncStorage.getItem("notifSettings");
    cachedNotifSettings = raw ? JSON.parse(raw) : null;
  } catch {
    cachedNotifSettings = null;
  }
}

// Prime the cache once at module load; callers that change settings
// should also call refreshNotifSettingsCache() after saving.
refreshNotifSettingsCache();

const isNotifTypeAllowed = (type, postType) => {
  try {
    let settingKey = NOTIF_TYPE_TO_SETTING_KEY[type];
    if (!settingKey && POST_DEPENDENT_TYPES.has(type)) {
      settingKey = POSTTYPE_TO_SETTING_KEY[postType] || "post";
    }
    if (!settingKey) return true; // follow events — always allowed
    if (!cachedNotifSettings) return true;
    return cachedNotifSettings[settingKey] !== false;
  } catch {
    return true;
  }
};

const isMessageNotifAllowed = () => isNotifTypeAllowed("message");

// ── FIX — DUPLICATE NOTIFICATIONS ───────────────────────────────────────
// This file used to have its own socket.on("receiveMessage", ...),
// socket.on("newMessageRequest", ...), and socket.on("receiveNotification", ...)
// handlers that called playDefaultNotificationSound() directly. Those
// silently failed for a while (wrong channel, then bad icon, then bad
// vibration pattern), which masked the fact that Message.js and
// ActivityPage.js ALSO listen for these same three events and play their
// own sound via playAlertSound() — with their own "is this chat/screen
// currently open" + notifSettings checks. Once the underlying notifee bugs
// were fixed, both copies started firing for the same event, producing
// two notifications per message/like/comment.
//
// Message.js and ActivityPage.js stay mounted for the app's whole session
// (MainTabs uses lazy: false), so they're just as reliable a place for
// this as a module-level listener here — and they're the ones with the
// more specific "is the user already looking at this" context. So this
// file no longer plays sounds for these three events at all; it's kept
// purely for connection/room/settings management. isNotifTypeAllowed(),
// isChatCurrentlyOpen(), and setActiveChatId() are still exported/used
// below in case other files want them, but nothing here calls
// playDefaultNotificationSound() anymore for messages/general notifications.
//
// newFollowRequest / newFollower / followAccepted below are NOT
// duplicated anywhere else in the app, so those are untouched.

// ── Follow request sound ───────────────────────────────────────────────────
socket.on("newFollowRequest", () => {
  playDefaultNotificationSound(
    "New follow request",
    "Someone sent you a follow request"
  );
});

socket.on("newFollower", () => {
  playDefaultNotificationSound(
    "New follower",
    "Someone started following you"
  );
});

socket.on("followAccepted", () => {
  playDefaultNotificationSound(
    "Follow accepted",
    "Your follow request was accepted"
  );
});

// ── Account deleted — force logout if server says my account is gone.
// window.location.href doesn't exist in RN; this needs a navigation reset,
// which requires access to the navigation ref. Register that ref once at
// app startup via setNavigationRef(navRef) (e.g. from your root
// NavigationContainer), same idea as React Navigation's official
// "navigate without the navigation prop" pattern. ──
let navigationRef = null;
export function setNavigationRef(ref) {
  navigationRef = ref;
}

socket.on("userAccountDeleted", async ({ userId }) => {
  try {
    const myId = (await getCachedUser())?._id;
    if (myId && myId === userId) {
      clearSocketState();
      await forceLogout(); // clears the session and triggers the same
      // app-wide "kick to Login" handler apiFetch uses on a dead refresh
      // token (wired once in App.js via setUnauthorizedHandler) — no need
      // to duplicate AsyncStorage-clearing or navigation-reset logic here.
    }
  } catch {}
});

// ── Debug helpers (dev only) ───────────────────────────────────────────────
if (__DEV__) {
  socket.on("connect_error", (err) => {
    console.warn("Socket connect error:", err.message);
  });

  socket.on("disconnect", (reason) => {
    console.warn("Socket disconnected:", reason);
  });

  socket.on("reconnect_attempt", (attempt) => {
    console.log(`Socket reconnect attempt #${attempt}`);
  });

  socket.on("reconnect_failed", () => {
    console.error("Socket reconnect failed after max attempts");
  });
}

// ── Full logout/delete-account teardown — disconnects the socket and
// wipes every in-memory cache this file keeps (cachedUserId,
// activeChatId, activePostRooms, cachedNotifSettings). Without this,
// logging out only ever cleared AsyncStorage's token/user — this
// module's caches stayed alive in memory, so if a different account
// logged in afterward on the same app session, things like
// isChatCurrentlyOpen()/notifSettings could still be carrying stale
// state from the PREVIOUS account until the app was fully restarted.
// Call this from Settings.js's handleLogout and DeleteAccount.js's
// handleDelete, before (or after — order doesn't matter for this part)
// clearing AsyncStorage.
export function clearSocketState() {
  socket.disconnect();
  cachedUserId = null;
  activeChatId = null;
  activePostRooms.clear();
  cachedNotifSettings = null;
}

export default socket;