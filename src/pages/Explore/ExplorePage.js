import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Alert,
  Dimensions,
  ActivityIndicator,
  PanResponder,
  Animated,
  BackHandler,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { apiFetch, getCachedUser, updateCachedUser, useAuth } from "../../api/authToken";
import Icon from "react-native-vector-icons/FontAwesome5";
import FeatherIcon from "react-native-vector-icons/Feather";
import Video from "react-native-video";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
} from "react-native-webrtc";
import Config from "react-native-config";
import { useNavigation } from "@react-navigation/native";

import Navbar, { subscribeTabReload, useSwipeToChangeTab } from "../../components/Navbar/Navbar";
import socket from "../../sockets/Sockets";
import CommentSection from "../../components/PostCard/CommentSection";
import ShareSheet from "../../components/PostCard/ShareSheet";
import {
  useFollowStore,
  initFollowStore,
  addFollowing,
  removeFollowing,
} from "../Profile/UseFollowState";
import {
  getStoryRuntime,
  subscribeStory,
  pushComment,
  setRuntimeComments,
  setLikeState,
} from "../../components/State/SyncStoryStore";
import {
  isPostSaved,
  toggleSavedPost,
  subscribeSavedPosts,
} from "../../components/State/SavedPostStore";

const API = Config.API_URL;
const SCREEN_WIDTH = Dimensions.get("window").width;
// FIX: needed to size the bottom sheet with a real height instead of
// only `maxHeight` — see the `bottomSheet` style / BottomSheet component
// below for why that matters.
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

function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

const DOUBLE_TAP_DELAY = 300;
// NOTE: same as PostCard.js/TextPostView.js — no competing single-tap
// timer here (a single tap on a post's media/caption does nothing, only
// a double tap triggers `onDoubleTap`), so the 280ms/300ms race condition
// fixed in the video files doesn't apply to this hook. Confirmed correct
// as-is, left unchanged.
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

/* ─────────────────────────── Avatar ─────────────────────────── */
function Avatar({ src, username, size = 38, style: extra = {}, onPress, storyState }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const inner = src ? (
    <Image source={{ uri: src }} style={[{ width: size, height: size, borderRadius: size / 2 }, extra]} />
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

/* ─────────────────────────── Anchored dropdown menu (replaces web's "click outside") ─────────────────────────── */
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

/* ─────────────────────────── generic BottomSheet ─────────────────────────── */
/* FIX (root cause confirmed via the ShareSheet debugging session): this
   used `useNativeDriver: true` on the spring-back animation while
   `translateY` is driven manually via `setValue()` during the drag (not
   through `Animated.event`). Mixing those two on this app's Fabric / New
   Architecture setup desyncs the native animated node graph and the
   whole sheet silently fails to paint — no error, no crash, just nothing
   on screen. This is the same bug that made ShareSheet invisible before
   it was fixed in its own file; `useNativeDriver: false` matches how the
   value is actually driven here too, so there's no JS/native mismatch. */
function BottomSheet({ title, onClose, children, inputBar }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120) onClose();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
      },
    })
  ).current;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          {...panResponder.panHandlers}
          onStartShouldSetResponder={() => true}
          style={[styles.bottomSheet, { transform: [{ translateY }] }]}
        >
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitleText}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.sheetCloseIcon}>
                <FeatherIcon name="x" size={18} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {inputBar}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
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
function CommentsSheet({ postId, postAuthorId, comments, setComments, onClose }) {
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
        placeholder="Add a comment..."
        style={{ flex: 1, fontSize: 14 }}
      />
      <TouchableOpacity onPress={addComment} disabled={!commentText.trim()}>
        <Text style={{ color: "#1877f2", fontWeight: "700", fontSize: 14 }}>Post</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <BottomSheet title={`Comments (${formatCount(comments.length)})`} onClose={onClose} inputBar={inputBar}>
      <CommentSection comments={comments} setComments={setComments} currentUser={currentUser} postId={postId} postAuthorId={postAuthorId} />
    </BottomSheet>
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

// NOTE: no changes here per request — collaborators for a post stay
// shown under the post itself (this row), not attached to the author's
// name/username the way likers/viewers are. No collaborator sheet added.
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

/* ─────────────────────────── follow state / button ─────────────────────────── */
function useFollowState(authorId, authorPrivate, onFollowChange, myFollowingIds) {
  const { follow, unfollow } = useFollowStore();
  const [followState, setFollowState] = useState("none");

  useEffect(() => {
    setFollowState(myFollowingIds?.includes(authorId?.toString()) ? "following" : "none");
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

  return { followState, handleFollowBtn, followLabel, followBtnBg, followBtnColor };
}

function FollowButton({ authorId, isPrivate, isOwner, isBlocked, onFollowChange, myFollowingIds }) {
  const { followLabel, handleFollowBtn, followBtnBg, followBtnColor, followState } = useFollowState(
    authorId,
    isPrivate,
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

/* ─────────────────────────── FeedCarousel (swipeable multi-image) ─────────────────────────── */
function FeedCarousel({ media, onOpen, cardWidth }) {
  const [current, setCurrent] = useState(0);
  const total = media?.length || 0;
  if (!total) return null;

  const width = cardWidth || SCREEN_WIDTH;

  const onMomentumScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrent(Math.max(0, Math.min(idx, total - 1)));
  };

  return (
    <View style={{ position: "relative" }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onMomentumScrollEnd}>
        {media.map((m, i) => (
          <TouchableOpacity key={i} activeOpacity={0.95} onPress={onOpen} style={{ width }}>
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
        <Icon name="thumbs-up" solid size={84} color="#fff" />
      </Animated.View>
    </View>
  );
}

/* ─────────────────────────── ImagePostCard ─────────────────────────── */
// NEW: `onSheetOpen` — fired whenever this card's own Likers/Comments/
// Share sheet opens or closes, so the ancestor Explore screen can drop
// the Navbar's zIndex behind whatever sheet is currently showing.
function ImagePostCard({ p, navigation, onBlock, onNotInterested, onHide, onDeleted, onFollowChange, myFollowingIds, storyAuthorIds, seenStoryIds, onOpenStory, onSheetOpen }) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();
  const isOwner = currentUserId === p?.author?._id?.toString() || currentUserId === p?.author?.toString();
  const authorId = p?.author?._id || p?.author;
  const username = p?.author?.username || p?.username || "Unknown";
  const isPrivate = p?.author?.isPrivate ?? false;
  const authorHasStory = storyAuthorIds?.has(authorId?.toString());
  const authorStoryState = authorHasStory ? (seenStoryIds?.has(authorId?.toString()) ? "seen" : "unseen") : null;
const isDownloadingRef = useRef(false);
  const hideLikeCount = !!p?.hideLikeCount;
  const hideCommentCount = !!p?.hideCommentCount;
  const disableDownload = !!p?.disableDownload;
  const disableComments = !!p?.disableComments;
  const canDownload = !disableDownload || isOwner;
  const canComment = !disableComments || isOwner;

  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(p?.likes?.length || 0);
  const [likedByUsers, setLikedByUsers] = useState([]);
  const [saved, setSaved] = useState(() => isPostSaved(p?._id));
  const menu = useAnchoredMenu();
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isHidden, setIsHidden] = useState(p?.isHiddenFromNonFollowers || false);
  const [comments, setComments] = useState(p?.comments ?? []);
  const [isNotInterested, setIsNotInterested] = useState(p?.isNotInterested || false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [removedFromView, setRemovedFromView] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);

  // NEW: bubble this card's sheet-open state up to Explore for the
  // Navbar zIndex swap.
  useEffect(() => {
    onSheetOpen?.(showLikers || showComments || showShare);
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
    const onCollabResponded = ({ postId }) => { if (postId === p._id) fetchCollaborators(); };
    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== p._id) return;
      setCollaborators((prev) => prev.filter((c) => (c.user?._id ?? c.user)?.toString() !== userId));
    };
    socket.on(`post:${p._id}:likes`, onPostLikes);
    socket.on(`post:${p._id}:newComment`, onNewComment);
    socket.on(`post:${p._id}:commentDeleted`, onCommentDeleted);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("collabResponded", onCollabResponded);
    socket.on("collabRemoved", onCollabRemoved);
    return () => {
      socket.emit("leavePost", p._id);
      socket.off(`post:${p._id}:likes`, onPostLikes);
      socket.off(`post:${p._id}:newComment`, onNewComment);
      socket.off(`post:${p._id}:commentDeleted`, onCommentDeleted);
      socket.off("postDeleted", onPostDeletedForMe);
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

  // NOTE: web version dropped target="_blank" to dodge popup blockers —
  // not applicable on native. For a real "save to device" flow, wire this
  // to react-native-blob-util or @react-native-camera-roll/camera-roll.
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
          const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true }).fetch(
            "GET",
            item.url
          );

          await CameraRoll.save(`file://${res.path()}`, {
            type: isVideo ? "video" : "photo",
            album: "Downloads",
          });
        } finally {
          ReactNativeBlobUtil.fs.unlink(localPath).catch(() => {});
        }
      }

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

  const handleNotInterested = async () => {
    try {
      const res = await apiFetch(`${API}/auth/not-interested/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) {
        setIsNotInterested((prev) => !prev);
        if (!isNotInterested) onNotInterested(p._id);
        else Alert.alert("", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmAsync("Delete this post?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/delete-post/${p._id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      } else Alert.alert("Error", data.message);
    } catch (err) {
      console.log(err);
    }
  };

  const handleBlock = async () => {
    const ok = await confirmAsync(`Block ${username}?`);
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/block/${authorId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setIsBlocked(true);
        onBlock(authorId);
      } else Alert.alert("Error", data.message || "Block failed");
    } catch (err) {
      console.log(err);
    }
  };

  const handleHideFromNonFollowers = async () => {
    try {
      const res = await apiFetch(`${API}/auth/hide-from-non-followers/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHidden);
        if (data.isHidden) onHide(p._id);
        else Alert.alert("", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

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

  const menuOptions = isOwner
    ? [
        { label: "Delete", color: "#e53935", action: () => { menu.close(); handleDelete(); } },
        {
          label: isHidden ? "Show to everyone" : "Hide from non-followers",
          color: "#222",
          action: () => { menu.close(); handleHideFromNonFollowers(); },
        },
      ]
    : isBlocked
    ? [{ label: "Blocked", color: "#888", action: () => {} }]
    : [
        {
          label: isNotInterested ? "Interested" : "Not Interested",
          color: "#222",
          action: () => { menu.close(); handleNotInterested(); },
        },
        { label: `Block ${username}`, color: "#e53935", action: () => { menu.close(); handleBlock(); } },
      ];

  if (removedFromView) return null;

  return (
    <>
      <View style={styles.imgCard}>
        <View style={styles.imgHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar src={p?.author?.profilePic} username={username} size={38} onPress={handleAvatarClick} storyState={authorStoryState} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.uname} onPress={() => goToProfile(authorId)}>{username}</Text>
              <Text style={{ fontSize: 11, color: "#aaa" }}>{timeAgo(p?.createdAt)}</Text>
              {!isOwner && !isBlocked && (
                <FollowButton
                  authorId={authorId}
                  isPrivate={isPrivate}
                  isOwner={isOwner}
                  isBlocked={isBlocked}
                  myFollowingIds={myFollowingIds}
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

        <TouchableOpacity activeOpacity={1} onPress={handleMediaTap} style={{ position: "relative" }}>
          <FeedCarousel media={p.media} onOpen={() => {}} />
          <HeartBurst show={showHeartBurst} />
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
            <Icon name="thumbs-up" solid={liked} size={17} color={liked ? "#f5a623" : "#555"} />
            {(!hideLikeCount || isOwner) && (
              <Text onPress={() => setShowLikers(true)} style={{ fontSize: 13, fontWeight: "600", color: liked ? "#f5a623" : "#555" }}>
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
          </TouchableOpacity>
          {canDownload && (
            <TouchableOpacity onPress={download} style={styles.imgActionBtn}>
              <Icon name="download" size={16} color="#555" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showLikers && <LikersSheet postId={p._id} onClose={() => setShowLikers(false)} onNavigate={goToProfile} />}
      {showComments && canComment && (
        <CommentsSheet postId={p._id} postAuthorId={p.author?._id || p.author} comments={comments} setComments={setComments} onClose={() => setShowComments(false)} />
      )}
      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── TextPostCard ─────────────────────────── */
// NEW: same `onSheetOpen` bubble-up as ImagePostCard, for the Navbar
// zIndex swap.
function TextPostCard({ p, navigation, onBlock, onNotInterested, onHide, onDeleted, onFollowChange, myFollowingIds, storyAuthorIds, seenStoryIds, onOpenStory, onSheetOpen }) {
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
  const [heartAnim, setHeartAnim] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [comments, setComments] = useState(p?.comments ?? []);
  const [isHidden, setIsHidden] = useState(p?.isHiddenFromNonFollowers || false);
  const [isNotInterested, setIsNotInterested] = useState(p?.isNotInterested || false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [removedFromView, setRemovedFromView] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const [sharesCount, setSharesCount] = useState(shareCount(p?.shares) ?? p?.sharesCount ?? 0);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);

  // NEW: bubble this card's sheet-open state up to Explore.
  useEffect(() => {
    onSheetOpen?.(showLikers || showComments || showShare);
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
    const onShareCount = ({ postId, totalShares }) => { if (postId === p._id && totalShares != null) setSharesCount(totalShares); };
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

  const handleHideFromNonFollowers = async () => {
    try {
      const res = await apiFetch(`${API}/auth/hide-from-non-followers/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHidden);
        if (data.isHidden) onHide(p._id);
        else Alert.alert("", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleNotInterested = async () => {
    try {
      const res = await apiFetch(`${API}/auth/not-interested/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) {
        setIsNotInterested((prev) => !prev);
        if (!isNotInterested) onNotInterested(p._id);
        else Alert.alert("", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleLike = async () => {
    setHeartAnim(true);
    setTimeout(() => setHeartAnim(false), 300);
    try {
      const res = await apiFetch(`${API}/auth/like/${p._id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikeCount(data.totalLikes);
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

  const handleDelete = async () => {
    const ok = await confirmAsync("Delete this post?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/delete-post/${p._id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      } else Alert.alert("Error", data.message);
    } catch (err) {
      console.log(err);
    }
  };

  const handleBlock = async () => {
    const ok = await confirmAsync(`Block ${username}?`);
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/block/${authorId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setIsBlocked(true);
        onBlock(authorId);
      }
    } catch (err) {
      console.log(err);
    }
  };

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

  const menuOptions = isOwner
    ? [
        { label: "Delete", color: "#e53935", action: () => { menu.close(); handleDelete(); } },
        {
          label: isHidden ? "Show to everyone" : "Hide from non-followers",
          color: "#222",
          action: () => { menu.close(); handleHideFromNonFollowers(); },
        },
      ]
    : isBlocked
    ? [{ label: "Blocked", color: "#888", action: () => {} }]
    : [
        {
          label: isNotInterested ? "Interested" : "Not Interested",
          color: "#222",
          action: () => { menu.close(); handleNotInterested(); },
        },
        { label: `Block ${username}`, color: "#e53935", action: () => { menu.close(); handleBlock(); } },
      ];

  if (removedFromView) return null;

  return (
    <>
      <View style={styles.textCard}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar src={p?.author?.profilePic} username={username} size={38} onPress={handleAvatarClick} storyState={authorStoryState} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={styles.uname} onPress={() => goToProfile(authorId)}>{username}</Text>
              <Text style={{ color: "#999", fontSize: 12 }}>{timeAgo(p?.createdAt)}</Text>
              {!isOwner && !isBlocked && (
                <FollowButton
                  authorId={authorId}
                  isPrivate={isPrivate}
                  isOwner={isOwner}
                  isBlocked={isBlocked}
                  myFollowingIds={myFollowingIds}
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

        <View style={{ width: "100%", marginTop: 10 }}>
          {(p?.text || p?.caption) && (
            <TouchableOpacity activeOpacity={1} onPress={handleMediaTap}>
              <CaptionText text={p?.text || p?.caption} limit={220} textStyle={styles.textCardBody} />
            </TouchableOpacity>
          )}

          {p?.media?.length > 0 && (
            <TouchableOpacity activeOpacity={1} onPress={handleMediaTap} style={{ position: "relative" }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                {p.media.map((m, i) => (
                  <Image
                    key={i}
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
                ))}
              </ScrollView>
              <HeartBurst show={showHeartBurst} />
            </TouchableOpacity>
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
              <Icon name="thumbs-up" solid={liked} size={16} color={liked ? "#e53935" : "#555"} />
              {(!hideLikeCount || isOwner) && (
                <Text onPress={() => setShowLikers(true)} style={{ fontSize: 13, fontWeight: "600", color: liked ? "#e53935" : "#555" }}>
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
              <Text style={styles.textCount}>{formatCount(sharesCount)}</Text>
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
        <CommentsSheet postId={p._id} postAuthorId={p.author?._id || p.author} comments={comments} setComments={setComments} onClose={() => setShowComments(false)} />
      )}
      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── PostFeedOverlay (full-screen Modal, opened from grid) ─────────────────────────── */
// NEW: `onSheetOpen` threads straight through to whichever card is
// currently rendering a Likers/Comments/Share sheet.
function PostFeedOverlay({ posts, startIndex, onClose, navigation, onFollowChange, myFollowingIds, storyAuthorIds, seenStoryIds, onOpenStory, onSheetOpen }) {
  const [blockedIds, setBlockedIds] = useState([]);
  const [notInterestedIds, setNotInterestedIds] = useState([]);
  const [hiddenPostIds, setHiddenPostIds] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);

  const handleBlock = (id) => setBlockedIds((prev) => [...prev, id.toString()]);
  const handleNotInterested = (id) => setNotInterestedIds((prev) => [...prev, id]);
  const handleHide = (id) => setHiddenPostIds((prev) => [...prev, id]);
  const handleDeleted = (id) => setDeletedIds((prev) => [...prev, id]);

  const orderedPosts = useMemo(() => {
    if (!posts.length) return posts;
    const i = ((startIndex % posts.length) + posts.length) % posts.length;
    return [...posts.slice(i), ...posts.slice(0, i)];
  }, [posts, startIndex]);

  const visiblePosts = orderedPosts.filter((p) => {
    const authorId = (p?.author?._id || p?.author)?.toString();
    if (blockedIds.includes(authorId)) return false;
    if (notInterestedIds.includes(p._id)) return false;
    if (hiddenPostIds.includes(p._id)) return false;
    if (deletedIds.includes(p._id)) return false;
    return true;
  });

  // FIX: this used to be its own <Modal>, but the Likers/Comments sheet
  // opened from inside a post card (BottomSheet, further below) is ALSO
  // a real <Modal>. On Android, having two <Modal>s mounted at once
  // means two separate native windows — closing the inner one (the
  // sheet) makes the OS briefly tear down/redraw the window stack, which
  // shows up as this whole post list flashing closed-then-open. Since
  // this overlay is always rendered as a plain sibling of Explore's root
  // view (not inside the ScrollView), a full-screen absolute View covers
  // the screen exactly the way the Modal did, but without opening a
  // second native window — so only the sheet's Modal exists at a time.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={styles.fullScreenOverlay}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <View style={styles.overlayTopBar}>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <FeatherIcon name="arrow-left" size={22} color="#111" />
          </TouchableOpacity>
          <Text style={{ fontWeight: "700", fontSize: 15 }}>Posts</Text>
        </View>
        <ScrollView style={{ flex: 1 }}>
          {visiblePosts.map((p) =>
            p.postType === "text" ? (
              <TextPostCard
                key={p._id}
                p={p}
                navigation={navigation}
                onBlock={handleBlock}
                onNotInterested={handleNotInterested}
                onHide={handleHide}
                onDeleted={handleDeleted}
                onFollowChange={onFollowChange}
                myFollowingIds={myFollowingIds}
                storyAuthorIds={storyAuthorIds}
                seenStoryIds={seenStoryIds}
                onOpenStory={onOpenStory}
                onSheetOpen={onSheetOpen}
              />
            ) : (
              <ImagePostCard
                key={p._id}
                p={p}
                navigation={navigation}
                onBlock={handleBlock}
                onNotInterested={handleNotInterested}
                onHide={handleHide}
                onDeleted={handleDeleted}
                onFollowChange={onFollowChange}
                myFollowingIds={myFollowingIds}
                storyAuthorIds={storyAuthorIds}
                seenStoryIds={seenStoryIds}
                onOpenStory={onOpenStory}
                onSheetOpen={onSheetOpen}
              />
            )
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/* ─────────────────────────── FeedStoryPreview (full-screen overlay) ─────────────────────────── */
const FEED_PREVIEW_REACTIONS = ["❤️", "😂", "😮", "🔥", "👏"];

// NEW: `onSheetOpen` — this preview has its own share/viewers sheets
// (FeedStoryShareSheet / FeedStoryViewersSheet), so it bubbles those up
// to Explore the same way the post cards do.
function FeedStoryPreview({ story, onClose, navigation, onSheetOpen }) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();

  const [slideIndex, setSlideIndex] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [isHidden, setIsHidden] = useState(false);
  const [comment, setComment] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [liveComments, setLiveComments] = useState([]);
  const [accessDenied, setAccessDenied] = useState(null);

  useEffect(() => {
    onSheetOpen?.(showShareSheet || showViewers);
  }, [showShareSheet, showViewers]);

  // FIX: same nested-<Modal> flicker as PostFeedOverlay above — this
  // preview's own Share/Viewers sheets are real <Modal>s, so this
  // preview can't also be a <Modal> without stacking two native windows
  // on Android (that's what made the story flash closed/open when a
  // sheet closed). Rendered as a full-screen absolute View instead, plus
  // a manual back-button handler to replace what <Modal onRequestClose>
  // used to give us for free.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const slides = story?.slides || [];
  const slide = slides[slideIndex] || {};
  const isOwn = !!story?.isOwn;
  const isLiveSlide = slide?.type === "live" || slide?.isLive === true;
  const isVideo = slide.type === "video" || slide.image?.includes(".mp4") || slide.image?.includes("video");

  useEffect(() => setSlideIndex(0), [story?.id]);

  useEffect(() => {
    if (!slide?.id) return;
    socket.emit("joinStory", { storyId: slide.id, viewerId: currentUserId });
    return () => socket.emit("leaveStory", slide.id);
  }, [slide?.id, currentUserId]);

  useEffect(() => {
    if (!slide?.id) return;
    setShowMenu(false);
    setAccessDenied(null);

    const runtime = getStoryRuntime(slide.id);
    setLiveComments(runtime.comments);
    setLikesCount(runtime.likesCount);
    setLiked(runtime.liked);

    const fetchData = async () => {
      try {
        if (isOwn) {
          const res = await apiFetch(`${API}/stories/viewers/${slide.id}`);
          const data = await res.json();
          if (data.success) {
            setViewers(data.viewers ?? []);
            const likedNow = (data.likedBy ?? []).some((u) => u._id?.toString() === currentUserId);
            setLikesCount(data.likesCount ?? 0);
            setLiked(likedNow);
            setIsHidden(slide.isHiddenFromNonFollowers || false);
            setLikeState(slide.id, { likesCount: data.likesCount ?? 0, liked: likedNow });
          }
        } else if (!isLiveSlide) {
          const res = await apiFetch(`${API}/stories/like-state/${slide.id}`);
          if (res.status === 403) {
            setAccessDenied("not_following");
            return;
          }
          const data = await res.json();
          if (data.success) {
            setLikesCount(data.likesCount ?? 0);
            setLiked(!!data.liked);
            setLikeState(slide.id, { likesCount: data.likesCount ?? 0, liked: !!data.liked });
          }
          apiFetch(`${API}/stories/view-story/${slide.id}`, { method: "PUT" }).catch(() => {});
        }

        if (!runtime.commentsFetched) {
          try {
            const cRes = await apiFetch(`${API}/stories/comments/${slide.id}`);
            const cData = await cRes.json();
            if (cData?.success && Array.isArray(cData.comments)) setRuntimeComments(slide.id, cData.comments);
          } catch {}
        }
      } catch {}
    };
    fetchData();

    const unsubscribe = subscribeStory(slide.id, (s) => {
      setLiveComments(s.comments);
      setLikesCount(s.likesCount);
      setLiked(s.liked);
    });

    const onLikes = ({ likesCount: count }) => setLikeState(slide.id, { likesCount: count });
    const onComment = (payload) => pushComment(slide.id, payload);
    socket.on(`story:${slide.id}:likes`, onLikes);
    socket.on(`story:${slide.id}:comment`, onComment);
    return () => {
      socket.off(`story:${slide.id}:likes`, onLikes);
      socket.off(`story:${slide.id}:comment`, onComment);
      unsubscribe();
    };
  }, [slide?.id, isOwn, isLiveSlide]);

  const [liveStatus, setLiveStatus] = useState(null);
  const [liveStream, setLiveStream] = useState(null);
  const livePcRef = useRef(null);

  useEffect(() => {
    if (!isLiveSlide || !slide?.liveRoomId) {
      setLiveStatus(null);
      setLiveStream(null);
      return;
    }

    setLiveStatus("connecting");
    setLiveStream(null);

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    livePcRef.current = pc;

    pc.ontrack = (event) => {
      if (event.streams?.[0]) {
        setLiveStream(event.streams[0]);
        setLiveStatus("live");
      }
    };

    const iceBuffer = [];

    const handleOffer = async ({ from, offer }) => {
      if (pc.signalingState !== "stable") return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        for (const c of iceBuffer) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch {}
        }
        iceBuffer.length = 0;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("liveAnswer", { to: from, answer });
      } catch (e) {
        console.error("Failed to handle live offer:", e);
      }
    };

    const handleIce = async ({ candidate }) => {
      if (!candidate) return;
      try {
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        else iceBuffer.push(candidate);
      } catch (e) {
        console.error("ICE error:", e);
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit("iceCandidate", { to: slide.authorId, candidate });
    };

    const handleDenied = ({ roomId, reason }) => {
      if (roomId !== slide.liveRoomId) return;
      setLiveStatus(reason === "not_following" ? "denied" : "ended");
    };

    const handleEnded = ({ roomId }) => {
      if (roomId !== slide.liveRoomId) return;
      setLiveStatus("ended");
      setTimeout(() => onClose(), 2500);
    };

    socket.on("liveOffer", handleOffer);
    socket.on("iceCandidate", handleIce);
    socket.on("liveAccessDenied", handleDenied);
    socket.on("liveEnded", handleEnded);

    socket.emit("joinLive", { roomId: slide.liveRoomId, viewerId: currentUserId });

    return () => {
      socket.off("liveOffer", handleOffer);
      socket.off("iceCandidate", handleIce);
      socket.off("liveAccessDenied", handleDenied);
      socket.off("liveEnded", handleEnded);
      socket.emit("leaveLive", { roomId: slide.liveRoomId, viewerId: currentUserId });
      pc.close();
      livePcRef.current = null;
    };
  }, [isLiveSlide, slide?.liveRoomId, slide?.authorId, currentUserId]);

  const handlePrev = () => {
    if (slideIndex > 0) setSlideIndex((i) => i - 1);
  };
  const handleNext = () => {
    if (slideIndex < slides.length - 1) setSlideIndex((i) => i + 1);
    else onClose();
  };

  const handleLike = async () => {
    if (!slide?.id) return;
    try {
      const res = await apiFetch(`${API}/stories/like-story/${slide.id}`, { method: "PUT" });
      const data = await res.json();
      if (data.success) {
        const nextLiked = !liked;
        setLiked(nextLiked);
        setLikesCount(data.likesCount);
        setLikeState(slide.id, { likesCount: data.likesCount, liked: nextLiked });
      } else if (res.status === 403) {
        setAccessDenied("not_following");
      }
    } catch {}
  };

  const sendReaction = (emoji) => {
    if (accessDenied || !slide?.id) return;
    socket.emit("storyComment", { storyId: slide.id, userId: currentUserId, username: currentUser.username, text: emoji });
  };

  const handleSendComment = () => {
    if (!comment.trim() || !slide?.id || accessDenied) return;
    socket.emit("storyComment", { storyId: slide.id, userId: currentUserId, username: currentUser.username, text: comment });
    setComment("");
  };

  const handleHideFromNonFollowers = async () => {
    if (!slide?.id) return;
    try {
      const res = await apiFetch(`${API}/stories/hide-from-non-followers/${slide.id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHiddenFromNonFollowers);
        setShowMenu(false);
      } else Alert.alert("Error", data.message);
    } catch {}
  };

  const handleDelete = async () => {
    if (!slide?.id) return;
    const ok = await confirmAsync("Delete this story?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/stories/delete-story/${slide.id}`, { method: "DELETE" });
      if (res.ok) onClose();
    } catch {}
  };

  const goToViewerProfile = (id) => {
    onClose();
    if (!id) return;
    // FIX: don't send the current user to the generic viewer screen
    // for their own id — send them to the real Profile tab instead.
    if (id?.toString() === currentUserId) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId: id });
    }
  };

  if (!story) return null;

  if (accessDenied) {
    return (
      <View style={styles.fullScreenOverlay}>
        <TouchableOpacity style={styles.feedPreviewOverlay} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[styles.feedPreviewCard, styles.centered]}>
            <Avatar src={story.userProfile} username={story.username} size={56} />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 8 }}>Follow to view this story</Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center", marginTop: 4 }}>
              Only {story.username}'s followers can see this story.
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.deniedCloseBtn}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.fullScreenOverlay}>
      <View style={styles.feedPreviewOverlay}>
        <View style={styles.feedPreviewCard}>
          {slides.length > 1 && (
            <View style={styles.feedPreviewProgressWrap}>
              {slides.map((_, i) => (
                <View key={i} style={styles.feedPreviewProgressBg}>
                  <View style={[styles.feedPreviewProgressFill, { width: i <= slideIndex ? "100%" : "0%" }]} />
                </View>
              ))}
            </View>
          )}

          <View style={styles.feedPreviewHeader}>
            <Avatar src={story.userProfile} username={story.username} size={28} />
            <Text style={styles.feedPreviewUsername}>{story.username}</Text>
            {isLiveSlide && liveStatus === "live" && (
              <View style={styles.feedPreviewLiveBadge}>
                <View style={styles.feedPreviewLiveDot} />
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>LIVE</Text>
              </View>
            )}
            <TouchableOpacity onPress={onClose} style={styles.feedPreviewCloseBtn}>
              <FeatherIcon name="x" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.feedPreviewMedia}>
            {isLiveSlide ? (
              liveStatus === "live" && liveStream ? (
                <RTCView streamURL={liveStream.toURL()} style={styles.feedPreviewMediaEl} objectFit="contain" />
              ) : (
                <View style={styles.feedPreviewLiveStatusWrap}>
                  {liveStatus === "denied" && (
                    <>
                      <Text style={{ fontSize: 32 }}>🔒</Text>
                      <Text style={styles.feedPreviewLiveStatusText}>Follow to watch</Text>
                    </>
                  )}
                  {liveStatus === "ended" && (
                    <>
                      <Text style={{ fontSize: 32 }}>📺</Text>
                      <Text style={styles.feedPreviewLiveStatusText}>Live has ended</Text>
                    </>
                  )}
                  {(liveStatus === "connecting" || !liveStatus) && (
                    <>
                      <ActivityIndicator size="large" color="#fff" />
                      <Text style={styles.feedPreviewLiveStatusText}>Connecting to live…</Text>
                    </>
                  )}
                </View>
              )
            ) : slide.image ? (
              isVideo ? (
                <Video key={slide.image} source={{ uri: slide.image }} style={styles.feedPreviewMediaEl} resizeMode="contain" repeat muted paused={false} />
              ) : (
                <Image source={{ uri: slide.image }} style={styles.feedPreviewMediaEl} resizeMode="contain" />
              )
            ) : (
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No story to show</Text>
            )}

            {!isLiveSlide && (slide.textOverlays?.length > 0 || slide.mentions?.length > 0) && (
              <View style={styles.storyOverlayLayer} pointerEvents="box-none">
                {(slide.textOverlays || []).map((t, i) => (
                  <View
                    key={`text-${i}`}
                    style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, transform: [{ translateX: -0.5 }, { translateY: -0.5 }], maxWidth: "80%" }}
                  >
                    <Text style={{ color: t.color || "#fff", fontSize: t.fontSize || 20, fontWeight: "700", textAlign: t.align || "center" }}>{t.text}</Text>
                  </View>
                ))}
                {(slide.mentions || []).map((m, i) => (
                  <TouchableOpacity
                    key={`mention-${i}`}
                    onPress={() => { if (!m.user) return; onClose(); if (m.user?.toString() === currentUserId) { navigation.navigate("MainTabs", { screen: "Profile" }); } else { navigation.navigate("UserProfile", { userId: m.user }); } }}
                    style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}
                  >
                    <Text style={{ color: "#111", fontSize: 11.5, fontWeight: "700" }}>@{m.username || "user"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {!isLiveSlide && slide.repostAttribution?.username && (
              <TouchableOpacity
                onPress={() => { if (!slide.repostAttribution.user) return; onClose(); if (slide.repostAttribution.user?.toString() === currentUserId) { navigation.navigate("MainTabs", { screen: "Profile" }); } else { navigation.navigate("UserProfile", { userId: slide.repostAttribution.user }); } }}
                style={styles.repostBadge}
              >
                {slide.repostAttribution.profilePic ? (
                  <Image source={{ uri: slide.repostAttribution.profilePic }} style={{ width: 16, height: 16, borderRadius: 8 }} />
                ) : (
                  <View style={styles.repostBadgeLetter}>
                    <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" }}>{slide.repostAttribution.username[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <Text style={{ color: "#fff", fontSize: 10.5, fontWeight: "600" }}>Story by @{slide.repostAttribution.username}</Text>
              </TouchableOpacity>
            )}

            {slides.length > 1 && !isLiveSlide && (
              <>
                <TouchableOpacity style={styles.feedPreviewNavLeft} onPress={handlePrev} activeOpacity={1} />
                <TouchableOpacity style={styles.feedPreviewNavRight} onPress={handleNext} activeOpacity={1} />
              </>
            )}

            {liveComments.length > 0 && (
              <View style={styles.feedPreviewCommentsFeed} pointerEvents="none">
                {liveComments.map((c, i) => (
                  <View key={i} style={styles.feedPreviewCommentBubble}>
                    <Text style={styles.feedPreviewCommentUser}>{c.username}</Text>
                    <Text style={styles.feedPreviewCommentText}>{c.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {isOwn ? (
            <View style={styles.feedPreviewOwnBar}>
              <TouchableOpacity onPress={() => setShowShareSheet(true)} style={styles.feedPreviewSendBtn}>
                <Icon name="paper-plane" size={14} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Send</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowViewers(true)} style={styles.feedPreviewStatPill}>
                <Icon name="eye" size={13} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{formatCount(viewers.length)}</Text>
              </TouchableOpacity>
              <View style={styles.feedPreviewStatPill}>
                <Icon name="thumbs-up" solid size={13} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{formatCount(likesCount)}</Text>
              </View>
              <View style={{ position: "relative", marginLeft: "auto" }}>
                <TouchableOpacity onPress={() => setShowMenu((v) => !v)} style={styles.feedPreviewIconBtn}>
                  <Icon name="ellipsis-v" size={16} color="#fff" />
                </TouchableOpacity>
                {showMenu && (
                  <View style={[styles.dropdown, { top: "auto", bottom: 34, right: 0 }]}>
                    <TouchableOpacity onPress={handleHideFromNonFollowers} style={styles.dropdownItem}>
                      <Text style={{ fontSize: 14, fontWeight: "500", color: "#222" }}>{isHidden ? "Show to everyone" : "Hide from non-followers"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleDelete} style={[styles.dropdownItem, { borderBottomWidth: 0 }]}>
                      <Text style={{ fontSize: 14, fontWeight: "500", color: "#e53935" }}>Delete Story</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {isLiveSlide && liveStatus === "live" && (
                <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
                  {FEED_PREVIEW_REACTIONS.map((emoji) => (
                    <TouchableOpacity key={emoji} onPress={() => sendReaction(emoji)} style={styles.reactionBtn}>
                      <Text style={{ fontSize: 20 }}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.feedPreviewViewerBar}>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  onSubmitEditing={handleSendComment}
                  placeholder="Send message..."
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  style={styles.feedPreviewInput}
                />
                <TouchableOpacity onPress={handleLike} style={styles.feedPreviewIconBtn}>
                  <Icon name="thumbs-up" solid size={17} color={liked ? "rgb(234,182,118)" : "#fff"} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSendComment} disabled={!comment.trim()} style={[styles.feedPreviewIconBtn, { opacity: comment.trim() ? 1 : 0.4 }]}>
                  <Icon name="paper-plane" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>

      {showShareSheet && <FeedStoryShareSheet storyId={slide.id} onClose={() => setShowShareSheet(false)} />}
      {showViewers && <FeedStoryViewersSheet viewers={viewers} onClose={() => setShowViewers(false)} onNavigate={goToViewerProfile} />}
    </View>
  );
}

function FeedStoryShareSheet({ storyId, onClose }) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    apiFetch(`${API}/auth/share/users`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setUsers(data.users); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apiFetch(`${API}/auth/share/users?q=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((data) => { if (data.success) setUsers(data.users); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer.current);
  }, [search]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (selected.size === 0 || !storyId) return;
    setSending(true);
    try {
      const res = await apiFetch(`${API}/auth/share/story`, {
        method: "POST",
        body: JSON.stringify({ storyId, toUserIds: Array.from(selected) })
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        setTimeout(onClose, 900);
      }
    } catch {}
    finally {
      setSending(false);
    }
  };

  return (
    <BottomSheet title={sent ? "Sent!" : "Send to"} onClose={onClose}>
      {!sent && (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
            <View style={styles.searchWrap}>
              <FeatherIcon name="search" size={14} color="#999" />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search people…" style={styles.searchInput} autoFocus />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <FeatherIcon name="x" size={14} color="#999" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {loading ? (
              <Text style={styles.emptyText}>Loading…</Text>
            ) : users.length === 0 ? (
              <Text style={styles.emptyText}>No users found</Text>
            ) : (
              users.map((u) => (
                <TouchableOpacity key={u._id} onPress={() => toggle(u._id)} style={styles.userRow}>
                  <Avatar src={u.profilePic} username={u.username} size={42} />
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: "600" }}>{u.username}</Text>
                  <View style={[styles.checkCircle, selected.has(u._id) && { backgroundColor: "rgb(234,182,118)", borderWidth: 0 }]}>
                    {selected.has(u._id) && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <TouchableOpacity onPress={handleSend} disabled={selected.size === 0 || sending} style={[styles.sendAllBtn, { opacity: selected.size > 0 && !sending ? 1 : 0.5 }]}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                {sending ? "Sending…" : `Send${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

function FeedStoryViewersSheet({ viewers, onClose, onNavigate }) {
  return (
    <BottomSheet title={`${formatCount(viewers.length)} viewers`} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
        {viewers.length === 0 ? (
          <Text style={styles.emptyText}>No viewers yet</Text>
        ) : (
          viewers.map((v, i) => (
            <TouchableOpacity key={v._id ?? i} onPress={() => onNavigate(v._id)} style={styles.userRow}>
              <Avatar src={v.profilePic} username={v.username} size={40} />
              <Text style={{ fontSize: 15, fontWeight: "600" }}>{v.username}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </BottomSheet>
  );
}

/* ─────────────────────────── explore grid block (3x2 tile) ───────────────────────────
   Web used CSS grid (3 cols x 2 rows @ ~120px each, video spans 1 col / 2 rows).
   Rebuilt here with plain Views using computed pixel widths so the same visual
   layout (video tile beside a 2x2 image grid, side alternating per block) carries
   over to native without CSS grid. */
const GRID_GAP = 3;
const GRID_PADDING = 3;
const CELL = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3;

function GridImageTile({ post, onPress, width, height }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ width, height, backgroundColor: "#fafafa", overflow: "hidden" }}>
      {post?.media?.[0]?.url ? (
        <Image source={{ uri: post.media[0].url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 8 }}>
          <Text style={{ fontSize: 11, color: "#888", textAlign: "center" }} numberOfLines={4}>
            {post?.text || post?.caption || ""}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function GridVideoTile({ video, onPress, width, height }) {
  return (
    <View style={{ width, height, backgroundColor: "#222", overflow: "hidden", position: "relative" }}>
      {video?.media?.[0]?.url ? (
        <Video
          source={{ uri: video.media[0].url }}
          style={{ width: "100%", height: "100%" }}
          muted
          repeat
          paused={false}
          resizeMode="cover"
        />
      ) : null}

      {video && (
        <View style={styles.videoBadge} pointerEvents="none">
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>VIDEO</Text>
        </View>
      )}

      {/* Transparent tap-catcher layered ON TOP of the video, not
          wrapping it. Guaranteed to receive the touch first, regardless
          of how the Video's native surface handles hit-testing. */}
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
    </View>
  );
}

function ExploreBlock({ block, onOpenPost, onOpenVideo }) {
  if (block.kind === "ad") {
    return (
      <View style={styles.adRow}>
        <Text style={{ color: "#aaa", fontSize: 12, fontWeight: "600" }}>Ad space reserved</Text>
      </View>
    );
  }

  const { posts: blockPosts, video, reversed } = block;
  const slots = [...blockPosts];
  while (slots.length < 4) slots.push(null);

  const imagesGrid = (
    <View style={{ width: CELL * 2 + GRID_GAP, height: CELL * 2 + GRID_GAP, flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP }}>
      {slots.map((p, i) => (
        <GridImageTile key={p ? p._id : `empty-${i}`} post={p} width={CELL} height={CELL} onPress={() => p && onOpenPost(p)} />
      ))}
    </View>
  );

  const videoTile = <GridVideoTile video={video} width={CELL} height={CELL * 2 + GRID_GAP} onPress={() => video && onOpenVideo(video)} />;

  return (
    <View style={{ flexDirection: "row", gap: GRID_GAP }}>
      {reversed ? (
        <>
          {videoTile}
          {imagesGrid}
        </>
      ) : (
        <>
          {imagesGrid}
          {videoTile}
        </>
      )}
    </View>
  );
}

/* ─────────────────────────── main Explore screen ─────────────────────────── */
function Explore() {
  const navigation = useNavigation();

  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [explorePosts, setExplorePosts] = useState([]);
  const [exploreVideos, setExploreVideos] = useState([]);
  const [overlayStartIndex, setOverlayStartIndex] = useState(null);
  const debounceRef = useRef(null);
  // NEW — lets the tab-reload handler below scroll the grid back to top.
  const exploreScrollRef = useRef(null);

  // NEW: true whenever a Likers/Comments/Share sheet is open anywhere
  // below (inside PostFeedOverlay or FeedStoryPreview) — drives the
  // Navbar zIndex swap at the bottom of this component.
  const [sheetOpen, setSheetOpen] = useState(false);

  // NEW — screen-wide swipe to switch tabs (bubble-phase, so a swipe
  // starting on the explore grid/search results ScrollView still
  // scrolls normally; this only fires when nothing more specific
  // claimed the gesture first).
  const { panHandlers: swipePanHandlers } = useSwipeToChangeTab({ capture: false });

  const { followingIds: myFollowingIds } = useFollowStore();
  const { user: authUser, refreshAuth } = useAuth();

  const [stories, setStories] = useState([]);
  const [previewAuthorId, setPreviewAuthorId] = useState(null);
  const [seenStoryIds, setSeenStoryIds] = useState(() => new Set());

  useEffect(() => {
    // apiFetch reads the token fresh on every call, so nothing needs to be
    // primed first — these can all start immediately.
    fetchExplore();
    fetchStories();
    fetchProfileAndFollowing();
  }, []);

  const fetchStories = async () => {
    try {
      const storiesRes = await apiFetch(`${API}/stories/get-stories?includeMuted=true`);
      const storiesData = await storiesRes.json();
      if (!storiesData.success) return;

      const currentUser = await getCachedUser();
      const myId = (currentUser?._id || currentUser?.id)?.toString();

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

      const persistedSeenIds = new Set(
        groupedArr.filter((s) => !s.isOwn && s.slides.length > 0 && s.slides.every((sl) => sl.viewedByMe)).map((s) => s.id)
      );

      setStories(groupedArr);
      setSeenStoryIds(persistedSeenIds);
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    
    const refresh = () => fetchStories();
    socket.on("storyAdded", refresh);
    socket.on("storyDeleted", refresh);
    socket.on("liveStoryEnded", refresh);
    socket.on("someoneLive", refresh);
    socket.on("storyVisibilityChanged", refresh);
    return () => {
      socket.off("storyAdded", refresh);
      socket.off("storyDeleted", refresh);
      socket.off("liveStoryEnded", refresh);
      socket.off("someoneLive", refresh);
      socket.off("storyVisibilityChanged", refresh);
    };
  }, []);

  const storyAuthorIds = useMemo(() => new Set(stories.map((s) => s.id?.toString())), [stories]);

  const openStoryForAuthor = React.useCallback((authorId) => {
    setPreviewAuthorId(authorId);
    setSeenStoryIds((prev) => {
      const key = authorId?.toString();
      if (!key || prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const previewStory = previewAuthorId ? stories.find((s) => s.id?.toString() === previewAuthorId?.toString()) || null : null;

  const fetchProfileAndFollowing = async () => {
    try {
      const res = await apiFetch(`${API}/auth/profile`);
      const data = await res.json();
      if (!data?.user) return;
      await updateCachedUser(data.user);
      refreshAuth();
      const followingIds = (data.user.following || []).map((f) => (f?._id ?? f).toString());
      initFollowStore(followingIds);
    } catch (err) {
      console.log(err);
    }
  };



  useEffect(() => {
    const myId = (authUser?._id || authUser?.id)?.toString();
    if (!myId) return;

    const handler = ({ fromUserId, toUserId }) => {
      if (fromUserId?.toString() !== myId) return;
      removeFollowing(toUserId);
    };

    socket.on("userUnfollowed", handler);
    return () => socket.off("userUnfollowed", handler);
  }, [authUser?._id, authUser?.id]);

  useEffect(() => {
    const patchPrivacy = (list, userId, isPrivate) =>
      list.map((post) => {
        const authorId = post.author?._id ? post.author._id.toString() : post.author?.toString();
        if (authorId !== userId.toString()) return post;
        return { ...post, author: { ...(post.author?._id ? post.author : { _id: post.author }), isPrivate } };
      });

    const handler = ({ userId, isPrivate }) => {
      setExplorePosts((prev) => patchPrivacy(prev, userId, isPrivate));
      setExploreVideos((prev) => patchPrivacy(prev, userId, isPrivate));
    };

    socket.on("privacyChanged", handler);
    return () => socket.off("privacyChanged", handler);
  }, []);

  const fetchExplore = async () => {
    try {
      setExploreLoading(true);

      const [feedRes, reelsRes] = await Promise.all([
        apiFetch(`${API}/auth/feed?includeMuted=true`),
        apiFetch(`${API}/auth/public-reels`),
      ]);
      const feedData = await feedRes.json();
      const reelsData = await reelsRes.json();

      const feedList = Array.isArray(feedData) ? feedData : feedData.posts || [];
      const reelsList = Array.isArray(reelsData) ? reelsData : reelsData.reels || reelsData.posts || [];

      const currentUser = await getCachedUser();
      const myId = (currentUser?._id || currentUser?.id)?.toString();
      const amPrivate = !!currentUser?.isPrivate;

      const visibleFeed = amPrivate ? feedList.filter((p) => (p?.author?._id || p?.author)?.toString() !== myId) : feedList;
      const visibleReels = amPrivate ? reelsList.filter((p) => (p?.author?._id || p?.author)?.toString() !== myId) : reelsList;

      setExplorePosts(visibleFeed.filter((p) => ["image", "text", "carousel"].includes(p?.postType)));
      setExploreVideos(visibleReels.filter((p) => p?.postType === "video" || !p?.postType));
    } catch (err) {
      console.error("Explore fetch error:", err);
    } finally {
      setExploreLoading(false);
    }
  };


  // NEW — tapping the already-active "Search" tab reloads this screen:
  // exits search mode if it was open, scrolls the grid back to top, and
  // refetches everything. This does NOT run on ordinary focus (e.g.
  // navigating back from a profile you opened) — only on the explicit
  // tab tap — so scroll position/state is otherwise preserved.
  useEffect(() => {
    return subscribeTabReload("Search", () => {
      handleClear();
      exploreScrollRef.current?.scrollTo?.({ y: 0, animated: true });
      fetchExplore();
      fetchStories();
    });
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/auth/search?query=${search}`);
        const data = await res.json();
        setResults(data.users || []);
      } catch (err) {
        console.error("Search error:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const handleClear = () => {
    setSearch("");
    setResults([]);
    setIsSearching(false);
  };

  const handleFollowChange = (authorId, followed) => {
    if (followed) addFollowing(authorId);
    else removeFollowing(authorId);
  };

  const currentUserForFilter = authUser;
  const myIdForFilter = (currentUserForFilter?._id || currentUserForFilter?.id)?.toString();

  const visibleExplorePosts = useMemo(
    () =>
      explorePosts.filter((p) => {
        const authorId = (p?.author?._id || p?.author)?.toString();
        if (authorId === myIdForFilter) return true;
        if (p?.author?.isPrivate) return false;
        return true;
      }),
    [explorePosts, myIdForFilter]
  );

  const visibleExploreVideos = useMemo(
    () =>
      exploreVideos.filter((p) => {
        const authorId = (p?.author?._id || p?.author)?.toString();
        if (authorId === myIdForFilter) return true;
        if (p?.author?.isPrivate) return false;
        return true;
      }),
    [exploreVideos, myIdForFilter]
  );

  const gridBlocks = useMemo(() => {
    const blocks = [];
    const POSTS_PER_BLOCK = 4;
    const ADS_EVERY_N_BLOCKS = 2;
    let postCursor = 0;
    let videoCursor = 0;
    let blockIndex = 0;

    while (postCursor < visibleExplorePosts.length || videoCursor < visibleExploreVideos.length) {
      const blockPosts = visibleExplorePosts.slice(postCursor, postCursor + POSTS_PER_BLOCK);
      postCursor += blockPosts.length;

      const video = videoCursor < visibleExploreVideos.length ? visibleExploreVideos[videoCursor] : null;
      if (video) videoCursor++;

      if (blockPosts.length === 0 && !video) break;

      blocks.push({ kind: "block", posts: blockPosts, video, reversed: blockIndex % 2 === 1 });

      blockIndex++;
      if (blockIndex % ADS_EVERY_N_BLOCKS === 0) blocks.push({ kind: "ad" });
    }
    return blocks;
  }, [visibleExplorePosts, visibleExploreVideos]);

  const openPostOverlay = (clickedPost) => {
    const idx = visibleExplorePosts.findIndex((p) => p._id === clickedPost._id);
    setOverlayStartIndex(idx >= 0 ? idx : 0);
  };

  const openVideoReel = (clickedVideo) => {
    navigation.navigate("ExploreReels", { videoId: clickedVideo._id, video: clickedVideo, allVideos: visibleExploreVideos });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }} {...swipePanHandlers}>
      <View style={styles.searchBar}>
        {isSearching && (
          <TouchableOpacity onPress={handleClear} style={{ padding: 4 }}>
            <FeatherIcon name="arrow-left" size={22} color="#111" />
          </TouchableOpacity>
        )}
        <View style={styles.searchBox}>
          <FeatherIcon name="search" size={16} color="#777" />
          <TextInput
            placeholder="Search users..."
            style={styles.searchBoxInput}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isSearching ? (
        <ScrollView style={{ flex: 1 }}>
          {loading ? (
            <Text style={styles.loadingRow}>Searching...</Text>
          ) : results.length === 0 ? (
            <Text style={styles.noResults}>No users found for "{search}"</Text>
          ) : (
            results.map((user) => (
              <TouchableOpacity
                key={user._id || user.id}
                style={styles.searchUserRow}
                onPress={() => {
                  // FIX: some /auth/search results were coming back with
                  // `id` instead of `_id` (or missing entirely), so
                  // `user._id` was `undefined` and navigating with
                  // `userId: undefined` fell through to your own profile
                  // on the Profile screen. Fall back to `user.id` and bail
                  // out (instead of silently opening your own profile) if
                  // neither is present.
                  const targetId = user._id || user.id;
                  if (!targetId) {
                    console.warn("Search result has no id — check /auth/search response shape:", user);
                    return;
                  }
                  // FIX: tapping yourself in search results used to open
                  // the generic "UserProfile" viewer instead of your real
                  // Profile tab.
                  const searcherUser = authUser;
                  const searcherId = (searcherUser?._id || searcherUser?.id)?.toString();
                  if (targetId?.toString() === searcherId) {
                    navigation.navigate("MainTabs", { screen: "Profile" });
                  } else {
                    navigation.navigate("UserProfile", { userId: targetId });
                  }
                }}
              >
                {user.profilePic ? (
                  <Image source={{ uri: user.profilePic }} style={styles.searchUserAvatar} />
                ) : (
                  <View style={styles.searchUserAvatarFallback}>
                    <Text style={{ fontSize: 20, fontWeight: "700", color: "#888" }}>{user.username?.[0]}</Text>
                  </View>
                )}
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: "#111" }}>{user.username}</Text>
                    {user.isPrivate && <Icon name="lock" size={10} color="#888" />}
                  </View>
                  {!!user.bio && (
                    <Text style={{ fontSize: 12, color: "#888" }} numberOfLines={1}>
                      {user.bio}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView ref={exploreScrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90 }}>
          {exploreLoading ? (
            <View style={styles.exploreCentered}>
              <ActivityIndicator size="large" color="#f5a623" />
            </View>
          ) : gridBlocks.length === 0 ? (
            <Text style={styles.exploreEmpty}>No posts to discover yet.</Text>
          ) : (
            <View style={{ padding: GRID_PADDING, gap: GRID_GAP }}>
              {gridBlocks.map((block, idx) => (
                <ExploreBlock key={idx} block={block} onOpenPost={openPostOverlay} onOpenVideo={openVideoReel} />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {overlayStartIndex !== null && (
        <PostFeedOverlay
          posts={visibleExplorePosts}
          startIndex={overlayStartIndex}
          onClose={() => {
            setOverlayStartIndex(null);
            setSheetOpen(false); // safety net in case a sheet was left open
          }}
          navigation={navigation}
          onFollowChange={handleFollowChange}
          myFollowingIds={myFollowingIds}
          storyAuthorIds={storyAuthorIds}
          seenStoryIds={seenStoryIds}
          onOpenStory={openStoryForAuthor}
          onSheetOpen={setSheetOpen}
        />
      )}

      {previewStory && (
        <FeedStoryPreview
          story={previewStory}
          onClose={() => {
            setPreviewAuthorId(null);
            setSheetOpen(false); // safety net in case a sheet was left open
          }}
          navigation={navigation}
          onSheetOpen={setSheetOpen}
        />
      )}

      {/* FIX: wrapper controls Navbar's stacking relative to any open
          sheet (likers/comments/share, wherever it's opened from) —
          zIndex -1 while a sheet is open drops it behind everything,
          back to normal (10) the instant every sheet closes. Same
          treatment as VideoPage.js/Video.js. */}
      <View
        style={[
          styles.navbarWrap,
          sheetOpen ? styles.navbarWrapHidden : styles.navbarWrapVisible,
        ]}
        pointerEvents={sheetOpen ? "none" : "auto"}
      >
        <Navbar />
      </View>
    </View>
  );
}

export default Explore;

/* ─────────────────────────── styles ─────────────────────────── */
const styles = {
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#efefef",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchBoxInput: { flex: 1, fontSize: 14, color: "#111", padding: 0 },
  clearBtn: { backgroundColor: "#bbb", borderRadius: 9, width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  loadingRow: { padding: 20, textAlign: "center", color: "#aaa", fontSize: 14 },
  noResults: { padding: 40, textAlign: "center", color: "#999", fontSize: 14 },
  searchUserRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 16 },
  searchUserAvatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: "#eee" },
  searchUserAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#d5d5d5",
    alignItems: "center",
    justifyContent: "center",
  },

  // NEW: used by PostFeedOverlay / FeedStoryPreview instead of wrapping
  // them in their own <Modal> — see the FIX comments on those components.
  fullScreenOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 500, elevation: 500 },

  exploreCentered: { alignItems: "center", justifyContent: "center", padding: 60 },
  exploreEmpty: { padding: 60, textAlign: "center", color: "#aaa", fontSize: 14 },
  adRow: {
    backgroundColor: "#f7f7f7",
    borderWidth: 1,
    borderColor: "#ddd",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  videoBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

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
  dropdownItem: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0", backgroundColor: "#fff" },

  imgCard: { borderBottomWidth: 1, borderBottomColor: "#efefef", backgroundColor: "#fff" },
  imgHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12 },
  headerIconBtn: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f0f0" },
  postImg: { height: 420 },
  caption: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, fontSize: 14, lineHeight: 20 },
  moreBtn: { color: "#8e8e8e", fontWeight: "700" },
  likesSummary: { paddingHorizontal: 12, paddingTop: 2, fontSize: 13, color: "#333" },
  imgActions: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, gap: 8 },
  imgActionBtn: { flex: 1, height: 40, borderRadius: 10, backgroundColor: "#efefef", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },

  textCard: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#efefef", paddingTop: 14, paddingHorizontal: 12, paddingBottom: 4 },
  textCardBody: { fontSize: 15, lineHeight: 22, color: "#111" },
  textMenuBtn: { padding: 6, borderRadius: 8 },
  textActionBtn: { height: 38, flex: 1, borderRadius: 10, backgroundColor: "#efefef", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  textCount: { fontSize: 13, color: "#555", fontWeight: "600" },

  overlayTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#efefef",
  },

  centered: { alignItems: "center", justifyContent: "center", padding: 60 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 32, fontSize: 15 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  checkCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  sendAllBtn: { width: "100%", paddingVertical: 12, borderRadius: 12, backgroundColor: "rgb(234,182,118)", alignItems: "center" },

  heartBurstOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  carouselDotsWrap: { position: "absolute", bottom: 8, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 4 },
  carouselDot: { height: 5, borderRadius: 3 },
  carouselCounter: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 1 },

  tagsRow: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 6, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  tagChip: { backgroundColor: "#fff3e0", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2 },
  collabRow: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 8, flexDirection: "row", flexWrap: "wrap", gap: 5, alignItems: "center" },
  collabChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#e8f5e9", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  collabChipLetter: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },

  followBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },

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
  bottomSheet: { width: "100%", height: SCREEN_HEIGHT * 0.72, maxHeight: "85%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, zIndex: 999, elevation: 999 },
  sheetHandle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 12, marginBottom: 8 },
  sheetTitleRow: { alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  sheetTitleText: { fontSize: 15, fontWeight: "700" },
  sheetCloseIcon: { position: "absolute", right: 16, top: 0 },
  commentInputBar: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#f0f0f0", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },

  // NEW: Navbar wrapper — see the zIndex swap in Explore's return above.
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
  feedPreviewCard: { width: "100%", maxWidth: 340, height: "70%", maxHeight: 600, backgroundColor: "#000", borderRadius: 16, overflow: "hidden" },
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
  feedPreviewStatPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
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
  feedPreviewSendBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgb(234,182,118)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  feedPreviewCommentsFeed: { position: "absolute", bottom: 8, left: 8, right: 46, gap: 5, maxHeight: "45%" },
  feedPreviewCommentBubble: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", gap: 5, alignSelf: "flex-start", maxWidth: "90%" },
  feedPreviewCommentUser: { color: "rgb(234,182,118)", fontSize: 10, fontWeight: "700" },
  feedPreviewCommentText: { color: "#fff", fontSize: 12 },
  feedPreviewLiveBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,59,48,0.85)", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginRight: 4 },
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