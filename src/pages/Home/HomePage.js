import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  Modal,
  Alert,
  Dimensions,
  PanResponder,
  Animated,
  ActivityIndicator,
  Linking,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
  StyleSheet,
  RefreshControl
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, getCachedUser, updateCachedUser, useAuth } from "../../api/authToken";
import { useBlockedIds, subscribeBlocked, loadBlockedStore } from "../../components/State/BlockStore";
import { useRefresh } from "../../hooks/useRefreshAndSwipe"; // adjust ../ depth per file
import usePostOptions, { getOptionState, subscribeOptionChanges } from "../../components/PostCard/usePostOptions";
import { recordPostView } from "../../components/State/ViewStore";
import Icon from "react-native-vector-icons/FontAwesome5";
import FeatherIcon from "react-native-vector-icons/Feather";
import Video from "react-native-video";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import { loadMutedMap, getMutedMap, subscribeMuted } from "../../components/State/MuteStore";
import Config from "react-native-config";
import SocialioNativeAd from '../../components/Ads/SocialioNativeAd';
import { useNavigation, useIsFocused, useFocusEffect } from "@react-navigation/native";
import { carouselTouchProps } from "../../components/carouselTouch";
// These sibling files come from your project — convert/point them at their
// RN versions. They're not included in this conversion since they weren't provided.
// NEW — useSwipeToChangeTab / subscribeTabReload: shared screen-wide swipe
// hook and the "tap the active tab to reload" bus, both exported from Navbar.
import Navbar, { useSwipeToChangeTab, subscribeTabReload, setCommentsOpen } from "../../components/Navbar/Navbar";
import StoriesBar from "../../components/StoryBar/StoriesBar";
import StoryViewer from "../../components/StoryBar/StoryViewer";
import FeedStoryPreview from "../../components/StoryBar/FeedStoryPreview";
import socket from "../../sockets/Sockets";
import ShareSheet from "../../components/PostCard/ShareSheet";
import CommentSection from "../../components/PostCard/CommentSection";
import {
  useFollowStore,
  addFollowing,
  removeFollowing,
  initFollowStore,
} from "../Profile/UseFollowState";
import {
  isPostSaved,
  toggleSavedPost,
  subscribeSavedPosts,
} from "../../components/State/SavedPostStore";

const API = Config.API_URL;
const SCREEN_WIDTH = Dimensions.get("window").width;
// FIX: needed to size the bottom sheet with a real height instead of only
// `maxHeight` — see the `bottomSheet` style / BottomSheet component below.
const SCREEN_HEIGHT = Dimensions.get("window").height;
async function requestSavePermission() {
  if (Platform.OS !== "android") return true;
  if (Platform.Version >= 33) return true; // CameraRoll.save needs no runtime perm on API 33+
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    {
      title: "Storage permission",
      message: "Allow access to save this post to your gallery.",
      buttonPositive: "Allow",
    }
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}
// Replaces sessionStorage.getItem("openStoryUserId") — a plain in-memory
// value that survives for the JS runtime's lifetime (i.e. until app kill),
// same practical scope sessionStorage had for cross-page navigation on web.
let pendingOpenStoryUserId = null;
export function setPendingOpenStoryUserId(id) {
  pendingOpenStoryUserId = id;
}

// ← NEW — companion flag to pendingOpenStoryUserId: a story_view/story_like
// notification sets this before navigating Home, asking the preview that's
// about to open to also pop its Viewers sheet. Consumed alongside
// pendingOpenStoryUserId in the same effect below.
let pendingOpenStoryShowViewers = false;
export function setPendingOpenStoryShowViewers(v) {
  pendingOpenStoryShowViewers = v;
}

// FIXED — the handoff previously only carried WHICH USER's stories to
// open, never WHICH SPECIFIC STORY ITEM. ActivityPage.js's handleOpenStory
// already validates that exact story still exists before navigating, but
// was throwing that id away — so the preview always fell back to its
// first slide, regardless of which story was actually liked/viewed. This
// carries that id through so the preview can jump to the right slide.
let pendingOpenStoryId = null;
export function setPendingOpenStoryId(id) {
  pendingOpenStoryId = id;
}

function shareCount(shares) {
  if (Array.isArray(shares)) return shares.length;
  if (typeof shares === "number") return shares;
  return 0;
}

function formatCount(num) {
  const n = Number(num) || 0;
  if (n < 1000) return `${n}`;
  const format = (value, suffix) => {
    const rounded = Math.floor(value * 10) / 10;
    const str = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
    return `${str}${suffix}`;
  };
  if (n < 1_000_000) return format(n / 1000, "k");
  if (n < 1_000_000_000) return format(n / 1_000_000, "m");
  return format(n / 1_000_000_000, "b");
}

function timeAgo(createdAt) {
  if (!createdAt) return "";
  const diff = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const INTERACTED_KEY = "interactedPostIds";
async function markPostInteracted(postId) {
  try {
    const raw = await AsyncStorage.getItem(INTERACTED_KEY);
    const stored = JSON.parse(raw || "[]");
    if (!stored.includes(postId)) {
      stored.push(postId);
      await AsyncStorage.setItem(INTERACTED_KEY, JSON.stringify(stored));
    }
  } catch {}
}

// window.confirm replacement
function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

const DOUBLE_TAP_DELAY = 300;
// NOTE: same as PostCard.js/TextPostView.js/Explore.js — no competing
// single-tap timer here (a single tap on a post's media/caption does
// nothing, only a double tap triggers `onDoubleTap`), so the 280ms/300ms
// race condition fixed in the video files doesn't apply to this hook.
// Confirmed correct as-is, left unchanged.
function useDoubleTap(onDoubleTap) {
  const lastTapRef = useRef(0);
  return () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      lastTapRef.current = 0;
      onDoubleTap();
    } else {
      lastTapRef.current = now;
    }
  };
}

/* ─────────────────────────── HeartBurst (Animated) ─────────────────────────── */
function HeartBurst({ show }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!show) return;
    scale.setValue(0.3);
    opacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]),
      Animated.timing(scale, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, delay: 150, useNativeDriver: true }),
    ]).start();
  }, [show]);

  if (!show) return null;
  return (
    <View style={styles.heartBurstOverlay} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <Icon name="thumbs-up" solid size={84} color="rgb(234,182,118)" />
      </Animated.View>
    </View>
  );
}

/* ─────────────────────────── Spinner ─────────────────────────── */
function Spinner({ size = 28, color = "#f5a623" }) {
  return <ActivityIndicator size={size > 24 ? "large" : "small"} color={color} />;
}

/* ─────────────────────────── Avatar ─────────────────────────── */
function Avatar({ src, username, size = 38, style: extra = {}, onPress, storyState }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const inner = src ? (
    <Image
      source={{ uri: src }}
      style={[{ width: size, height: size, borderRadius: size / 2 }, extra]}
    />
  ) : (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: "#1877f2",
          alignItems: "center",
          justifyContent: "center",
        },
        extra,
      ]}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>{letter}</Text>
    </View>
  );

  if (!storyState) {
    return (
      <TouchableOpacity activeOpacity={onPress ? 0.7 : 1} onPress={onPress} disabled={!onPress}>
        {inner}
      </TouchableOpacity>
    );
  }

  const ringBg = storyState === "seen" ? "#c7c7c7" : "rgb(234,182,118)";
  const ringSize = size + 6;

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <View
        style={{
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          backgroundColor: ringBg,
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
        }}
      >
        <View
          style={{
            width: "100%",
            height: "100%",
            borderRadius: ringSize / 2,
            backgroundColor: "#fff",
            alignItems: "center",
            justifyContent: "center",
            padding: 2,
          }}
        >
          {inner}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* ─────────────────────────── CaptionText ─────────────────────────── */
function CaptionText({ text, limit = 100, textStyle }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text style={textStyle}>
        {text}
        {isLong && (
          <Text onPress={() => setExpanded(false)} style={styles.moreBtn}>
            {" "}less
          </Text>
        )}
      </Text>
    );
  }

  return (
    <Text style={textStyle}>
      {text.slice(0, limit).trimEnd()}...
      <Text onPress={() => setExpanded(true)} style={styles.moreBtn}>
        {" "}more
      </Text>
    </Text>
  );
}

/* ─────────────────────────── LikesSummary ─────────────────────────── */
function LikesSummary({ likedByUsers, likesCount, hideLikeCount, isOwner, onOpen }) {
  if (hideLikeCount && !isOwner) return null;
  if (!likesCount) return null;
  const first = likedByUsers?.[0];
  const others = likesCount - (first ? 1 : 0);

  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
      <Text style={styles.likesSummary}>
        {first ? (
          <>
            Liked by <Text style={{ fontWeight: "700" }}>{first.username}</Text>
            {others > 0 && (
              <Text>
                {" "}and {formatCount(others)} other{others > 1 ? "s" : ""}
              </Text>
            )}
          </>
        ) : (
          <Text>
            {formatCount(likesCount)} like{likesCount > 1 ? "s" : ""}
          </Text>
        )}
      </Text>
    </TouchableOpacity>
  );
}

function BottomSheet({ title, onClose, children, inputBar, scrollable = true }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);

  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 2 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.6) {
          Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: false }).start(() =>
            onCloseRef.current()
          );
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
      },
    })
  ).current;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.sheetOverlay}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.bottomSheet, { transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} style={{ paddingBottom: 4 }}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitleText}>{title}</Text>
              <TouchableOpacity
                onPress={onClose}
                style={styles.sheetCloseIcon}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <FeatherIcon name="x" size={20} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

         {scrollable ? (
  <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
    {ready ? children : <ActivityIndicator style={{ marginTop: 30 }} color="#999" />}
  </ScrollView>
) : (
  <View style={{ flex: 1 }}>
    {ready ? children : <ActivityIndicator style={{ marginTop: 30 }} color="#999" />}
  </View>
)}
          {inputBar}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─────────────────────────── LikersSheet ─────────────────────────── */
function LikersSheet({ postId, onClose, onNavigate }) {
  const [likers, setLikers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLikers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/likers/${postId}`);
        const data = await res.json();
        if (data.success) setLikers(data.likedBy ?? []);
      } catch {}
      finally {
        setLoading(false);
      }
    };
    fetchLikers();

    const onPostLikes = ({ likedBy }) => {
      if (likedBy) setLikers(likedBy);
    };
    socket.emit("joinPost", postId);
    socket.on(`post:${postId}:likes`, onPostLikes);
    return () => {
      socket.emit("leavePost", postId);
      socket.off(`post:${postId}:likes`, onPostLikes);
    };
  }, [postId]);

  const filtered = likers.filter((u) => u.username?.toLowerCase().includes(search.toLowerCase()));

  return (
    <BottomSheet title="Liked by" onClose={onClose}>
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
        <View style={styles.searchWrap}>
          <FeatherIcon name="search" size={14} color="#999" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search" style={styles.searchInput} />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <FeatherIcon name="x" size={14} color="#999" />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
        {loading ? (
          <Text style={styles.emptyText}>Loading...</Text>
        ) : filtered.length === 0 ? (
          <Text style={styles.emptyText}>{search ? "No results found" : "No likes yet"}</Text>
        ) : (
          filtered.map((u, i) => (
            <TouchableOpacity
              key={u._id ?? i}
              onPress={() => {
                onClose();
                onNavigate(u._id);
              }}
              style={styles.userRow}
            >
              <Avatar src={u.profilePic} username={u.username} size={40} />
              <View>
                <Text style={{ fontSize: 15, fontWeight: "600" }}>{u.username}</Text>
                {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>
    </BottomSheet>
  );
}

/* ─────────────────────────── CommentsSheet ─────────────────────────── */
function CommentsSheet({ postId, postAuthorId, comments, setComments, onClose, onInteract }) {
  const { user: currentUser } = useAuth();
  const username = currentUser?.username || "Me";
  const [commentText, setCommentText] = useState("");

  const addComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${postId}`, {
        method: "POST",
        body: JSON.stringify({ text: commentText })
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) => (prev.some((c) => c._id === data.comment._id) ? prev : [...prev, data.comment]));
        setCommentText("");
        onInteract?.(postId);
      }
    } catch (err) {
      console.log(err);
    }
  };

const inputBar = (
  <View style={styles.commentInputBar}>
    <Avatar src={currentUser?.profilePic} username={username} size={32} />
    <TextInput
      value={commentText}
      onChangeText={setCommentText}
      onSubmitEditing={addComment}
      blurOnSubmit={false}
      placeholder="Add a comment..."
      style={{ flex: 1, fontSize: 14 }}
    />
    <TouchableOpacity onPressIn={addComment} disabled={!commentText.trim()}>
      <Text style={{ color: "#1877f2", fontWeight: "700", fontSize: 14 }}>Post</Text>
    </TouchableOpacity>
  </View>
);

  return (
    <BottomSheet scrollable={false} title={`Comments (${formatCount(comments.length)})`} onClose={onClose} inputBar={inputBar}>
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <CommentSection comments={comments} setComments={setComments} currentUser={currentUser} postId={postId} postAuthorId={postAuthorId} fillParent />
      </View>
    </BottomSheet>
  );
}

function AllCaughtUpDivider() {
  return (
    <View style={styles.caughtUpWrap}>
      <Icon name="check-circle" solid size={36} color="rgb(234,182,118)" style={{ marginBottom: 10 }} />
      <Text style={{ fontWeight: "700", fontSize: 16, color: "#111", marginBottom: 4 }}>
        You're all caught up
      </Text>
      <Text style={{ fontSize: 13, color: "#999", textAlign: "center" }}>
        You've seen all posts from people you follow.{"\n"}Here are some posts you might like.
      </Text>
    </View>
  );
}

/* ─────────────────────────── Follow state / button ─────────────────────────── */
function useFollowState(authorId, authorPrivate, onFollowChange, myFollowingIds) {
  const { follow, unfollow } = useFollowStore();
  const [followState, setFollowState] = useState("none");

  useEffect(() => {
    setFollowState(myFollowingIds?.includes(authorId.toString()) ? "following" : "none");
  }, [authorId, myFollowingIds]);

  const handleFollowBtn = async () => {
    try {
      if (followState === "none") {
        const res = await apiFetch(`${API}/auth/follow/${authorId}`, { method: "POST" });
        const data = await res.json();
        if (!data.success) return;
        setFollowState(authorPrivate ? "requested" : "following");
        if (!authorPrivate) {
          follow(authorId);
          onFollowChange(authorId, true);
        }
      } else if (followState === "requested") {
        const res = await apiFetch(`${API}/auth/cancel-follow/${authorId}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.success) return;
        setFollowState("none");
        unfollow(authorId);
        onFollowChange(authorId, false);
        socket.emit("unfollowUser", { toUserId: authorId });
      } else if (followState === "following") {
        const ok = await confirmAsync("Unfollow this user?");
        if (!ok) return;
        const res = await apiFetch(`${API}/auth/unfollow/${authorId}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.success) return;
        setFollowState("none");
        unfollow(authorId);
        onFollowChange(authorId, false);
        socket.emit("unfollowUser", { toUserId: authorId });
      }
    } catch (err) {
      console.log(err);
    }
  };

  const followLabel =
    followState === "following" ? "Following" : followState === "requested" ? "Requested" : "Follow";
  const followBtnBg = followState !== "none" ? "#f0f0f0" : "rgb(234,182,118)";
  const followBtnColor = followState !== "none" ? "#333" : "#fff";

  return { followState, setFollowState, handleFollowBtn, followLabel, followBtnBg, followBtnColor };
}

function FollowButton({ authorId, isPrivate, isOwner, isBlocked, username, onFollowChange, myFollowingIds }) {
  const [authorPrivate, setAuthorPrivate] = useState(isPrivate);
  useEffect(() => setAuthorPrivate(isPrivate), [isPrivate]);

  const { followState, handleFollowBtn, followLabel, followBtnBg, followBtnColor } = useFollowState(
    authorId,
    authorPrivate,
    onFollowChange,
    myFollowingIds
  );

  if (isOwner || isBlocked) return null;
  return (
    <TouchableOpacity
      onPress={handleFollowBtn}
      style={[
        styles.followBtn,
        { backgroundColor: followBtnBg, borderWidth: followState !== "none" ? 1 : 0, borderColor: "#ddd" },
      ]}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color: followBtnColor }}>{followLabel}</Text>
    </TouchableOpacity>
  );
}

/* ─────────────────────────── FeedTagsRow / FeedCollabRow ─────────────────────────── */
function FeedTagsRow({ tags, navigation }) {
  if (!tags?.length) return null;

  const goToTaggedUser = async (tag) => {
    try {
      const res = await apiFetch(`${API}/auth/search?q=${encodeURIComponent(tag)}`);
      if (!res.ok) return;
      const data = await res.json();
      const results = Array.isArray(data) ? data : data.users || [];
      const match = results.find((u) => u.username?.toLowerCase() === tag.toLowerCase());
      if (!match) return;
      // FIX: tapping your OWN tag used to open the generic "UserProfile"
      // viewer with your own id, instead of your real Profile tab.
      const currentUser = await getCachedUser();
      const myId = (currentUser?._id || currentUser?.id)?.toString();
      if (match._id?.toString() === myId) {
        navigation.navigate("MainTabs", { screen: "Profile" });
      } else {
        navigation.navigate("UserProfile", { userId: match._id });
      }
    } catch {}
  };

  return (
    <View style={styles.tagsRow}>
      {tags.map((t) => (
        <TouchableOpacity key={t} onPress={() => goToTaggedUser(t)} style={styles.tagChip}>
          <Text style={{ color: "#f5a623", fontSize: 11, fontWeight: "600" }}>#{t}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
// NOTE: no changes here per request — collaborators for a post stay shown
// under the post itself (this row), not attached to the author's name.
// No collaborator sheet added, same as Explore.js.
function FeedCollabRow({ collaborators, navigation }) {
  const { user: currentUser } = useAuth();
  const accepted = (collaborators || []).filter((c) => c.status === "accepted");
  if (!accepted.length) return null;
  // FIX: tapping a collaborator chip for yourself used to open the
  // generic "UserProfile" viewer instead of your real Profile tab.
  const myId = (currentUser?._id || currentUser?.id)?.toString();
  const goToCollab = (userId) => {
    if (!userId) return;
    if (userId?.toString() === myId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId });
    }
  };
  return (
    <View style={styles.collabRow}>
      <Text style={{ fontSize: 11, color: "#aaa", fontWeight: "600" }}>WITH</Text>
      {accepted.map((c) => (
        <TouchableOpacity
          key={c.user?._id ?? c._id}
          onPress={() => goToCollab(c.user?._id)}
          style={styles.collabChip}
        >
          {c.user?.profilePic ? (
            <Image source={{ uri: c.user.profilePic }} style={{ width: 16, height: 16, borderRadius: 8 }} />
          ) : (
            <View style={styles.collabChipLetter}>
              <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>
                {c.user?.username?.[0]?.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ fontSize: 11, fontWeight: "600" }}>{c.user?.username}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function getSlideCaption(p, index) {
  const m = p?.media?.[index];
  if (m && typeof m.caption === "string") return m.caption;
  return p?.caption || p?.text || "";
}
function FeedCarousel({ media, onOpen, cardWidth, onIndexChange }) {
  const [current, setCurrent] = useState(0);
  const total = media?.length || 0;
  if (!total) return null;

  const width = cardWidth || SCREEN_WIDTH;

  const onMomentumScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    const next = Math.max(0, Math.min(idx, total - 1));
    setCurrent(next);
    onIndexChange?.(next);
  };

  return (
    <View style={{ position: "relative" }}>
      <ScrollView
        horizontal
        pagingEnabled
        nestedScrollEnabled
        directionalLockEnabled
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        {...carouselTouchProps}
      >
        {media.map((m, i) => (
          <TouchableOpacity key={i} activeOpacity={1} onPress={onOpen} style={{ width }}>
            <Image source={{ uri: m.url }} style={[styles.postImg, { width }]} resizeMode="cover" />
          </TouchableOpacity>
        ))}
      </ScrollView>
      {total > 1 && (
        <>
          <View style={styles.carouselDotsWrap} pointerEvents="none">
            {media.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.carouselDot,
                  { width: i === current ? 16 : 5, backgroundColor: i === current ? "#fff" : "rgba(255,255,255,0.5)" },
                ]}
              />
            ))}
          </View>
          <View style={styles.carouselCounter} pointerEvents="none">
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>
              {current + 1}/{total}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

/* ─────────────────────────── FeedCarousel (swipeable image carousel) ─────────────────────────── */


/* ─── Dropdown menus need a from-scratch replacement for the web's
   "click outside to close" (document mousedown listener). We measure the
   trigger button's on-screen position and render the menu in a transparent
   full-screen Modal whose backdrop press closes it. ─── */
function useAnchoredMenu() {
  const anchorRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ y: 0 });

  const open = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setCoords({ y: y + height });
      setVisible(true);
    });
  };
  const close = () => setVisible(false);
  return { anchorRef, visible, coords, open, close };
}

function AnchoredMenu({ visible, coords, onClose, children }) {
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose}>
        <View style={[styles.dropdown, { position: "absolute", top: coords.y + 4, right: 16 }]}>{children}</View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─────────────────────────── ImageFeedCard ─────────────────────────── */
// NEW: `onSheetOpen` — fired whenever this card's own Likers/Comments/
// Share sheet opens or closes, so Homepage can drop the Navbar's zIndex
// behind whatever sheet is currently showing.
function ImageFeedCard({
  p,
  navigation,
  onBlock,
  onNotInterested,
  onHide,
  onDeleted,
  onFollowChange,
  myFollowingIds,
  storyAuthorIds,
  seenStoryIds,
  onInteract,
  onOpenStory,
  onSheetOpen,
}) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();
  const isOwner = currentUserId === p?.author?._id?.toString() || currentUserId === p?.author?.toString();
  const authorId = p?.author?._id || p?.author;
  const username = p?.author?.username || p?.username || "Unknown";
  const isPrivate = p?.author?.isPrivate ?? false;
  const authorHasStory = storyAuthorIds?.has(authorId?.toString());
  const authorStoryState = authorHasStory ? (seenStoryIds?.has(authorId?.toString()) ? "seen" : "unseen") : null;

  const hideLikeCount = !!p?.hideLikeCount;
  const hideCommentCount = !!p?.hideCommentCount;
  const disableDownload = !!p?.disableDownload;
  const disableComments = !!p?.disableComments;
  const canDownload = !disableDownload || isOwner;
  const canComment = !disableComments || isOwner;
const isDownloadingRef = useRef(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(p?.likes?.length || 0);
  const [likedByUsers, setLikedByUsers] = useState([]);
  const [saved, setSaved] = useState(() => isPostSaved(p?._id));
  const menu = useAnchoredMenu();
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [comments, setComments] = useState(p?.comments ?? []);
  const [downloadCount, setDownloadCount] = useState(p?.downloadsCount || p?.downloads?.length || 0);
  // ── all ⋮-menu actions live in usePostOptions.js ──
  const {
    options: menuOptions,
    isHidden,
    isNotInterested,
    isBlocked,
    removedFromView,
    setRemovedFromView,
  } = usePostOptions({
    post: p,
    isOwner,
    authorId,
    username,
    noun: "post",
    menu: menu,
    currentUserId: currentUserId,
    onBlock,
    onDeleted,
    onNotInterested,
    onHide,
  });

  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const [sharesCount, setSharesCount] = useState(shareCount(p?.shares) ?? p?.sharesCount ?? 0);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);
  const [slideIndex, setSlideIndex] = useState(0);
  const slideCaption = getSlideCaption(p, slideIndex);
  useEffect(() => {
    if (showLikers || showComments || showShare) {
      setCommentsOpen(true);
      return () => setCommentsOpen(false);
    }
  }, [showLikers, showComments, showShare]);

  useEffect(() => {
    if (!p?._id) return;
    socket.emit("joinPost", p._id);
    const fetchLikers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/likers/${p._id}`);
        const data = await res.json();
        if (data.success) {
          setLikesCount(data.totalLikes ?? 0);
          setLikedByUsers(data.likedBy ?? []);
          setLiked((data.likedBy ?? []).some((u) => u._id?.toString() === currentUserId));
        }
      } catch (err) {
        console.log(err);
      }
    };
    fetchLikers();
    const fetchComments = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-comment/${p._id}`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch (err) {
        console.log(err);
      }
    };
    fetchComments();

    const fetchCollaborators = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-post/${p._id}`);
        const data = await res.json();
        if (data.success) setCollaborators(data.post.collaborators ?? []);
      } catch {}
    };
    fetchCollaborators();

    const onPostLikes = ({ totalLikes, likedBy }) => {
      setLikesCount(totalLikes);
      if (likedBy) {
        setLikedByUsers(likedBy);
        setLiked(likedBy.some((u) => u._id?.toString() === currentUserId));
      }
    };
    const onNewComment = ({ comment }) => {
      setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    };
    const onCommentDeleted = ({ commentId }) => {
      setComments((prev) => prev.filter((c) => c._id !== commentId));
    };
    const onPostDeletedForMe = ({ postId }) => {
      if (postId === p._id) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      }
    };
    const onShareCount = ({ postId, totalShares }) => {
      if (postId === p._id && totalShares != null) setSharesCount(totalShares);
    };
    const onCollabResponded = ({ postId }) => { if (postId === p._id) fetchCollaborators(); };
    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== p._id) return;
      setCollaborators((prev) => prev.filter((c) => (c.user?._id ?? c.user)?.toString() !== userId));
    };
    socket.on(`post:${p._id}:likes`, onPostLikes);
    socket.on(`post:${p._id}:newComment`, onNewComment);
    socket.on(`post:${p._id}:commentDeleted`, onCommentDeleted);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("postShared", onShareCount);
    socket.on("collabResponded", onCollabResponded);
    socket.on("collabRemoved", onCollabRemoved);
    return () => {
      socket.emit("leavePost", p._id);
      socket.off(`post:${p._id}:likes`, onPostLikes);
      socket.off(`post:${p._id}:newComment`, onNewComment);
      socket.off(`post:${p._id}:commentDeleted`, onCommentDeleted);
      socket.off("postDeleted", onPostDeletedForMe);
      socket.off("postShared", onShareCount);
      socket.off("collabResponded", onCollabResponded);
      socket.off("collabRemoved", onCollabRemoved);
    };
  }, [p?._id]);

  useEffect(() => {
    const unsub = subscribeSavedPosts((postId, savedState) => {
      if (postId === p?._id) setSaved(savedState);
    });
    return unsub;
  }, [p?._id]);

  const toggleSave = () => toggleSavedPost(p);

  const download = async () => {
    if (!canDownload || isDownloadingRef.current) return;
    const mediaList = p?.media || [];
    if (!mediaList.length) return;

    isDownloadingRef.current = true;
    try {
      const hasPermission = await requestSavePermission();
      if (!hasPermission) {
        Alert.alert("Permission needed", "Storage access is required to save this post.");
        return;
      }

      const { dirs } = ReactNativeBlobUtil.fs;

      for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i];
        const isVideo = item.type === "video" || /\.(mp4|mov|m4v)(\?|$)/i.test(item.url);
        const ext = isVideo ? "mp4" : "jpg";
        const localPath = `${dirs.CacheDir}/${p?._id || "post"}_${Date.now()}_${i}.${ext}`;

        try {
          // Download the actual bytes to a local file (no browser involved)
          const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true }).fetch(
            "GET",
            item.url
          );

          // Save the local file straight into the gallery
          await CameraRoll.save(`file://${res.path()}`, {
            type: isVideo ? "video" : "photo",
            album: "Downloads",
          });
        } finally {
          // Remove the temp copy so the cache doesn't fill up
          ReactNativeBlobUtil.fs.unlink(localPath).catch(() => {});
        }
      }

      setDownloadCount((c) => c + 1);
      Alert.alert("Saved", "Post saved to your gallery.");
    } catch (err) {
      console.log("[download] failed:", err?.message);
      Alert.alert("Download failed", "Something went wrong while saving this post.");
    } finally {
      isDownloadingRef.current = false;
    }
  };

  const handleLike = async () => {
    try {
      const res = await apiFetch(`${API}/auth/like/${p._id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikesCount(data.totalLikes);
        if (data.liked) onInteract?.(p._id);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const triggerDoubleTapLike = () => {
    if (!liked) handleLike();
    setShowHeartBurst(true);
    setTimeout(() => setShowHeartBurst(false), 800);
  };
  const handleMediaTap = useDoubleTap(triggerDoubleTapLike);





  const goToProfile = (id) => {
    if (!id) return;
    // FIX: tapping your own name/avatar used to open the generic
    // "UserProfile" viewer instead of your real Profile tab.
    if (id?.toString() === currentUserId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId: id });
    }
  };


  const handleAvatarClick = () => {
    if (authorHasStory) onOpenStory?.(authorId);
    else goToProfile(authorId);
  };

  if (removedFromView) return null;

  return (
    <>
      <View style={styles.imgCard}>
        <View style={styles.imgHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar
              src={p?.author?.profilePic}
              username={username}
              size={38}
              onPress={handleAvatarClick}
              storyState={authorStoryState}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.uname} onPress={() => goToProfile(authorId)}>
                {username}
              </Text>
              <Text style={{ fontSize: 11, color: "#aaa" }}>{timeAgo(p?.createdAt)}</Text>
              {!isOwner && !isBlocked && (
                <FollowButton
                  authorId={authorId}
                  isPrivate={isPrivate}
                  isOwner={isOwner}
                  isBlocked={isBlocked}
                  myFollowingIds={myFollowingIds}
                  username={username}
                  onFollowChange={onFollowChange}
                />
              )}
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TouchableOpacity onPress={toggleSave} style={[styles.headerIconBtn, { backgroundColor: saved ? "#fff8e1" : "#f0f0f0" }]}>
              <Icon name="bookmark" solid={saved} size={14} color={saved ? "#f5a623" : "#888"} />
            </TouchableOpacity>
            <TouchableOpacity ref={menu.anchorRef} onPress={menu.open} style={styles.headerIconBtn}>
              <Icon name="ellipsis-v" size={14} color="#555" />
            </TouchableOpacity>
            <AnchoredMenu visible={menu.visible} coords={menu.coords} onClose={menu.close}>
              {menuOptions.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={opt.action}
                  disabled={opt.label === "Blocked"}
                  style={[styles.dropdownItem, i === menuOptions.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Text style={{ fontSize: 14, fontWeight: "500", color: opt.color }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </AnchoredMenu>
          </View>
        </View>

       <View style={{ position: "relative" }}>
   <FeedCarousel media={p.media} onOpen={handleMediaTap} onIndexChange={setSlideIndex} />
  <HeartBurst show={showHeartBurst} />
</View>

        <LikesSummary
          likedByUsers={likedByUsers}
          likesCount={likesCount}
          hideLikeCount={hideLikeCount}
          isOwner={isOwner}
          onOpen={() => setShowLikers(true)}
        />

        {!!slideCaption && (
          <Text style={styles.caption}>
            <Text style={{ fontWeight: "700" }} onPress={() => goToProfile(authorId)}>
              {username}{"  "}
            </Text>
            <CaptionText key={slideIndex} text={slideCaption} />
          </Text>
        )}

        <FeedTagsRow tags={p?.tags} navigation={navigation} />
        <FeedCollabRow collaborators={collaborators} navigation={navigation} />

        <View style={styles.imgActions}>
          <TouchableOpacity onPress={handleLike} style={styles.imgActionBtn}>
            <Icon name="thumbs-up" solid={liked} size={17} color={liked ? "rgb(234,182,118)" : "#555"} />
            {(!hideLikeCount || isOwner) && (
              <Text onPress={() => setShowLikers(true)} style={{ fontSize: 13, fontWeight: "600", color: liked ? "rgb(234,182,118)" : "#555" }}>
                {formatCount(likesCount)}
              </Text>
            )}
          </TouchableOpacity>
          {canComment && (
            <TouchableOpacity onPress={() => setShowComments(true)} style={styles.imgActionBtn}>
              <Icon name="comment" size={17} color="#555" />
              {(!hideCommentCount || isOwner) && comments.length > 0 && (
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#555" }}>{formatCount(comments.length)}</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { menu.close(); setShowShare(true); }} style={styles.imgActionBtn}>
            <Icon name="paper-plane" size={17} color="#555" />
            {sharesCount > 0 && (
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#555" }}>{formatCount(sharesCount)}</Text>
            )}
          </TouchableOpacity>
          {canDownload && (
            <TouchableOpacity onPress={download} style={styles.imgActionBtn}>
              <Icon name="download" size={16} color="#555" />
              {downloadCount > 0 && (
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#555" }}>{formatCount(downloadCount)}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showLikers && <LikersSheet postId={p._id} onClose={() => setShowLikers(false)} onNavigate={goToProfile} />}
      {showComments && canComment && (
        <CommentsSheet
          postId={p._id}
          postAuthorId={p.author?._id || p.author}
          comments={comments}
          setComments={setComments}
          onClose={() => setShowComments(false)}
          onInteract={onInteract}
        />
      )}
      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── VideoFeedCard ─────────────────────────── */
// NEW: `onSheetOpen`, same as ImageFeedCard.
function VideoFeedCard({
  p,
  navigation,
  onBlock,
  onNotInterested,
  onHide,
  onDeleted,
  onFollowChange,
  myFollowingIds,
  storyAuthorIds,
  seenStoryIds,
  onInteract,
  onOpenStory,
  isVisible: isVisibleProp, // driven by FlatList viewability tracking in Homepage, replaces IntersectionObserver
  onSheetOpen,
}) {
  // FIX — isVisibleProp only tracks whether this card is scrolled into
  // view; it has no idea whether the Home screen itself still has
  // navigation focus. Without this, tapping into a profile or any other
  // screen on top of Home left the video "visible" as far as this
  // component knew, so its audio kept playing in the background the
  // whole time you were elsewhere in the app. Combining with
  // useIsFocused stops it the instant you navigate away and resumes it
  // automatically when you come back to Home.
  const isScreenFocused = useIsFocused();
  const isVisible = isVisibleProp && isScreenFocused;
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();
  const isOwner = currentUserId === p?.author?._id?.toString() || currentUserId === p?.author?.toString();
  const authorId = p?.author?._id || p?.author;
  const username = p?.author?.username || p?.username || "Unknown";
  const isPrivate = p?.author?.isPrivate ?? false;
  const authorHasStory = storyAuthorIds?.has(authorId?.toString());
  const authorStoryState = authorHasStory ? (seenStoryIds?.has(authorId?.toString()) ? "seen" : "unseen") : null;

  const hideLikeCount = !!p?.hideLikeCount;
  const hideCommentCount = !!p?.hideCommentCount;
  const disableDownload = !!p?.disableDownload;
  const disableComments = !!p?.disableComments;
  const canDownload = !disableDownload || isOwner;
  const canComment = !disableComments || isOwner;
const isDownloadingRef = useRef(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(p?.likes?.length || 0);
  const [likedByUsers, setLikedByUsers] = useState([]);
  const [saved, setSaved] = useState(() => isPostSaved(p?._id));
  const menu = useAnchoredMenu();
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [comments, setComments] = useState(p?.comments ?? []);
  const [downloadCount, setDownloadCount] = useState(p?.downloadsCount || p?.downloads?.length || 0);
  // ── all ⋮-menu actions live in usePostOptions.js ──
  const {
    options: menuOptions,
    isHidden,
    isNotInterested,
    isBlocked,
    removedFromView,
    setRemovedFromView,
  } = usePostOptions({
    post: p,
    isOwner,
    authorId,
    username,
    noun: "video",
    menu: menu,
    currentUserId: currentUserId,
    onBlock,
    onDeleted,
    onNotInterested,
    onHide,
  });

  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [sharesCount, setSharesCount] = useState(shareCount(p?.shares) ?? p?.sharesCount ?? 0);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);

  useEffect(() => {
    if (showLikers || showComments || showShare) {
      setCommentsOpen(true);
      return () => setCommentsOpen(false);
    }
  }, [showLikers, showComments, showShare]);

  useEffect(() => {
    if (isVisible && p?._id) recordPostView(p._id);
  }, [isVisible, p?._id]);

  useEffect(() => {
    if (!p?._id) return;
    socket.emit("joinPost", p._id);
    const fetchLikers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/likers/${p._id}`);
        const data = await res.json();
        if (data.success) {
          setLikesCount(data.totalLikes ?? 0);
          setLikedByUsers(data.likedBy ?? []);
          setLiked((data.likedBy ?? []).some((u) => u._id?.toString() === currentUserId));
        }
      } catch (err) {
        console.log(err);
      }
    };
    fetchLikers();
    const fetchComments = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-comment/${p._id}`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch (err) {
        console.log(err);
      }
    };
    fetchComments();

    const fetchCollaborators = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-post/${p._id}`);
        const data = await res.json();
        if (data.success) setCollaborators(data.post.collaborators ?? []);
      } catch {}
    };
    fetchCollaborators();

    const onPostLikes = ({ totalLikes, likedBy }) => {
      setLikesCount(totalLikes);
      if (likedBy) {
        setLikedByUsers(likedBy);
        setLiked(likedBy.some((u) => u._id?.toString() === currentUserId));
      }
    };
    const onNewComment = ({ comment }) => {
      setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    };
    const onCommentDeleted = ({ commentId }) => {
      setComments((prev) => prev.filter((c) => c._id !== commentId));
    };
    const onPostDeletedForMe = ({ postId }) => {
      if (postId === p._id) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      }
    };
    const onShareCount = ({ postId, totalShares }) => {
      if (postId === p._id && totalShares != null) setSharesCount(totalShares);
    };
    const onCollabResponded = ({ postId }) => { if (postId === p._id) fetchCollaborators(); };
    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== p._id) return;
      setCollaborators((prev) => prev.filter((c) => (c.user?._id ?? c.user)?.toString() !== userId));
    };
    socket.on(`post:${p._id}:likes`, onPostLikes);
    socket.on(`post:${p._id}:newComment`, onNewComment);
    socket.on(`post:${p._id}:commentDeleted`, onCommentDeleted);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("postShared", onShareCount);
    socket.on("collabResponded", onCollabResponded);
    socket.on("collabRemoved", onCollabRemoved);
    return () => {
      socket.emit("leavePost", p._id);
      socket.off(`post:${p._id}:likes`, onPostLikes);
      socket.off(`post:${p._id}:newComment`, onNewComment);
      socket.off(`post:${p._id}:commentDeleted`, onCommentDeleted);
      socket.off("postDeleted", onPostDeletedForMe);
      socket.off("postShared", onShareCount);
      socket.off("collabResponded", onCollabResponded);
      socket.off("collabRemoved", onCollabRemoved);
    };
  }, [p?._id]);

  useEffect(() => {
    const unsub = subscribeSavedPosts((postId, savedState) => {
      if (postId === p?._id) setSaved(savedState);
    });
    return unsub;
  }, [p?._id]);

  const toggleSave = () => toggleSavedPost(p);

  const download = async () => {
    if (!canDownload || isDownloadingRef.current) return;
    const mediaList = p?.media || [];
    if (!mediaList.length) return;

    isDownloadingRef.current = true;
    try {
      const hasPermission = await requestSavePermission();
      if (!hasPermission) {
        Alert.alert("Permission needed", "Storage access is required to save this post.");
        return;
      }

      const { dirs } = ReactNativeBlobUtil.fs;

      for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i];
        const isVideo = item.type === "video" || /\.(mp4|mov|m4v)(\?|$)/i.test(item.url);
        const ext = isVideo ? "mp4" : "jpg";
        const localPath = `${dirs.CacheDir}/${p?._id || "post"}_${Date.now()}_${i}.${ext}`;

        try {
          // Download the actual bytes to a local file (no browser involved)
          const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true }).fetch(
            "GET",
            item.url
          );

          // Save the local file straight into the gallery
          await CameraRoll.save(`file://${res.path()}`, {
            type: isVideo ? "video" : "photo",
            album: "Downloads",
          });
        } finally {
          // Remove the temp copy so the cache doesn't fill up
          ReactNativeBlobUtil.fs.unlink(localPath).catch(() => {});
        }
      }

      setDownloadCount((c) => c + 1);
      Alert.alert("Saved", "Post saved to your gallery.");
    } catch (err) {
      console.log("[download] failed:", err?.message);
      Alert.alert("Download failed", "Something went wrong while saving this post.");
    } finally {
      isDownloadingRef.current = false;
    }
  };

  const handleLike = async () => {
    try {
      const res = await apiFetch(`${API}/auth/like/${p._id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikesCount(data.totalLikes);
        if (data.liked) onInteract?.(p._id);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const triggerDoubleTapLike = () => {
    if (!liked) handleLike();
    setShowHeartBurst(true);
    setTimeout(() => setShowHeartBurst(false), 800);
  };
  const handleMediaTap = useDoubleTap(triggerDoubleTapLike);





  const goToProfile = (id) => {
    if (!id) return;
    // FIX: tapping your own name/avatar used to open the generic
    // "UserProfile" viewer instead of your real Profile tab.
    if (id?.toString() === currentUserId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId: id });
    }
  };

  const handleAvatarClick = () => {
    if (authorHasStory) onOpenStory?.(authorId);
    else goToProfile(authorId);
  };


  if (removedFromView) return null;

  return (
    <>
      <View style={styles.imgCard}>
        <View style={styles.imgHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar
              src={p?.author?.profilePic}
              username={username}
              size={38}
              onPress={handleAvatarClick}
              storyState={authorStoryState}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.uname} onPress={() => goToProfile(authorId)}>
                {username}
              </Text>
              <Text style={{ fontSize: 11, color: "#aaa" }}>{timeAgo(p?.createdAt)}</Text>
              {!isOwner && !isBlocked && (
                <FollowButton
                  authorId={authorId}
                  isPrivate={isPrivate}
                  isOwner={isOwner}
                  isBlocked={isBlocked}
                  myFollowingIds={myFollowingIds}
                  username={username}
                  onFollowChange={onFollowChange}
                />
              )}
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TouchableOpacity onPress={toggleSave} style={[styles.headerIconBtn, { backgroundColor: saved ? "#fff8e1" : "#f0f0f0" }]}>
              <Icon name="bookmark" solid={saved} size={14} color={saved ? "#f5a623" : "#888"} />
            </TouchableOpacity>
            <TouchableOpacity ref={menu.anchorRef} onPress={menu.open} style={styles.headerIconBtn}>
              <Icon name="ellipsis-v" size={14} color="#555" />
            </TouchableOpacity>
            <AnchoredMenu visible={menu.visible} coords={menu.coords} onClose={menu.close}>
              {menuOptions.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={opt.action}
                  disabled={opt.label === "Blocked"}
                  style={[styles.dropdownItem, i === menuOptions.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Text style={{ fontSize: 14, fontWeight: "500", color: opt.color }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </AnchoredMenu>
          </View>
        </View>

        <TouchableOpacity activeOpacity={1} onPress={handleMediaTap} style={{ position: "relative", backgroundColor: "#000" }}>
          <Video
            source={{ uri: p?.media?.[0]?.url }}
            style={{ width: "100%", height: 420, backgroundColor: "#000" }}
            muted={isMuted}
            paused={!isVisible}
            repeat
            resizeMode="cover"
          />
          <HeartBurst show={showHeartBurst} />
          <TouchableOpacity onPress={() => setIsMuted((m) => !m)} style={styles.videoMuteBtn}>
            <FeatherIcon name={isMuted ? "volume-x" : "volume-2"} size={14} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>

        <LikesSummary
          likedByUsers={likedByUsers}
          likesCount={likesCount}
          hideLikeCount={hideLikeCount}
          isOwner={isOwner}
          onOpen={() => setShowLikers(true)}
        />

        {(p?.caption || p?.text) && (
          <Text style={styles.caption}>
            <Text style={{ fontWeight: "700" }} onPress={() => goToProfile(authorId)}>
              {username}{"  "}
            </Text>
            <CaptionText text={p?.caption || p?.text} />
          </Text>
        )}

        <FeedTagsRow tags={p?.tags} navigation={navigation} />
        <FeedCollabRow collaborators={collaborators} navigation={navigation} />

        <View style={styles.imgActions}>
          <TouchableOpacity onPress={handleLike} style={styles.imgActionBtn}>
            <Icon name="thumbs-up" solid={liked} size={17} color={liked ? "rgb(234,182,118)" : "#555"} />
            {(!hideLikeCount || isOwner) && (
              <Text onPress={() => setShowLikers(true)} style={{ fontSize: 13, fontWeight: "600", color: liked ? "rgb(234,182,118)" : "#555" }}>
                {formatCount(likesCount)}
              </Text>
            )}
          </TouchableOpacity>
          {canComment && (
            <TouchableOpacity onPress={() => setShowComments(true)} style={styles.imgActionBtn}>
              <Icon name="comment" size={17} color="#555" />
              {(!hideCommentCount || isOwner) && comments.length > 0 && (
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#555" }}>{formatCount(comments.length)}</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { menu.close(); setShowShare(true); }} style={styles.imgActionBtn}>
            <Icon name="paper-plane" size={17} color="#555" />
            {sharesCount > 0 && (
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#555" }}>{formatCount(sharesCount)}</Text>
            )}
          </TouchableOpacity>
          {canDownload && (
            <TouchableOpacity onPress={download} style={styles.imgActionBtn}>
              <Icon name="download" size={16} color="#555" />
              {downloadCount > 0 && (
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#555" }}>{formatCount(downloadCount)}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showLikers && <LikersSheet postId={p._id} onClose={() => setShowLikers(false)} onNavigate={goToProfile} />}
      {showComments && canComment && (
        <CommentsSheet
          postId={p._id}
          postAuthorId={p.author?._id || p.author}
          comments={comments}
          setComments={setComments}
          onClose={() => setShowComments(false)}
          onInteract={onInteract}
        />
      )}
      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── TextFeedCard ─────────────────────────── */
// NEW: `onSheetOpen`, same as ImageFeedCard/VideoFeedCard.
function TextFeedCard({
  p,
  navigation,
  onBlock,
  onNotInterested,
  onHide,
  onDeleted,
  onFollowChange,
  myFollowingIds,
  storyAuthorIds,
  seenStoryIds,
  onInteract,
  onOpenStory,
  onSheetOpen,
}) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();
  const isOwner = currentUserId === p?.author?._id?.toString() || currentUserId === p?.author?.toString();
  const authorId = p?.author?._id || p?.author;
  const username = p?.author?.username || "Unknown";
  const isPrivate = p?.author?.isPrivate ?? false;
  const authorHasStory = storyAuthorIds?.has(authorId?.toString());
  const authorStoryState = authorHasStory ? (seenStoryIds?.has(authorId?.toString()) ? "seen" : "unseen") : null;

  const hideLikeCount = !!p?.hideLikeCount;
  const hideCommentCount = !!p?.hideCommentCount;
  const disableComments = !!p?.disableComments;
  const canComment = !disableComments || isOwner;

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(p?.likes?.length || 0);
  const [likedByUsers, setLikedByUsers] = useState([]);
  const [saved, setSaved] = useState(() => isPostSaved(p?._id));
  const menu = useAnchoredMenu();
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [comments, setComments] = useState(p?.comments ?? []);
  // ── all ⋮-menu actions live in usePostOptions.js ──
  const {
    options: menuOptions,
    isHidden,
    isNotInterested,
    isBlocked,
    removedFromView,
    setRemovedFromView,
  } = usePostOptions({
    post: p,
    isOwner,
    authorId,
    username,
    noun: "post",
    menu: menu,
    currentUserId: currentUserId,
    onBlock,
    onDeleted,
    onNotInterested,
    onHide,
  });

  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const [sharesCount, setSharesCount] = useState(shareCount(p?.shares) ?? p?.sharesCount ?? 0);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);

  useEffect(() => {
    if (showLikers || showComments || showShare) {
      setCommentsOpen(true);
      return () => setCommentsOpen(false);
    }
  }, [showLikers, showComments, showShare]);

  useEffect(() => {
    if (!p?._id) return;
    socket.emit("joinPost", p._id);
    const fetchLikers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/likers/${p._id}`);
        const data = await res.json();
        if (data.success) {
          setLikeCount(data.totalLikes ?? 0);
          setLikedByUsers(data.likedBy ?? []);
          setLiked((data.likedBy ?? []).some((u) => u._id?.toString() === currentUserId));
        }
      } catch (err) {
        console.log(err);
      }
    };
    fetchLikers();
    const fetchComments = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-comment/${p._id}`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch (err) {
        console.log(err);
      }
    };
    fetchComments();

    const fetchCollaborators = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-post/${p._id}`);
        const data = await res.json();
        if (data.success) setCollaborators(data.post.collaborators ?? []);
      } catch {}
    };
    fetchCollaborators();

    const onPostLikes = ({ totalLikes, likedBy }) => {
      setLikeCount(totalLikes);
      if (likedBy) {
        setLikedByUsers(likedBy);
        setLiked(likedBy.some((u) => u._id?.toString() === currentUserId));
      }
    };
    const onNewComment = ({ comment }) => {
      setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    };
    const onCommentDeleted = ({ commentId }) => {
      setComments((prev) => prev.filter((c) => c._id !== commentId));
    };
    const onPostDeletedForMe = ({ postId }) => {
      if (postId === p._id) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      }
    };
    const onShareCount = ({ postId, totalShares }) => {
      if (postId === p._id && totalShares != null) setSharesCount(totalShares);
    };
    const onCollabResponded = ({ postId }) => { if (postId === p._id) fetchCollaborators(); };
    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== p._id) return;
      setCollaborators((prev) => prev.filter((c) => (c.user?._id ?? c.user)?.toString() !== userId));
    };
    socket.on(`post:${p._id}:likes`, onPostLikes);
    socket.on(`post:${p._id}:newComment`, onNewComment);
    socket.on(`post:${p._id}:commentDeleted`, onCommentDeleted);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("postShared", onShareCount);
    socket.on("collabResponded", onCollabResponded);
    socket.on("collabRemoved", onCollabRemoved);
    return () => {
      socket.emit("leavePost", p._id);
      socket.off(`post:${p._id}:likes`, onPostLikes);
      socket.off(`post:${p._id}:newComment`, onNewComment);
      socket.off(`post:${p._id}:commentDeleted`, onCommentDeleted);
      socket.off("postDeleted", onPostDeletedForMe);
      socket.off("postShared", onShareCount);
      socket.off("collabResponded", onCollabResponded);
      socket.off("collabRemoved", onCollabRemoved);
    };
  }, [p?._id]);

  useEffect(() => {
    const unsub = subscribeSavedPosts((postId, savedState) => {
      if (postId === p?._id) setSaved(savedState);
    });
    return unsub;
  }, [p?._id]);

  const toggleSave = () => toggleSavedPost(p);

  const handleLike = async () => {
    try {
      const res = await apiFetch(`${API}/auth/like/${p._id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikeCount(data.totalLikes);
        if (data.liked) onInteract?.(p._id);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const triggerDoubleTapLike = () => {
    if (!liked) handleLike();
    setShowHeartBurst(true);
    setTimeout(() => setShowHeartBurst(false), 800);
  };
  const handleMediaTap = useDoubleTap(triggerDoubleTapLike);





  const goToProfile = (id) => {
    if (!id) return;
    // FIX: tapping your own name/avatar used to open the generic
    // "UserProfile" viewer instead of your real Profile tab.
    if (id?.toString() === currentUserId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId: id });
    }
  };

  const handleAvatarClick = () => {
    if (authorHasStory) onOpenStory?.(authorId);
    else goToProfile(authorId);
  };


  if (removedFromView) return null;

  return (
    <>
      <View style={styles.textCard}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar
              src={p?.author?.profilePic}
              username={username}
              size={38}
              onPress={handleAvatarClick}
              storyState={authorStoryState}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={styles.uname} onPress={() => goToProfile(authorId)}>
                {username}
              </Text>
              <Text style={{ color: "#999", fontSize: 12 }}>{timeAgo(p?.createdAt)}</Text>
              {!isOwner && !isBlocked && (
                <FollowButton
                  authorId={authorId}
                  isPrivate={isPrivate}
                  isOwner={isOwner}
                  isBlocked={isBlocked}
                  myFollowingIds={myFollowingIds}
                  username={username}
                  onFollowChange={onFollowChange}
                />
              )}
            </View>
          </View>
          <TouchableOpacity ref={menu.anchorRef} onPress={menu.open} style={styles.textMenuBtn}>
            <Icon name="ellipsis-h" size={14} color="#666" />
          </TouchableOpacity>
          <AnchoredMenu visible={menu.visible} coords={menu.coords} onClose={menu.close}>
            {menuOptions.map((opt, i) => (
              <TouchableOpacity
                key={i}
                onPress={opt.action}
                disabled={opt.label === "Blocked"}
                style={[styles.dropdownItem, i === menuOptions.length - 1 && { borderBottomWidth: 0 }]}
              >
                <Text style={{ fontSize: 14, fontWeight: "500", color: opt.color }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </AnchoredMenu>
        </View>

        <View style={{ width: "100%", marginTop: 8 }}>
          {(p?.text || p?.caption) && (
            <TouchableOpacity activeOpacity={1} onPress={handleMediaTap}>
              <CaptionText text={p?.text || p?.caption} limit={220} textStyle={styles.textCardBody} />
            </TouchableOpacity>
          )}

{p?.media?.length > 0 && (
  <View style={{ position: "relative", marginTop: 8 }}>
    <ScrollView
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      {...carouselTouchProps}
    >
      {p.media.map((m, i) => (
        <TouchableOpacity key={i} activeOpacity={1} onPress={handleMediaTap}>
          <Image
            source={{ uri: m.url }}
            style={{
              width: p.media.length === 1 ? SCREEN_WIDTH - 24 : 220,
              height: 220,
              borderRadius: 14,
              marginRight: 8,
              backgroundColor: "#f0f0f0",
            }}
            resizeMode="cover"
          />
        </TouchableOpacity>
      ))}
    </ScrollView>
    <HeartBurst show={showHeartBurst} />
  </View>
)}

          <LikesSummary
            likedByUsers={likedByUsers}
            likesCount={likeCount}
            hideLikeCount={hideLikeCount}
            isOwner={isOwner}
            onOpen={() => setShowLikers(true)}
          />

          <FeedTagsRow tags={p?.tags} navigation={navigation} />
          <FeedCollabRow collaborators={collaborators} navigation={navigation} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingBottom: 4 }}>
            <TouchableOpacity onPress={handleLike} style={styles.textActionBtn}>
              <Icon name="thumbs-up" solid={liked} size={16} color={liked ? "rgb(234,182,118)" : "#555"} />
              {(!hideLikeCount || isOwner) && (
                <Text onPress={() => setShowLikers(true)} style={{ fontSize: 13, fontWeight: "600", color: liked ? "rgb(234,182,118)" : "#555" }}>
                  {formatCount(likeCount)}
                </Text>
              )}
            </TouchableOpacity>
            {canComment && (
              <TouchableOpacity onPress={() => setShowComments(true)} style={styles.textActionBtn}>
                <Icon name="comment" size={15} color="#555" />
                {(!hideCommentCount || isOwner) && comments.length > 0 && (
                  <Text style={styles.textCount}>{formatCount(comments.length)}</Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { menu.close(); setShowShare(true); }} style={styles.textActionBtn}>
              <Icon name="paper-plane" size={15} color="#555" />
              {sharesCount > 0 && <Text style={styles.textCount}>{formatCount(sharesCount)}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleSave}
              style={[styles.textActionBtn, { flex: 0, width: 44, marginLeft: "auto", backgroundColor: saved ? "#fff8e1" : "#efefef" }]}
            >
              <Icon name="bookmark" solid={saved} size={14} color={saved ? "#f5a623" : "#555"} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {showLikers && <LikersSheet postId={p._id} onClose={() => setShowLikers(false)} onNavigate={goToProfile} />}
      {showComments && canComment && (
        <CommentsSheet
          postId={p._id}
          postAuthorId={p.author?._id || p.author}
          comments={comments}
          setComments={setComments}
          onClose={() => setShowComments(false)}
          onInteract={onInteract}
        />
      )}
      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── Homepage (main screen) ─────────────────────────── */
// Memoized card wrappers — a card only re-renders when ITS props change,
// not every time the whole feed list re-renders.
const MemoImageFeedCard = React.memo(ImageFeedCard);
const MemoVideoFeedCard = React.memo(VideoFeedCard);
const MemoTextFeedCard = React.memo(TextFeedCard);

function Homepage() {
  const navigation = useNavigation();

  const [currentUser, setCurrentUser] = useState(null);
  const [stories, setStories] = useState([]);
  const [activeIndex, setActiveIndex] = useState(null);
  const [previewAuthorId, setPreviewAuthorId] = useState(null);
  // ← NEW — set when a story_view/story_like notification handoff asks
  // the upcoming preview to open with its Viewers sheet already up.
  const [previewShowViewers, setPreviewShowViewers] = useState(false);
  // ← NEW — which specific story item (within the author's reel) to jump
  // to on open, from the same notification handoff. Without this the
  // preview always defaulted to slide 0 regardless of which story a
  // story_like/story_view notification was actually about.
  const [previewStoryId, setPreviewStoryId] = useState(null);
  // ← NEW — a story_view/story_like/story_live notification now opens the
  // full StoryViewer (same one the stories bar uses) instead of the
  // lighter FeedStoryPreview, so it needs the same "which exact story
  // item to land on" info, just handed to StoryViewer's initialStoryId
  // prop instead. Cleared whenever the viewer is opened any other way
  // (bar tap) or closed, so a stale value never leaks into a manual open.
  const [pendingStoryJumpId, setPendingStoryJumpId] = useState(null);
  const [seenStoryIds, setSeenStoryIds] = useState(() => new Set());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  // Block state is shared app-wide (BlockStore) so it stays in sync with every other page.
  const blockedIds = useBlockedIds();
  const [deletedPostIds, setDeletedPostIds] = useState([]);
  const [viewedPostIds, setViewedPostIds] = useState(() => new Set());
  const [visibleVideoIds, setVisibleVideoIds] = useState(() => new Set());
const [mutedMap, setMutedMap] = useState(() => getMutedMap());

  // NEW: true whenever any card's own Likers/Comments/Share sheet is
  // open, or the story preview's share/viewers sheets are open — drives
  // the Navbar zIndex swap at the bottom of this component.
  const [sheetOpen, setSheetOpen] = useState(false);
// Bumps whenever ANY page changes a post option (hide / not-interested) so the
  // memoized visiblePosts below re-evaluates against the shared option cache.
  const [optionsVersion, setOptionsVersion] = useState(0);
  useEffect(() => subscribeOptionChanges(() => setOptionsVersion((v) => v + 1)), []);
  // NEW — screen-wide swipe to switch tabs (bubble-phase, so it never
  // steals the gesture from the post-image/text carousels: those own
  // horizontal ScrollViews get first refusal on a touch that starts
  // directly on them, and only when nothing more specific claims the
  // gesture does this fire).
 const { panHandlers: swipePanHandlers, screenStyle } =useSwipeToChangeTab({ capture: false, animateScreen: true });
  const feedListRef = useRef(null);

  const {
    followingIds: myFollowingIds,
    follow: addFollowingStore,
    unfollow: removeFollowingStore,
  } = useFollowStore();

  // Load persisted "interacted" post ids (was localStorage, now AsyncStorage)
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(INTERACTED_KEY);
        setViewedPostIds(new Set(JSON.parse(raw || "[]")));
      } catch {}
    })();
  }, []);

  const fetchStories = useCallback(async () => {
    try {
      const userRes = await apiFetch(`${API}/auth/profile`);
      const userData = await userRes.json();
      setCurrentUser(userData.user);
      await updateCachedUser(userData.user);

      const followingIds = (userData.user?.following || []).map((f) => (f?._id ?? f).toString());
      initFollowStore(followingIds);

      const myId = (userData.user?._id || userData.user?.id)?.toString();

      const storiesRes = await apiFetch(`${API}/stories/get-stories`);
      const storiesData = await storiesRes.json();
      if (!storiesData.success) return;

      const grouped = new Map();
      for (const s of storiesData.stories) {
        const sAuthorId = (s.author?._id || s.author)?.toString();
        if (!sAuthorId) continue;

        if (!grouped.has(sAuthorId)) {
          grouped.set(sAuthorId, {
            id: sAuthorId,
            username: s.author?.username || "Unknown",
            userProfile: s.author?.profilePic || "",
            isOwn: sAuthorId === myId,
            slides: [],
          });
        }

        grouped.get(sAuthorId).slides.push({
          id: s._id,
          image: s.media?.url || "",
          type: s.media?.type || s.storyType,
          likes: s.likesCount || 0,
          isLive: s.storyType === "live",
          liveRoomId: s.liveRoomId || null,
          authorId: sAuthorId,
          isHiddenFromNonFollowers: s.isHiddenFromNonFollowers || false,
          viewedByMe: !!s.viewedByMe,
          textOverlays: s.textOverlays || [],
          mentions: s.mentions || [],
          repostAttribution: s.repostAttribution || null,
        });
      }

      const groupedArr = Array.from(grouped.values());
      groupedArr.sort((a, b) => (a.isOwn ? -1 : b.isOwn ? 1 : 0));

      const persistedSeenIds = new Set(
        groupedArr
          .filter((s) => !s.isOwn && s.slides.length > 0 && s.slides.every((sl) => sl.viewedByMe))
          .map((s) => s.id)
      );

      setStories(groupedArr);
      setSeenStoryIds(persistedSeenIds);
    } catch (err) {
      console.log(err);
    }
  }, []);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`${API}/auth/feed`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.posts || [];
      setPosts(list.filter((p) => ["image", "text", "carousel", "video"].includes(p?.postType)));
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, []);
const { refreshing, onRefresh } = useRefresh(async () => {
  await Promise.all([fetchStories(), fetchPosts()]);
});
  // Mount: load auth cache, register socket, fetch stories + posts
useEffect(() => {
  (async () => {
    const user = await getCachedUser();
    const userId = user?._id || user?.id;
    if (userId) socket.emit("register", userId);
    await fetchStories();
    fetchPosts();
    loadMutedMap();
    loadBlockedStore();
  })();
  return subscribeMuted(setMutedMap);
}, [fetchStories, fetchPosts]);

useEffect(() => {
  return subscribeTabReload("Home", () => {
    feedListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    onRefresh();
  });
}, [onRefresh]);

  // Block / hide / not-interested are all driven by the shared stores now
  // (BlockStore + usePostOptions cache), so these callbacks are intentionally no-ops.
  const handleBlock = useCallback(() => {}, []);
  const handleNotInterested = useCallback(() => {}, []);
  const handleHide = useCallback(() => {}, []);
  const handleDeleted = useCallback((id) => setDeletedPostIds((prev) => [...prev, id]), []);
  const handleFollowChange = useCallback((authorId, followed) => {
    if (followed) addFollowing(authorId);
    else removeFollowing(authorId);
  }, []);

  // When someone is unblocked anywhere in the app, refetch so their posts/stories return.
  useEffect(
    () =>
      subscribeBlocked((id, isBlocked) => {
        if (id && !isBlocked) {
          fetchPosts();
          fetchStories();
        }
      }),
    [fetchPosts, fetchStories]
  );

  const handlePostLiked = useCallback((postId) => {
    markPostInteracted(postId);
  }, []);

  const openStoryForAuthor = useCallback((authorId, { showViewers = false, storyId = null } = {}) => {
    setPreviewAuthorId(authorId);
    setPreviewShowViewers(showViewers);
    setPreviewStoryId(storyId);
    setSeenStoryIds((prev) => {
      const key = authorId?.toString();
      if (!key || prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  // FIXED — same bug class as ProfilePage.js's memory handoff. Home is a
  // persistent tab screen: navigating here from a notification (even a
  // fresh one) re-focuses the already-mounted screen rather than
  // remounting it. A plain useEffect keyed on `stories`/`openStoryForAuthor`
  // only fires when THOSE values change — which, once `stories` has
  // already loaded, is basically never again — so every notification tap
  // after the first one just landed on Home and did nothing.
  //
  // Two triggers are kept on purpose: useFocusEffect handles "I'm already
  // on Home, a notification tap just re-focused it," and the plain
  // useEffect handles "I just navigated here for the first time and
  // `stories` is still loading" (a focus event fires before the fetch
  // resolves, so a focus-only trigger could still miss it once).
  //
  // ALSO FIXED — was reopening the preview right after the user manually
  // closed it. With two triggers both able to fire the same function,
  // plus `stories` changing reference on socket-driven refetches, there
  // was no real guard against consuming the same pending request twice.
  // appliedStoryOpenRef tracks exactly which request (by value) was
  // already applied, so this can only ever call openStoryForAuthor once
  // per distinct notification, no matter how many times either trigger
  // fires afterward.
  const appliedStoryOpenRef = useRef(null);

  const consumePendingStoryOpen = useCallback(() => {
    if (!pendingOpenStoryUserId || stories.length === 0) return;
    const id = pendingOpenStoryUserId;
    const storyId = pendingOpenStoryId;
    const appliedKey = `${id}:${storyId || ""}`;
    if (appliedStoryOpenRef.current === appliedKey) {
      pendingOpenStoryUserId = null;
      pendingOpenStoryId = null;
      pendingOpenStoryShowViewers = false;
      return;
    }
    appliedStoryOpenRef.current = appliedKey;

    pendingOpenStoryUserId = null;
    pendingOpenStoryId = null;
    // ← CHANGED — a notification tap now opens the same full StoryViewer
    // used from the stories bar, instead of the lighter FeedStoryPreview.
    // StoryViewer pops its own Viewers sheet open via its own
    // consumeStoryViewers()-equivalent effect internally, so
    // pendingOpenStoryShowViewers is just cleared here, not read — see
    // its own initialStoryId-driven effect in StoryViewer.js.
    pendingOpenStoryShowViewers = false;
    const reel = stories.filter((s) => {
      if (!(s.isOwn || myFollowingIds.includes(s.id?.toString()))) return false;
      if (s.isOwn) return true;
      return !mutedMap[s.id]?.muteStory;
    });
    const idx = reel.findIndex((s) => s.id?.toString() === id.toString());
    if (idx >= 0) {
      setPendingStoryJumpId(storyId || null);
      setActiveIndex(idx);
    } else {
      Alert.alert("", "This story is no longer available.");
    }
  }, [stories, myFollowingIds, mutedMap]);

  // Replaces sessionStorage.getItem("openStoryUserId") flow
  useEffect(() => { consumePendingStoryOpen(); }, [consumePendingStoryOpen]);
  useFocusEffect(consumePendingStoryOpen);

  useEffect(() => {
    const refreshStories = () => fetchStories();
    socket.on("storyAdded", refreshStories);
    socket.on("storyDeleted", refreshStories);
    socket.on("liveStoryEnded", refreshStories);
    socket.on("someoneLive", refreshStories);
    socket.on("storyVisibilityChanged", refreshStories);
    return () => {
      socket.off("storyAdded", refreshStories);
      socket.off("storyDeleted", refreshStories);
      socket.off("liveStoryEnded", refreshStories);
      socket.off("someoneLive", refreshStories);
      socket.off("storyVisibilityChanged", refreshStories);
    };
  }, [fetchStories]);

  useEffect(() => {
    const handler = ({ userId, isPrivate }) => {
      setPosts((prev) =>
        prev.map((post) => {
          const authorId = post.author?._id ? post.author._id.toString() : post.author?.toString();
          if (authorId === userId.toString()) {
            return {
              ...post,
              author: { ...(post.author?._id ? post.author : { _id: post.author }), isPrivate },
            };
          }
          return post;
        })
      );
    };
    socket.on("privacyChanged", handler);
    return () => socket.off("privacyChanged", handler);
  }, []);
useEffect(() => {
  const handler = ({ fromUserId, toUserId }) => {
    const myId = (currentUser?._id || currentUser?.id)?.toString();
    if (!myId || fromUserId?.toString() !== myId) return;
    removeFollowing(toUserId);
  };

  socket.on("userUnfollowed", handler);
  return () => socket.off("userUnfollowed", handler);
}, [currentUser?._id, currentUser?.id]);
const myId = useMemo(
  () => (currentUser?._id || currentUser?.id)?.toString(),
  [currentUser?._id, currentUser?.id]
);

const visiblePosts = useMemo(
  () =>
    posts.filter((p) => {
      const authorId = (p?.author?._id || p?.author)?.toString();

      if (blockedIds.has(authorId)) return false;
      if (authorId !== myId && mutedMap[authorId]?.mutePost) return false;
      const opt = getOptionState(p._id);
      if (opt.isNotInterested === true) return false;
      if (opt.isHidden === true) return false;
      if (deletedPostIds.includes(p._id)) return false;
      if (authorId === myId) return true;
      if (p?.author?.isPrivate && !myFollowingIds.includes(authorId)) return false;
      return true;
    }),
  // optionsVersion forces a re-run when another page changes an option
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [posts, blockedIds, mutedMap, optionsVersion, deletedPostIds, myFollowingIds, myId]
);

  const storyAuthorIds = useMemo(() => new Set(stories.map((s) => s.id?.toString())), [stories]);

const followingStories = useMemo(
  () =>
    stories.filter((s) => {
      if (!(s.isOwn || myFollowingIds.includes(s.id?.toString()))) return false;
      if (s.isOwn) return true;
      if (blockedIds.has(s.id?.toString())) return false;
      return !mutedMap[s.id]?.muteStory;
    }),
  [stories, myFollowingIds, mutedMap, blockedIds]
);

  const previewStory = useMemo(
    () =>
      previewAuthorId
        ? stories.find((st) => st.id?.toString() === previewAuthorId?.toString()) || null
        : null,
    [previewAuthorId, stories]
  );

  const followingPosts = useMemo(
    () =>
      visiblePosts
        .filter((p) => {
          const authorId = (p?.author?._id || p?.author)?.toString();
          return authorId === myId || myFollowingIds.includes(authorId);
        })
        .filter((p) => !viewedPostIds.has(p._id))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [visiblePosts, myId, myFollowingIds, viewedPostIds]
  );

  const discoverPosts = useMemo(
    () =>
      visiblePosts
        .filter((p) => {
          const authorId = (p?.author?._id || p?.author)?.toString();
          if (p?.author?.isPrivate && !myFollowingIds.includes(authorId)) return false;
          return authorId !== myId && !myFollowingIds.includes(authorId);
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [visiblePosts, myId, myFollowingIds]
  );

  // Combined FlatList data: following posts, an "all caught up" divider, then discover posts
  const feedData = useMemo(() => {
    const arr = [];
    const addPostsWithAds = (sectionPosts, section) => {
      sectionPosts.forEach((p, index) => {
        arr.push({ key: p._id, type: "post", post: p });
        // Native ad after every 4 posts.
        if ((index + 1) % 4 === 0 && index < sectionPosts.length - 1) {
          arr.push({ key: `native-ad-${section}-${index + 1}`, type: "nativeAd" });
        }
      });
    };
    addPostsWithAds(followingPosts, "following");
    if (followingPosts.length > 0 && discoverPosts.length > 0) {
      arr.push({ key: "__divider__", type: "divider" });
    }
    addPostsWithAds(discoverPosts, "discover");
    return arr;
  }, [followingPosts, discoverPosts]);

  // Viewability tracking replaces the web IntersectionObserver-based autoplay
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const ids = new Set(
      viewableItems
        .filter((v) => v.item?.type === "post" && v.item.post?.postType === "video")
        .map((v) => v.item.post._id)
    );
    setVisibleVideoIds(ids);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const renderItem = useCallback(
    ({ item }) => {
      if (item.type === "divider") return <AllCaughtUpDivider />;
      if (item.type === "nativeAd") return <SocialioNativeAd />;

      const p = item.post;
      const props = {
        p,
        navigation,
        onBlock: handleBlock,
        onNotInterested: handleNotInterested,
        onHide: handleHide,
        onDeleted: handleDeleted,
        onFollowChange: handleFollowChange,
        myFollowingIds,
        storyAuthorIds,
        seenStoryIds,
        onInteract: handlePostLiked,
        onOpenStory: openStoryForAuthor,
        onSheetOpen: setSheetOpen,
      };

      if (p?.postType === "image" || p?.postType === "carousel") return <MemoImageFeedCard {...props} />;
      if (p?.postType === "video")
        return <MemoVideoFeedCard {...props} isVisible={visibleVideoIds.has(p._id)} />;
      if (p?.postType === "text") return <MemoTextFeedCard {...props} />;
      return null;
    },
    [
      navigation, handleBlock, handleNotInterested, handleHide, handleDeleted,
      handleFollowChange, myFollowingIds, storyAuthorIds, seenStoryIds,
      handlePostLiked, openStoryForAuthor, visibleVideoIds,
    ]
  );

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: "#fff" }, screenStyle]} {...swipePanHandlers}>

      {activeIndex === null && (
        <>
          <FlatList
            ref={feedListRef}
            data={feedData}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={7}
            removeClippedSubviews
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            refreshControl={
  <RefreshControl
    refreshing={refreshing}
    onRefresh={onRefresh}
    tintColor="rgb(234,182,118)"
    colors={["rgb(234,182,118)"]}
  />
}
            ListHeaderComponent={
              <>
                <View style={styles.topBar}>
                  <Text style={styles.logo}>Socialio</Text>
                </View>
                <StoriesBar
                  stories={followingStories}
                  openStory={(i) => { setPendingStoryJumpId(null); setActiveIndex(i); }}
                  userProfile={currentUser?.profilePic || ""}
                  currentUserId={(currentUser?._id || currentUser?.id)?.toString()}
                />
                <View style={{ borderBottomWidth: 1, borderBottomColor: "#efefef" }} />
              </>
            }
            ListEmptyComponent={
              loading ? (
                <View style={styles.centered}>
                  <Spinner />
                </View>
              ) : (
                <View style={styles.centered}>
                  <Text style={{ color: "#aaa", fontSize: 14 }}>
                    No posts yet. Follow people to see their posts!
                  </Text>
                </View>
              )
            }
            contentContainerStyle={{ paddingBottom: 72 }}
          />
          {/* FIX: wrapper controls Navbar's stacking relative to any open
              sheet (likers/comments/share, or the story preview's own
              share/viewers sheets) — zIndex -1 while a sheet is open
              drops it behind everything, back to normal (10) the instant
              every sheet closes. Same treatment as VideoPage.js/
              Video.js/Explore.js. */}
          <View
            style={[
              styles.navbarWrap,
              sheetOpen ? styles.navbarWrapHidden : styles.navbarWrapVisible,
            ]}
            pointerEvents={sheetOpen ? "none" : "auto"}
          >
            <Navbar />
          </View>
        </>
      )}
{activeIndex !== null && followingStories.length > 0 && (
  <StoryViewer
    stories={followingStories}
    index={activeIndex}
    initialStoryId={pendingStoryJumpId}
    close={() => { setActiveIndex(null); setPendingStoryJumpId(null); }}
    currentUserId={(currentUser?._id || currentUser?.id)?.toString()}
  />
)}

      {previewStory && (
        <FeedStoryPreview
          story={previewStory}
          initialShowViewers={previewShowViewers}
          initialStoryId={previewStoryId}
          onClose={() => {
            setPreviewAuthorId(null);
            setPreviewShowViewers(false);
            setPreviewStoryId(null);
            setSheetOpen(false); // safety net in case a sheet was left open
          }}
          navigation={navigation}
          onSheetOpen={setSheetOpen}
        />
      )}
    </Animated.View>
  );
}

export default Homepage;

/* ─────────────────────────── Styles ─────────────────────────── */
const styles = {
  topBar: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#efefef",
    backgroundColor: "#fff",
  },
  logo: { color: "rgb(234,182,118)", fontSize: 24, fontWeight: "700" },
  uname: { fontWeight: "700", fontSize: 14, color: "#111" },

  dropdown: {
    backgroundColor: "#fff",
    borderRadius: 14,
    minWidth: 200,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#eee",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 8,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
  },

  imgCard: { borderBottomWidth: 1, borderBottomColor: "#efefef", backgroundColor: "#fff" },
  imgHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0f0f0",
  },
  postImg: { height: 420 },
  caption: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, fontSize: 14, lineHeight: 20 },
  moreBtn: { color: "#8e8e8e", fontWeight: "700" },
  likesSummary: { paddingHorizontal: 12, paddingTop: 2, fontSize: 13, color: "#333" },
  imgActions: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, gap: 8 },
  imgActionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#efefef",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },

  textCard: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#efefef", paddingTop: 14, paddingHorizontal: 12, paddingBottom: 4 },
  textCardBody: { fontSize: 15, lineHeight: 22, color: "#111", marginTop: 4 },
  textMenuBtn: { padding: 6, borderRadius: 8 },
  textActionBtn: {
    height: 38,
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#efefef",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
  },
  textCount: { fontSize: 13, color: "#555", fontWeight: "600" },

  centered: { alignItems: "center", justifyContent: "center", padding: 60 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 32, fontSize: 15 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f0f0f0",
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
  },
  sendAllBtn: { width: "100%", paddingVertical: 12, borderRadius: 12, backgroundColor: "rgb(234,182,118)", alignItems: "center" },

  heartBurstOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  videoMuteBtn: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  carouselDotsWrap: { position: "absolute", bottom: 8, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 4 },
  carouselDot: { height: 5, borderRadius: 3 },
  carouselCounter: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },

  tagsRow: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  tagChip: { backgroundColor: "#fff3e0", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2 },
  collabRow: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 8, flexDirection: "row", flexWrap: "wrap", gap: 5, alignItems: "center" },
  collabChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#e8f5e9",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  collabChipLetter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#1877f2",
    alignItems: "center",
    justifyContent: "center",
  },

  followBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },

  caughtUpWrap: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#efefef",
    backgroundColor: "#fafafa",
    marginVertical: 8,
  },

  // FIX ("mini update" — sheets opening on too small an area of the
  // screen, and the confirmed root cause of the invisible-Modal bug):
  // `bottomSheet` previously only declared `maxHeight`. In React Native,
  // an `Animated.View` carrying a `transform` needs a determinate
  // `height` on this app's Fabric setup — with only `maxHeight`, it
  // either shrinks to fit content or, combined with the native-driver
  // mismatch fixed in BottomSheet above, fails to paint at all. It now
  // has an explicit `height`, fixing both the sizing complaint and the
  // root visibility bug together. `zIndex`/`elevation` added defensively
  // so sheet content always draws above the Navbar, matching the -1/+1
  // relationship requested.
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)", justifyContent: "flex-end", zIndex: 999, elevation: 999 },
bottomSheet: {
  width: "100%",
  height: SCREEN_HEIGHT * 0.72,
  maxHeight: SCREEN_HEIGHT * 0.85,
  backgroundColor: "#fff",
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  zIndex: 999,
  elevation: 999,
},
sheetHandle: { width: 48, height: 5, backgroundColor: "#ccc", borderRadius: 10, alignSelf: "center", marginTop: 12, marginBottom: 8 },
sheetTitleRow: {
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  paddingHorizontal: 16,
  paddingBottom: 14,
  borderBottomWidth: 1,
  borderBottomColor: "#f0f0f0",
},
sheetCloseIcon: { position: "absolute", right: 16, top: 0, padding: 4 },
  sheetTitleText: { fontSize: 15, fontWeight: "700" },

  commentInputBar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },

  // NEW: Navbar wrapper — see the zIndex swap in Homepage's return above.
  navbarWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  navbarWrapVisible: { zIndex: 10, elevation: 10 },
  navbarWrapHidden: { zIndex: -1, elevation: 0 },

  storyOverlayLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  repostBadge: {
    position: "absolute",
    top: 8,
    left: "50%",
    transform: [{ translateX: -60 }],
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 16,
    paddingLeft: 3,
    paddingRight: 9,
    paddingVertical: 3,
  },
  repostBadgeLetter: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },

  feedPreviewOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 16 },
  feedPreviewCard: {
    width: "100%",
    maxWidth: 340,
    height: "70%",
    maxHeight: 600,
    backgroundColor: "#000",
    borderRadius: 16,
    overflow: "hidden",
  },
  feedPreviewHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  feedPreviewUsername: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 },
  feedPreviewCloseBtn: { padding: 4 },
  feedPreviewMedia: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" },
  feedPreviewMediaEl: { width: "100%", height: "100%" },
  feedPreviewProgressWrap: { flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingTop: 8 },
  feedPreviewProgressBg: { flex: 1, height: 2, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  feedPreviewProgressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  feedPreviewNavLeft: { position: "absolute", left: 0, top: 0, width: "40%", height: "100%" },
  feedPreviewNavRight: { position: "absolute", right: 0, top: 0, width: "60%", height: "100%" },
  feedPreviewOwnBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "rgba(0,0,0,0.9)" },
  feedPreviewViewerBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "rgba(0,0,0,0.9)" },
  feedPreviewStatPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  feedPreviewIconBtn: { padding: 4 },
  feedPreviewInput: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: "#fff",
    fontSize: 13,
  },
  feedPreviewSendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgb(234,182,118)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  feedPreviewFloatZone: { position: "absolute", bottom: 12, right: 10, flexDirection: "column-reverse", gap: 6 },
  feedPreviewCommentsFeed: { position: "absolute", bottom: 8, left: 8, right: 46, gap: 5, maxHeight: "45%" },
  feedPreviewCommentBubble: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: "row",
    gap: 5,
    alignSelf: "flex-start",
    maxWidth: "90%",
  },
  feedPreviewCommentUser: { color: "rgb(234,182,118)", fontSize: 10, fontWeight: "700" },
  feedPreviewCommentText: { color: "#fff", fontSize: 12 },
  feedPreviewLiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgb(234,182,118)",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    marginRight: 4,
  },
  feedPreviewLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  feedPreviewLiveStatusWrap: { alignItems: "center", gap: 10 },
  feedPreviewLiveStatusText: { color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center", paddingHorizontal: 20 },

  deniedCloseBtn: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 20,
  },
  reactionBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
};