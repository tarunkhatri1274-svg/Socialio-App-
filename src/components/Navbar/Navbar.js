import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  PanResponder,
  StyleSheet,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path to this file's location
import Icon from "react-native-vector-icons/FontAwesome5";
import Svg, { Path, Circle, Line } from "react-native-svg";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Config from "react-native-config";
import socket from "../../sockets/Sockets"; // adjust path to match your RN project layout

const API = Config.API_URL;

const BADGE_COLOR = "rgb(234,182,118)";
const TOAST_DURATION_MS = 5000;
const SUMMARY_DURATION_MS = 5000;

// ── Swipe-to-switch-page tuning ──────────────────────────────────────────
// Same semantics as the web version: swipe left → next tab, swipe right →
// previous tab. On web this listened on `window` so a swipe anywhere on
// screen worked. In RN a screen-wide horizontal PanResponder would fight
// with FlatLists/carousels elsewhere on the page (e.g. the post image
// carousels), so this is scoped to the nav bar's own touch area — the
// standard mobile pattern for a swipeable tab bar.
const SWIPE_THRESHOLD = 60;
const MAX_DRAG_OFFSET = 36;
const RUBBER_BAND = 0.35;

// Screen names in your navigator — swap these if yours differ.
const PAGE_ORDER = ["Home", "Search", "VideoPage", "Notifications", "Messages", "Profile"];

/* ─────────────────────────── Auth cache (mirrors Homepage.js's pattern) ─────────────────────────── */
/* ─────────────────────────── Local (non-auth) caches ─────────────────────────── */
// cachedUser and cachedNotifSettings aren't security-sensitive like the
// access token, so they stay as simple in-memory caches here — the token
// itself is now handled entirely by apiFetch (src/api/authToken.js),
// which reads it fresh and auto-refreshes on a 401, so no token caching
// or manual Authorization header is needed in this file anymore.
let cachedUser = {};
let cachedNotifSettings = null;

async function loadLocalCaches() {
  try {
    const user = await getCachedUser();
    cachedUser = user || {};
    const rawSettings = await AsyncStorage.getItem("notifSettings");
    cachedNotifSettings = rawSettings ? JSON.parse(rawSettings) : null;
  } catch {
    cachedUser = {};
    cachedNotifSettings = null;
  }
}

function safeParseUser() {
  return cachedUser || {};
}

const fetchLatestUnread = async () => {
  const res = await apiFetch(`${API}/auth/notifications?page=1&limit=20`);
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
};

/* ─── Per-category mute gate, same mapping as the web version. Kept as a
   local copy (not shared with sockets.js) for the same reason the original
   called out: duplicating ~15 lines is cheaper than coupling this UI
   component to that module's internals. ─── */
const NOTIF_TYPE_TO_SETTING_KEY = {
  message: "message",
  story_view: "story",
  story_like: "story",
  collab_request: "post",
};

const POSTTYPE_TO_SETTING_KEY = {
  image: "post",
  carousel: "post",
  video: "reel",
  text: "text",
};

const POST_DEPENDENT_TYPES = new Set(["comment", "reply", "like_post", "like_comment"]);

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

/* ─── Replaces the MutationObserver on document.body.classList: any bottom
   sheet / modal in the app calls setCommentsOpen(true|false) when it opens
   or closes, and Navbar subscribes to hide itself while one is up. ─── */
let commentsOpenState = false;
const commentsOpenListeners = new Set();
export function setCommentsOpen(open) {
  commentsOpenState = open;
  commentsOpenListeners.forEach((fn) => fn(open));
}
function subscribeCommentsOpen(fn) {
  commentsOpenListeners.add(fn);
  fn(commentsOpenState);
  return () => commentsOpenListeners.delete(fn);
}

// Minimum finger movement (px) before we even consider a gesture a "swipe"
// candidate. Below this, both the capture and bubble variants below keep
// returning false so ordinary taps pass straight through untouched.
const SWIPE_INTENT_THRESHOLD = 8;

/* ─── "Tap the tab you're already on" reload bus ────────────────────────
   navigation.navigate("Home") while already on Home is a no-op in React
   Navigation, so tapping the active tab did nothing. Instead of calling
   navigate for the active tab, Navbar emits a reload event here; screens
   subscribe with their own screen name and refetch + scroll to top,
   mirroring how e.g. Instagram/Twitter's "tap active tab" behaves. ─── */
const tabReloadListeners = new Set();
export function subscribeTabReload(screenName, callback) {
  const handler = (name) => {
    if (name === screenName) callback();
  };
  tabReloadListeners.add(handler);
  return () => tabReloadListeners.delete(handler);
}
function emitTabReload(screenName) {
  tabReloadListeners.forEach((fn) => fn(screenName));
}

/* ─── Screen-wide "swipe to change tab" hook ─────────────────────────────
   Navbar's OWN PanResponder (further down this file) has to use
   capture-phase handlers, because it has to steal the gesture away from
   its own TouchableOpacity buttons (see the comment on that PanResponder
   for why). A screen wrapping its whole content area must NOT do that:
   capture-phase there would steal the touch from horizontal ScrollViews
   too — e.g. the post image/text carousels — before they ever got a
   chance to start scrolling.

   So screens call this hook with the default (capture: false), which
   only wires up BUBBLE-phase handlers. Bubble-phase handlers are only
   consulted if nothing deeper in the tree already claimed the responder
   — and a horizontal ScrollView/carousel, when swiped directly, claims
   it first (that's ordinary, built-in RN scroll behavior). So: swipe
   the carousel when you start the drag on it, swipe tabs everywhere
   else on the screen. */
export function useSwipeToChangeTab({ capture = false } = {}) {
  const navigation = useNavigation();
  const route = useRoute();
  const [commentsOpen, setCommentsOpen] = useState(false);
  useEffect(() => subscribeCommentsOpen(setCommentsOpen), []);

  const dragX = useRef(new Animated.Value(0)).current;
  const swipeDx = useRef(0);

  const isEligible = (g) =>
    !commentsOpen &&
    PAGE_ORDER.includes(route.name) &&
    Math.abs(g.dx) > SWIPE_INTENT_THRESHOLD &&
    Math.abs(g.dx) > Math.abs(g.dy) * 1.5;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => !capture && isEligible(g),
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) => capture && isEligible(g),
      onPanResponderTerminationRequest: () => false,
      // Always block native responders (e.g. Android's own scroll/gesture
      // views, and the native "swipe from the edge to go back" gesture)
      // from stealing the touch once we've claimed it — this used to only
      // apply when capture:true, which left the bubble-phase (screen-wide)
      // swipe unprotected. React Navigation's built-in edge-swipe-back
      // gesture only ever fires for LEFT-TO-RIGHT drags, which is exactly
      // why only right-to-left swipes were changing tabs before.
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_, g) => {
        swipeDx.current = g.dx;
        const rubberBanded = Math.max(-MAX_DRAG_OFFSET, Math.min(MAX_DRAG_OFFSET, g.dx * RUBBER_BAND));
        dragX.setValue(rubberBanded);
      },
      onPanResponderRelease: () => {
        const dx = swipeDx.current;
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true, friction: 6 }).start();

        if (Math.abs(dx) < SWIPE_THRESHOLD) return;
        const currentIndex = PAGE_ORDER.indexOf(route.name);
        if (currentIndex === -1) return;

        if (dx <= -SWIPE_THRESHOLD) {
          const nextIndex = Math.min(currentIndex + 1, PAGE_ORDER.length - 1);
          if (nextIndex !== currentIndex) navigation.navigate(PAGE_ORDER[nextIndex]);
        } else if (dx >= SWIPE_THRESHOLD) {
          const prevIndex = Math.max(currentIndex - 1, 0);
          if (prevIndex !== currentIndex) navigation.navigate(PAGE_ORDER[prevIndex]);
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true, friction: 6 }).start();
      },
    })
  ).current;

  return { panHandlers: panResponder.panHandlers, dragX };
}

// ── Type → bubble icon + color, same mapping as the web NotifCard ──
const TYPE_DISPLAY = {
  follow: { icon: "follow" },
  follow_request: { icon: "request" },
  follow_accepted: { icon: "follow" },
  like_post: { icon: "like" },
  like_comment: { icon: "like" },
  story_like: { icon: "like" },
  comment: { icon: "comment" },
  reply: { icon: "comment" },
  message: { icon: "message" },
  collab_request: { icon: "collab" },
  story_view: { icon: "story" },
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

function SmallIcon({ type }) {
  const props = { width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "white", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (type) {
    case "follow":
      return (
        <Svg {...props}>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <Circle cx="12" cy="7" r="4" />
        </Svg>
      );
    case "request":
      return (
        <Svg {...props}>
          <Circle cx="12" cy="12" r="10" />
          <Line x1="12" y1="8" x2="12" y2="16" />
          <Line x1="8" y1="12" x2="16" y2="12" />
        </Svg>
      );
    case "like":
      return (
        <Svg width={11} height={11} viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth={1.5}>
          <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </Svg>
      );
    case "comment":
      return (
        <Svg {...props}>
          <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Svg>
      );
    case "message":
      return (
        <Svg {...props}>
          <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </Svg>
      );
    case "collab":
      return (
        <Svg {...props}>
          <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <Circle cx="9" cy="7" r="4" />
          <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
      );
    case "story":
      return (
        <Svg {...props}>
          <Circle cx="12" cy="12" r="3" />
          <Circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
        </Svg>
      );
    default:
      return null;
  }
}

// ── Which of the 3 summary-popup buckets a notification type belongs to ──
const CATEGORY_BUCKET = {
  comment: "comment",
  reply: "comment",
  like_post: "like",
  like_comment: "like",
  story_like: "like",
  follow: "follow",
  follow_request: "follow",
  follow_accepted: "follow",
};

const BUCKET_ICON = {
  comment: "comment",
  like: "heart",
  follow: "user-friends",
};
const BUCKET_LABEL = { comment: "Comments", like: "Likes", follow: "Follows" };

/* ─────────────────────────── Toast banner ─────────────────────────── */
function ToastBanner({ toast, onPress, topInset }) {
  const translateY = useRef(new Animated.Value(-12)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    translateY.setValue(-12);
    opacity.setValue(0);
    Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [toast]);

  if (!toast) return null;
  const toastDisplay = TYPE_DISPLAY[toast.type];
  const toastColor = toastDisplay ? ICON_COLOR[toastDisplay.icon] : BADGE_COLOR;

  return (
    <Animated.View
      style={[
        styles.toast,
        { top: topInset + 12, opacity, transform: [{ translateX: -160 }, { translateY }] },
      ]}
    >
      <TouchableOpacity style={styles.toastInner} activeOpacity={0.9} onPress={onPress}>
        <View style={{ position: "relative" }}>
          {toast.senderAvatar ? (
            <Image source={{ uri: toast.senderAvatar }} style={styles.toastAvatar} />
          ) : (
            <View style={styles.toastAvatarFallback}>
              <Text style={{ fontWeight: "700", color: "#666", fontSize: 15 }}>
                {toast.senderUsername.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          {toastDisplay && (
            <View style={[styles.toastIconBadge, { backgroundColor: toastColor }]}>
              <SmallIcon type={toastDisplay.icon} />
            </View>
          )}
        </View>
        <Text style={styles.toastText} numberOfLines={2} ellipsizeMode="tail">
          {toast.message}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ─────────────────────────── Summary popup (comment/like/follow bucket) ─────────────────────────── */
function SummaryPopup({ bucket, count }) {
  const scale = useRef(new Animated.Value(0.94)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scale.setValue(0.94);
    opacity.setValue(0);
    Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [bucket, count]);

  return (
    <Animated.View style={[styles.summaryPopup, { opacity, transform: [{ translateX: -40 }, { scale }] }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name={BUCKET_ICON[bucket]} solid={bucket === "like"} size={13} color="#fff" />
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{count}</Text>
      </View>
      <View style={styles.summaryPopupArrow} />
    </Animated.View>
  );
}

/* ─────────────────────────── Navbar ─────────────────────────── */
function Navbar() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();

  const [profilePic, setProfilePic] = useState(null);
  const [commentsOpen, setLocalCommentsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestType, setLatestType] = useState(null);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const [categoryCounts, setCategoryCounts] = useState({ comment: 0, like: 0, follow: 0 });
  const [latestBucket, setLatestBucket] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const summaryTimerRef = useRef(null);

  // NOTE: the bar's real rendered width (measured via onLayout) — used to
  // center it correctly instead of relying on a hardcoded guess. This is
  // what fixes the "home/profile icon half outside the pill" bug: the old
  // code assumed the row was 264px wide and centered with a fixed
  // marginLeft of -132, but the row of 6 buttons + gaps + padding is
  // actually wider than that, so it overflowed the pill unevenly.
  const [barWidth, setBarWidth] = useState(0);

  const isVideoPage = route.name === "VideoPage";
  const isProfilePage = route.name === "Profile";
  const isNotificationsPage = route.name === "Notifications";

  useEffect(() => subscribeCommentsOpen(setLocalCommentsOpen), []);

  useEffect(() => {
    (async () => {
      await loadLocalCaches();
      try {
        const res = await apiFetch(`${API}/auth/profile`);
        const data = await res.json();
        if (data.success && data.user?.profilePic) setProfilePic(data.user.profilePic);
        else {
          const user = safeParseUser();
          if (user?.profilePic) setProfilePic(user.profilePic);
        }
      } catch {
        const user = safeParseUser();
        if (user?.profilePic) setProfilePic(user.profilePic);
      }
    })();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadLatest = async () => {
      try {
        const data = await fetchLatestUnread();
        if (!isMounted) return;
        setUnreadCount(data.unreadCount || 0);
        const unread = (data.notifications || []).filter((n) => !n.isRead);
        setLatestType(unread[0]?.type || null);

        const seeded = { comment: 0, like: 0, follow: 0 };
        unread.forEach((n) => {
          const bucket = CATEGORY_BUCKET[n.type];
          if (bucket) seeded[bucket] += 1;
        });
        setCategoryCounts(seeded);
      } catch {
        // Badge is non-critical — fail silently
      }
    };

    loadLatest();

    const handleNewNotification = (notif) => {
      if (!isNotifTypeAllowed(notif?.type, notif?.postType)) return;

      setUnreadCount((prev) => prev + 1);
      setLatestType(notif?.type || null);

      const bucket = CATEGORY_BUCKET[notif?.type];
      if (bucket) {
        setCategoryCounts((prev) => ({ ...prev, [bucket]: prev[bucket] + 1 }));
        setLatestBucket(bucket);
        setShowSummary(true);
        if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
        summaryTimerRef.current = setTimeout(() => setShowSummary(false), SUMMARY_DURATION_MS);
      }

      if (!notif?.message) return;

      setToast({
        message: notif.message,
        type: notif.type,
        senderAvatar: notif.sender?.profilePic || null,
        senderUsername: notif.sender?.username || "Someone",
      });

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    };

    socket.on("receiveNotification", handleNewNotification);

    return () => {
      isMounted = false;
      socket.off("receiveNotification", handleNewNotification);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isNotificationsPage) {
      setUnreadCount(0);
      setLatestType(null);
      setCategoryCounts({ comment: 0, like: 0, follow: 0 });
      setLatestBucket(null);
      setShowSummary(false);
      if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
    }
  }, [isNotificationsPage]);

  /* ── Swipe-to-switch-page: capture-phase here because the nav bar has
     to steal the gesture away from its own TouchableOpacity buttons (see
     the useSwipeToChangeTab definition above for the full explanation).
     Screens use the same hook with capture:false to get a screen-wide
     swipe that doesn't fight the post carousels. ── */
  const { panHandlers, dragX } = useSwipeToChangeTab({ capture: true });

  // Tapping the tab you're already on is a no-op for navigation.navigate
  // (React Navigation ignores navigating to the current route), so this
  // treats that case as a "reload this screen" signal instead.
  const handleTabPress = (screenName) => {
    if (route.name === screenName) emitTabReload(screenName);
    else navigation.navigate(screenName);
  };

  const getBtnStyle = (screenName) => [
    styles.navBtn,
    {
      backgroundColor: route.name === screenName ? BADGE_COLOR : "transparent",
    },
  ];
  const getIconColor = (screenName) =>
    route.name === screenName ? "#fff" : isVideoPage ? "#fff" : "#555";

  const bubble = latestType ? TYPE_DISPLAY[latestType] : null;
  const bubbleColor = bubble ? ICON_COLOR[bubble.icon] : BADGE_COLOR;

  if (commentsOpen) return null; // was z-index: -1 on web; simplest RN equivalent is to just not render

  return (
    <>
      <ToastBanner
        toast={toast}
        topInset={insets.top}
        onPress={() => {
          setToast(null);
          navigation.navigate("Notifications");
        }}
      />

      <View
        onLayout={(e) => {
          // Measure the bar's real width once it renders, and whenever it
          // changes (e.g. rotation, font scaling). This replaces the old
          // hardcoded `marginLeft: -132` / `maxWidth: 264` guess, which was
          // smaller than the bar's actual content width and caused the
          // Home and Profile buttons to poke out past the pill's edges.
          const w = e.nativeEvent.layout.width;
          if (Math.abs(w - barWidth) > 0.5) setBarWidth(w);
        }}
        style={[
          styles.navRoot,
          {
            bottom: insets.bottom + 1,
            marginLeft: barWidth ? -barWidth / 2 : 0,
            backgroundColor: isVideoPage ? "rgba(0,0,0,0.4)" : "#fff",
            shadowOpacity: isVideoPage ? 0 : 0.15,
            // Hide the bar during the very first frame before we have a
            // measurement, so it never flashes in the wrong place.
            opacity: barWidth ? 1 : 0,
          },
        ]}
        {...panHandlers}
      >
        <Animated.View style={{ flexDirection: "row", alignItems: "center", gap: 10, transform: [{ translateX: dragX }] }}>
          <TouchableOpacity style={getBtnStyle("Home")} onPress={() => handleTabPress("Home")}>
            <Icon name="home" size={18} color={getIconColor("Home")} />
          </TouchableOpacity>
          <TouchableOpacity style={getBtnStyle("Search")} onPress={() => handleTabPress("Search")}>
            <Icon name="search" size={18} color={getIconColor("Search")} />
          </TouchableOpacity>
          <TouchableOpacity style={getBtnStyle("VideoPage")} onPress={() => handleTabPress("VideoPage")}>
            <Icon name="video" size={18} color={getIconColor("VideoPage")} />
          </TouchableOpacity>

          <TouchableOpacity
            style={getBtnStyle("Notifications")}
            onPress={() => {
              setShowSummary(false);
              handleTabPress("Notifications");
            }}
          >
            <Icon name="bell" size={18} color={getIconColor("Notifications")} />
            {unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: bubbleColor }]}>
                {bubble ? (
                  <SmallIcon type={bubble.icon} />
                ) : (
                  <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                )}
              </View>
            )}
            {showSummary && latestBucket && categoryCounts[latestBucket] > 0 && (
              <SummaryPopup bucket={latestBucket} count={categoryCounts[latestBucket]} />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={getBtnStyle("Messages")} onPress={() => handleTabPress("Messages")}>
            <Icon name="envelope" size={18} color={getIconColor("Messages")} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.navBtn,
              styles.profileBtn,
              {
                borderColor: isProfilePage ? BADGE_COLOR : isVideoPage ? "rgba(255,255,255,0.5)" : "#eee",
              },
            ]}
            onPress={() => handleTabPress("Profile")}
          >
            {profilePic ? (
              <Image source={{ uri: profilePic }} style={styles.profileImg} />
            ) : (
              <Icon name="user" size={18} color={isVideoPage ? "#fff" : "#555"} />
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>
    </>
  );
}

export default Navbar;

/* ─────────────────────────── Styles ─────────────────────────── */
const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: "50%",
    zIndex: 2000,
    width: 320,
    maxWidth: "90%",
  },
  toastInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  toastAvatar: { width: 38, height: 38, borderRadius: 19 },
  toastAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
  },
  toastIconBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  toastText: { flex: 1, fontSize: 13.5, color: "#111", lineHeight: 18 },

  summaryPopup: {
    position: "absolute",
    bottom: "100%",
    left: "50%",
    marginBottom: 10,
    backgroundColor: "rgb(234,182,118)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 1500,
  },
  summaryPopupArrow: {
    position: "absolute",
    top: "100%",
    left: "50%",
    marginLeft: -7,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgb(234,182,118)",
  },

  navRoot: {
    position: "absolute",
    left: "50%",
    // marginLeft is now set dynamically in the component via onLayout —
    // do NOT hardcode it here, that's what caused the overflow bug.
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    zIndex: 1000,
    // No fixed/max width — the bar sizes itself to its content (same as
    // the web <div> behavior), and onLayout measures that real size for
    // centering.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 20,
    elevation: 6,
  },
  navBtn: {
    height: 42,
    width: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  profileBtn: { padding: 0, overflow: "hidden", borderWidth: 2, backgroundColor: "transparent" },
  profileImg: { width: "100%", height: "100%", borderRadius: 8 },

  badge: {
    position: "absolute",
    top: 1,
    right: 1,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});