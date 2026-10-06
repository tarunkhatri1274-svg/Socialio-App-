import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  UIManager,
  StyleSheet,
  findNodeHandle,
  FlatList,
  PanResponder,
} from "react-native";
import Video from "react-native-video";
import FeatherIcon from "react-native-vector-icons/Feather";
import FA5Icon from "react-native-vector-icons/FontAwesome5";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import Config from "react-native-config";
import socket from "../../sockets/Sockets";
// FIXED — this screen used to read a "openMemory" AsyncStorage key that
// nothing ever wrote (a leftover of the web version's sessionStorage
// handoff). ActivityPage.js's handleOpenMemory actually hands the
// target off via this in-memory consumePendingOpenMemory() function —
// adjust the path below if ActivityPage.js lives somewhere else.
import { consumePendingOpenMemory } from "../Activity/ActivityPage";
import FollowButton from "./FollowButton";
import { useFollowAction } from "./UseFollowAction";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path
import { setFollowStatus } from "./UseFollowState";
import MemoriesRow from "../../components/Memories/MemoryRow";
import MemoryViewer from "../../components/Memories/MemoryViewer";
import StoryViewer from "../../components/StoryBar/StoryViewer";
import MuteMenu from "./MuteMenu";
import { ProfileHeaderSkeleton, ProfileGridSkeleton } from "../../components/Skeleton/ProfileSkeleton";

const API = Config.API_URL; // swap for your RN env config


// ── Count formatter ──────────────────────────────────────────────────────
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

// ── Mini Carousel ─────────────────────────────────────────────────────────
function PostGridCarousel({ post, onPress }) {
  const [current, setCurrent] = useState(0);
  const media = post?.media || [];
  const total = media.length;
  if (!total) return null;
  return (
    <TouchableOpacity style={carouselStyles.cell} onPress={onPress} activeOpacity={0.9}>
      <Image
        source={{ uri: media[current]?.url }}
        style={carouselStyles.img}
        onError={() => {}}
      />
      {total > 1 && (
        <>
          {current > 0 && (
            <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setCurrent(i => i - 1); }} style={gridArrow("left")}>
              <Text style={{ color: "#fff", fontSize: 14 }}>‹</Text>
            </TouchableOpacity>
          )}
          {current < total - 1 && (
            <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setCurrent(i => i + 1); }} style={gridArrow("right")}>
              <Text style={{ color: "#fff", fontSize: 14 }}>›</Text>
            </TouchableOpacity>
          )}
          <View style={carouselStyles.dotsRow}>
            {media.map((_, i) => (
              <TouchableOpacity key={i} onPress={(e) => { e.stopPropagation?.(); setCurrent(i); }}>
                <View style={[carouselStyles.dot, i === current && carouselStyles.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={carouselStyles.counterBadge}>
            <Text style={carouselStyles.counterText}>{current + 1}/{total}</Text>
          </View>
        </>
      )}
      {post?.isCollab && (
        <View style={carouselStyles.collabBadge}>
          <Text style={carouselStyles.collabText}>🤝 Collab</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const gridArrow = (side) => ({
  position: "absolute",
  top: "50%",
  marginTop: -11,
  [side]: 4,
  backgroundColor: "rgba(0,0,0,0.45)",
  borderRadius: 11,
  width: 22,
  height: 22,
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2,
});

// ── Video grid thumbnail resolver ────────────────────────────────────────
// Mounting a live <Video> player in every grid cell causes overlapping/
// bleeding thumbnails on Android (SurfaceView doesn't respect clipping).
// Prefer a static poster image, in this order:
//   1. an explicit thumbnail field, if the backend ever adds one
//   2. a still frame derived from the Cloudinary video URL itself
//      (no backend change needed — Cloudinary can render any video
//      frame as a JPEG via URL transformation)
//   3. fall back to rendering the actual video (muted/paused) only if
//      neither of the above is possible (e.g. non-Cloudinary URL)
function cloudinaryVideoThumbnail(url) {
  if (!url || typeof url !== "string") return null;
  if (!url.includes("res.cloudinary.com") || !url.includes("/video/upload/")) return null;

  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const before = url.slice(0, idx + marker.length);
  let after = url.slice(idx + marker.length);

  // Swap the video extension for .jpg and grab the frame at 0s (so_0).
  after = after.replace(/\.(mp4|mov|webm|mkv|avi|m4v)(\?.*)?$/i, ".jpg$2");
  if (!/\.jpg(\?.*)?$/i.test(after)) return null; // unrecognized extension — bail out

  return `${before}so_0/${after}`;
}

function getVideoThumbnail(video) {
  const explicit =
    video?.thumbnail ||
    video?.thumbnailUrl ||
    video?.poster ||
    video?.coverImage ||
    video?.media?.[0]?.thumbnail ||
    video?.media?.[0]?.poster ||
    null;
  if (explicit) return explicit;

  return cloudinaryVideoThumbnail(video?.media?.[0]?.url || video?.url);
}

function VideoGridThumb({ video, style }) {
  const thumbUri = getVideoThumbnail(video);
  if (thumbUri) {
    return <Image source={{ uri: thumbUri }} style={style} resizeMode="cover" />;
  }
  // Neither an explicit thumbnail nor a derivable Cloudinary frame —
  // fall back to a real (muted/paused) video render. useTextureView
  // keeps Android from letting the SurfaceView bleed into neighboring
  // cells even in this fallback case.
  return (
    <Video
      source={{ uri: video?.media?.[0]?.url }}
      style={style}
      muted
      paused
      resizeMode="cover"
      useTextureView
    />
  );
}

// ── Tab order used for horizontal swipe navigation ──────────────────────────
const PROFILE_TAB_ORDER = ["posts", "Shorts", "text"];
const SWIPE_HORIZONTAL_THRESHOLD = 12; // px moved before we commit to a horizontal gesture
const SWIPE_DIRECTION_RATIO = 2;       // how much more horizontal than vertical movement is required
const SWIPE_RELEASE_THRESHOLD = 50;    // px needed on release to actually change tabs

// ── Main Component ──────────────────────────────────────────────────────
function UserProfileView() {
  const navigation = useNavigation();
  const route = useRoute();
  const { userId } = route.params || {};

  const [myId, setMyId] = useState(null);
  useEffect(() => {
    getCachedUser().then((u) => setMyId((u?._id || u?.id)?.toString() || null));
  }, []);
  const isOwnProfile = myId != null && myId === userId;

  useEffect(() => {
    if (isOwnProfile) navigation.replace("MainTabs", { screen: "Profile" });
  }, [isOwnProfile, navigation]);

  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── PERSISTED ACTIVE TAB — keyed by userId via AsyncStorage, restored
  // on focus (not just mount) since React Navigation stack screens often
  // stay mounted underneath a pushed detail screen.
  const [activeTab, setActiveTab] = useState("posts");
  const consumedReturnTabForUserRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (consumedReturnTabForUserRef.current === userId) return;
      consumedReturnTabForUserRef.current = userId;

      let cancelled = false;
      (async () => {
        const key = `userProfileReturnTab_${userId}`;
        try {
          const remembered = await AsyncStorage.getItem(key);
          if (cancelled) return;
          if (remembered) {
            await AsyncStorage.removeItem(key);
            setActiveTab(remembered);
          } else {
            setActiveTab("posts");
            await AsyncStorage.removeItem(`userProfileReturnPostId_${userId}`);
          }
        } catch (err) {
          console.log("Failed to restore user profile tab:", err.message);
        }
      })();
      return () => { cancelled = true; };
    }, [userId])
  );

  const [isBlocked, setIsBlocked] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);

  const [listModal, setListModal] = useState(null); // "followers" | "following" | null
  const [searchQuery, setSearchQuery] = useState("");
  const [modalList, setModalList] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  const [mutuals, setMutuals] = useState([]);
  const [mutualCount, setMutualCount] = useState(0);

  const { status: followState, handleFollowBtn, busy: followBusy } =
    useFollowAction(userId, { isPrivate });

  const canSeeFollowList = !isPrivate || followState === "following";
  const canSeePosts = !isPrivate || followState === "following";

  const [story, setStory] = useState(null);
  const [showStoryPreview, setShowStoryPreview] = useState(false);
  const hasStory = !!story && story.slides.length > 0;
  const seenStory = hasStory && story.slides.every(s => s.viewedByMe);

  const [groups, setGroups] = useState([]);
  const [memoryViewer, setMemoryViewer] = useState(null);

  const scrollViewRef = useRef(null);
  const itemRefs = useRef({}); // postId -> node ref

  // ── Swipe left/right on the tab content to move to the next/previous tab.
  // Only claims the gesture once the drag is clearly more horizontal than
  // vertical, so the outer vertical ScrollView keeps working normally.
  const goToAdjacentTab = useCallback((direction) => {
    setActiveTab((current) => {
      const idx = PROFILE_TAB_ORDER.indexOf(current);
      if (idx === -1) return current;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= PROFILE_TAB_ORDER.length) return current;
      return PROFILE_TAB_ORDER[nextIdx];
    });
  }, []);

  const tabPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        Math.abs(gestureState.dx) > SWIPE_HORIZONTAL_THRESHOLD &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * SWIPE_DIRECTION_RATIO,
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx <= -SWIPE_RELEASE_THRESHOLD) {
          goToAdjacentTab(1); // swipe left → next tab
        } else if (gestureState.dx >= SWIPE_RELEASE_THRESHOLD) {
          goToAdjacentTab(-1); // swipe right → previous tab
        }
      },
    })
  ).current;

  const fetchGroups = useCallback(async () => {
    if (!userId || !canSeePosts) { setGroups([]); return; }
    try {
      const res = await apiFetch(`${API}/memories/groups/user/${userId}`);
      const data = await res.json();
      if (data.success) setGroups(data.groups);
    } catch {
      setGroups([]);
    }
  }, [userId, canSeePosts]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // FIXED — consume the "open this exact memory" handoff. This now
  // reads the same in-memory value ActivityPage.js's handleOpenMemory
  // actually sets (consumed once, read-and-clear), instead of an
  // AsyncStorage key nothing wrote to.
  //
  // ALSO FIXED — useFocusEffect, not useEffect. A fresh notification tap
  // usually pushes a new UserProfile screen instance (so plain useEffect
  // would work), but tapping a memory notification about someone whose
  // profile you're ALREADY viewing doesn't remount the screen — React
  // Navigation just re-focuses the existing one — so the effect would
  // never re-fire and the handoff would sit unconsumed, same bug as
  // ProfilePage.js's Profile tab.
  useFocusEffect(
    useCallback(() => {
      if (!userId || isOwnProfile) return;
      const pending = consumePendingOpenMemory();
      if (!pending?.groupId || !pending?.itemId) return;
      setMemoryViewer({
        groupId: pending.groupId,
        itemId: pending.itemId,
        sheet: pending.sheet || null,
        commentId: pending.commentId || null,
        replyId: pending.replyId || null,
      });
    }, [userId, isOwnProfile])
  );

  useEffect(() => {
    if (!userId) return;
    const handler = (payload) => {
      const aid = payload?.authorId;
      if (!aid || aid === userId) fetchGroups();
    };
    socket.on("memoryGroupAdded", handler);
    socket.on("memoryGroupDeleted", handler);
    socket.on("memoryItemAdded", handler);
    socket.on("memoryItemDeleted", handler);
    socket.on("memoryVisibilityChanged", handler);
    return () => {
      socket.off("memoryGroupAdded", handler);
      socket.off("memoryGroupDeleted", handler);
      socket.off("memoryItemAdded", handler);
      socket.off("memoryItemDeleted", handler);
      socket.off("memoryVisibilityChanged", handler);
    };
  }, [userId, fetchGroups]);

  const fetchStory = useCallback(async () => {
    if (!userId || !canSeePosts) { setStory(null); return; }
    try {
      const res = await apiFetch(`${API}/stories/get-user-stories/${userId}`);
      const data = await res.json();
      if (!data.success || !data.stories?.length) { setStory(null); return; }
      setStory({
        id: userId,
        username: user?.username || "Unknown",
        userProfile: user?.profilePic || "",
        isOwn: false,
        slides: data.stories.map((s) => ({
          id: s._id,
          image: s.media?.url || "",
          type: s.media?.type || s.storyType,
          likes: s.likesCount || 0,
          isLive: s.storyType === "live",
          liveRoomId: s.liveRoomId || null,
          authorId: userId,
          isHiddenFromNonFollowers: s.isHiddenFromNonFollowers || false,
          viewedByMe: !!s.viewedByMe,
          textOverlays: s.textOverlays || [],
          mentions: s.mentions || [],
          repostAttribution: s.repostAttribution || null,
        })),
      });
    } catch {
      setStory(null);
    }
  }, [userId, canSeePosts, user?.username, user?.profilePic]);

  useEffect(() => { fetchStory(); }, [fetchStory]);

  useEffect(() => {
    if (!userId) return;
    const handler = (payload) => {
      const aid = payload?.authorId;
      if (!aid || aid === userId) fetchStory();
    };
    socket.on("storyAdded", handler);
    socket.on("storyDeleted", handler);
    socket.on("storyVisibilityChanged", handler);
    socket.on("liveStoryEnded", handler);
    socket.on("someoneLive", handler);
    return () => {
      socket.off("storyAdded", handler);
      socket.off("storyDeleted", handler);
      socket.off("storyVisibilityChanged", handler);
      socket.off("liveStoryEnded", handler);
      socket.off("someoneLive", handler);
    };
  }, [userId, fetchStory]);

  // ── Fetch profile ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const fetchUser = async () => {
      try {
        const res = await apiFetch(`${API}/auth/user/${userId}`);
        if (!res.ok) { setError("Failed to load profile."); setLoading(false); return; }
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          setIsPrivate(data.user.isPrivate ?? false);
          setIsBlocked(data.user.isBlockedByMe ?? false);
          setFollowStatus(
            userId,
            data.user.isFollowedByMe ? "following"
              : data.user.followRequestPending ? "requested"
              : "none"
          );
        } else {
          setError("User not found.");
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [userId]);

  // ── Fetch posts ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const fetchPosts = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-posts/${userId}`);
        const data = await res.json();
        if (data.success) setPosts(data.posts);
      } catch {}
    };
    fetchPosts();
  }, [userId]);

  // ── Scroll to the exact post/short/text-post tapped, once posts have
  // loaded and this screen is focused. Uses a ref registry + measureLayout
  // instead of getElementById/scrollIntoView.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (loading || !posts.length || !userId) return;

      (async () => {
        const key = `userProfileReturnPostId_${userId}`;
        const targetId = await AsyncStorage.getItem(key);
        if (cancelled || !targetId) return;

        setTimeout(() => {
          if (cancelled) return;
          const target = itemRefs.current[targetId];
          const targetNode = target && findNodeHandle(target);
          const scrollNode = scrollViewRef.current && findNodeHandle(scrollViewRef.current);
          if (targetNode && scrollNode) {
            UIManager.measureLayout(
              targetNode,
              scrollNode,
              () => {},
              (x, y) => scrollViewRef.current.scrollTo({ y: Math.max(y - 20, 0), animated: false })
            );
          }
          AsyncStorage.removeItem(key);
        }, 80);
      })();

      return () => { cancelled = true; };
    }, [loading, posts, userId])
  );

  // ── Fetch mutual followers ───────────────────────────────────────────
  useEffect(() => {
    if (!userId || isOwnProfile) return;
    const fetchMutuals = async () => {
      try {
        const res = await apiFetch(`${API}/auth/mutuals/${userId}`);
        const data = await res.json();
        if (data.success) {
          setMutuals(data.mutuals || []);
          setMutualCount(data.count || 0);
        }
      } catch {}
    };
    fetchMutuals();
  }, [userId, isOwnProfile]);

  // ── Live socket: follower/following list updates ────────────────────
  useEffect(() => {
    if (!userId) return;

    const onFollowersList = ({ userId: uid, followers, restricted }) => {
      if (uid !== userId) return;
      if (listModal === "followers") {
        setModalList(restricted ? [] : (followers || []));
        setModalLoading(false);
      }
      if (!restricted && followers) {
        setUser(prev => prev ? { ...prev, followers } : prev);
      }
    };

    const onFollowingList = ({ userId: uid, following, restricted }) => {
      if (uid !== userId) return;
      if (listModal === "following") {
        setModalList(restricted ? [] : (following || []));
        setModalLoading(false);
      }
      if (!restricted && following) {
        setUser(prev => prev ? { ...prev, following } : prev);
      }
    };

    socket.on("followersList", onFollowersList);
    socket.on("followingList", onFollowingList);

    return () => {
      socket.off("followersList", onFollowersList);
      socket.off("followingList", onFollowingList);
    };
  }, [userId, listModal]);

  // ── Live socket: profile/social events ────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const onPrivacyChanged = ({ userId: changedId, isPrivate: priv }) => {
      if (changedId === userId) {
        setIsPrivate(priv);
        setUser(prev => prev ? { ...prev, isPrivate: priv } : prev);
      }
    };

    const onProfileUpdated = ({ userId: updatedId, profilePic, coverPic, username, bio }) => {
      if (updatedId === userId) {
        setUser(prev => prev ? { ...prev, profilePic, coverPic, username, bio } : prev);
      }
    };

    const onFollowAccepted = ({ from, toUserId }) => {
      if (toUserId === userId && from === myId) {
        setUser(prev => prev ? { ...prev, followers: [...(prev.followers ?? []), { _id: myId }] } : prev);
      }
    };

    const onUserUnfollowed = ({ fromUserId, toUserId }) => {
      if (toUserId === userId) {
        setUser(prev => prev ? {
          ...prev,
          followers: (prev.followers ?? []).filter(f => (f?._id ?? f).toString() !== fromUserId),
        } : prev);
      }
    };

    const onUserFollowed = ({ fromUserId, toUserId }) => {
      if (toUserId === userId && fromUserId !== myId) {
        setUser(prev => prev ? { ...prev, followers: [...(prev.followers ?? []), { _id: fromUserId }] } : prev);
      }
    };

    const onNewPost = ({ post }) => {
      if ((post?.author?._id ?? post?.author)?.toString() === userId) {
        setPosts(prev => [post, ...prev]);
      }
    };

    const onPostDeleted = ({ postId }) => setPosts(prev => prev.filter(p => p._id !== postId));

    const onCollabResponded = ({ postId, accepted }) => {
      if (!accepted) return;
      (async () => {
        try {
          const res = await apiFetch(`${API}/auth/get-posts/${userId}`);
          const data = await res.json();
          if (data.success) setPosts(data.posts);
        } catch {}
      })();
    };

    const onUserAccountDeleted = ({ userId: deletedId }) => {
      if (deletedId === userId) navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    };

    socket.emit("joinUserRoom", userId);
    socket.on("privacyChanged", onPrivacyChanged);
    socket.on("profileUpdated", onProfileUpdated);
    socket.on("followAccepted", onFollowAccepted);
    socket.on("userUnfollowed", onUserUnfollowed);
    socket.on("userFollowed", onUserFollowed);
    socket.on("newPost", onNewPost);
    socket.on("postDeleted", onPostDeleted);
    socket.on("collabResponded", onCollabResponded);
    socket.on("userAccountDeleted", onUserAccountDeleted);

    return () => {
      socket.emit("leaveUserRoom", userId);
      socket.off("privacyChanged", onPrivacyChanged);
      socket.off("profileUpdated", onProfileUpdated);
      socket.off("followAccepted", onFollowAccepted);
      socket.off("userUnfollowed", onUserUnfollowed);
      socket.off("userFollowed", onUserFollowed);
      socket.off("newPost", onNewPost);
      socket.off("postDeleted", onPostDeleted);
      socket.off("collabResponded", onCollabResponded);
      socket.off("userAccountDeleted", onUserAccountDeleted);
    };
  }, [userId, myId, navigation]);

  const openModal = (type) => {
    if (!canSeeFollowList) return;
    setSearchQuery("");
    setListModal(type);
    setModalLoading(true);
    setModalList([]);
    socket.emit(type === "followers" ? "getFollowers" : "getFollowing", { userId, viewerId: myId });
  };

  const closeModal = () => { setListModal(null); setSearchQuery(""); setModalList([]); };
  const filteredList = modalList.filter(u => u.username?.toLowerCase().includes(searchQuery.toLowerCase()));

  // ── window.confirm → Alert.alert ──────────────────────────────────────
  const handleBlockUserBtn = () => {
    if (isBlocked) return;
    Alert.alert("Block user", `Block ${user?.username}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await apiFetch(`${API}/auth/block/${userId}`, { method: "POST" });
            const data = await res.json();
            if (data.success) setIsBlocked(true);
          } catch {}
        },
      },
    ]);
  };

  const handleMessageClick = async () => {
    if (messageBusy) return;
    setMessageBusy(true);
    try {
      const res = await apiFetch(`${API}/messages/chat/${myId}/${userId}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const conv = {
        _id: data.chatId,
        members: [{ _id: myId }, user],
        otherUser: user,
      };
      await AsyncStorage.setItem("openConv", JSON.stringify(conv));
    } catch (err) {
      console.error("Open chat failed", err);
      await AsyncStorage.removeItem("openConv");
    } finally {
      setMessageBusy(false);
      navigation.navigate("MainTabs", { screen: "Messages" });
    }
  };

  const openStoryPreview = () => {
    if (!hasStory) return;
    setShowStoryPreview(true);
  };

  const followersCount = user?.followers?.length ?? 0;
  const followingCount = user?.following?.length ?? 0;
  const postsCount = posts.length;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <FeatherIcon name="arrow-left" size={22} color="#111" />
          </TouchableOpacity>
          <View style={{ width: 22 }} />
          <View style={{ width: 22 }} />
        </View>
        <ProfileHeaderSkeleton />
        <ProfileGridSkeleton />
      </View>
    );
  }

  if (error) {
    return (
      <View style={centerScreen}>
        <Text style={{ color: "#999", fontSize: 14 }}>{error}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, backgroundColor: "#fff" }}>
          <Text style={{ fontSize: 14 }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* ── Followers/Following Modal ── */}
      <Modal visible={!!listModal} transparent animationType="fade" onRequestClose={closeModal}>
        <TouchableOpacity style={modalOverlayStyle} activeOpacity={1} onPress={closeModal}>
          <TouchableOpacity activeOpacity={1} style={modalBoxStyle} onPress={() => {}}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "700" }}>{listModal === "followers" ? "Followers" : "Following"}</Text>
              <TouchableOpacity onPress={closeModal}><FeatherIcon name="x" size={20} /></TouchableOpacity>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: "#eee", marginBottom: 10 }} />
            <View style={searchWrapperStyle}>
              <FeatherIcon name="search" size={15} color="#999" style={{ marginLeft: 10 }} />
              <TextInput placeholder="Search" value={searchQuery} onChangeText={setSearchQuery} style={searchInputStyle} />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <FeatherIcon name="x" size={15} color="#999" style={{ marginRight: 10 }} />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView>
              {modalLoading ? (
                <Text style={{ textAlign: "center", color: "#aaa", fontSize: 14, padding: 20 }}>Loading...</Text>
              ) : filteredList.length === 0 ? (
                <Text style={{ textAlign: "center", color: "gray", fontSize: 14, padding: 20 }}>No results found</Text>
              ) : filteredList.map(u => (
                <TouchableOpacity key={u._id ?? u.id} style={userRowStyle}
                  onPress={() => { closeModal(); navigation.navigate("UserProfile", { userId: u._id }); }}>
                  {u.profilePic
                    ? <Image source={{ uri: u.profilePic }} style={userAvatarStyle} />
                    : <View style={[userAvatarStyle, { backgroundColor: "#ddd", alignItems: "center", justifyContent: "center" }]}>
                        <Text style={{ fontWeight: "700", color: "#888" }}>{u.username?.[0]?.toUpperCase()}</Text>
                      </View>
                  }
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: "500" }}>{u.username}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ScrollView ref={scrollViewRef} style={{ flex: 1 }}>

        {/* ── Top Bar ── */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <FeatherIcon name="arrow-left" size={22} color="#111" />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: "800" }}>{user?.username}</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* ── Cover ── */}
        <View style={styles.coverContainer}>
          {user?.coverPic
            ? <Image source={{ uri: user.coverPic }} style={styles.cover} />
            : <View style={styles.coverFallback} />
          }
        </View>

        {/* ── Profile Row ── */}
        <View style={styles.profileRow}>
          {hasStory ? (
            <TouchableOpacity onPress={openStoryPreview} style={profileRingWrap(seenStory)}>
              <View style={profileRingInner}>
                {user?.profilePic
                  ? <Image source={{ uri: user.profilePic }} style={profileImgNoBorder} />
                  : <View style={profileImgFallbackNoBorder}><Text style={{ fontSize: 30, fontWeight: "700", color: "#fff" }}>{user?.username?.[0]?.toUpperCase()}</Text></View>
                }
              </View>
            </TouchableOpacity>
          ) : (
            user?.profilePic
              ? <Image source={{ uri: user.profilePic }} style={styles.profileImg} />
              : <View style={styles.profileImgFallback}><Text style={{ fontSize: 32, fontWeight: "700", color: "#fff" }}>{user?.username?.[0]?.toUpperCase()}</Text></View>
          )}
          <View style={styles.info}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 17, fontWeight: "800" }}>{user?.username}</Text>
              {isPrivate && <FA5Icon name="lock" size={12} color="#888" />}
            </View>
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{formatCount(postsCount)}</Text>
                <Text style={styles.statLabel}>posts</Text>
              </View>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statItem} onPress={() => canSeeFollowList && openModal("followers")}>
                <Text style={styles.statNum}>{formatCount(followersCount)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Text style={styles.statLabel}>followers</Text>
                  {isPrivate && !canSeeFollowList && <FA5Icon name="lock" size={9} color="#bbb" />}
                </View>
              </TouchableOpacity>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statItem} onPress={() => canSeeFollowList && openModal("following")}>
                <Text style={styles.statNum}>{formatCount(followingCount)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Text style={styles.statLabel}>following</Text>
                  {isPrivate && !canSeeFollowList && <FA5Icon name="lock" size={9} color="#bbb" />}
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Bio ── */}
        {!!user?.bio && <Text style={styles.bio}>{user.bio}</Text>}

        {/* ── Mutual Followers ── */}
        {mutualCount > 0 && (
          <View style={styles.mutualRow}>
            <View style={styles.mutualAvatars}>
              {mutuals.slice(0, 3).map((m) => (
                m.profilePic
                  ? <Image key={m._id} source={{ uri: m.profilePic }} style={styles.mutualAvatar} />
                  : <View key={m._id} style={[styles.mutualAvatar, { backgroundColor: "#ddd", alignItems: "center", justifyContent: "center" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: "#888" }}>{m.username?.[0]?.toUpperCase()}</Text>
                    </View>
              ))}
            </View>
            <Text style={styles.mutualText}>
              Followed by <Text style={{ fontWeight: "700", color: "#111" }}>{mutuals[0]?.username}</Text>
              {mutualCount > 1 && (
                mutualCount === 2
                  ? <> and <Text style={{ fontWeight: "700", color: "#111" }}>{mutuals[1]?.username}</Text></>
                  : <> and <Text style={{ fontWeight: "700", color: "#111" }}>{mutualCount - 1} others</Text></>
              )}
            </Text>
          </View>
        )}

        {/* ── Action Buttons ── */}
        <View style={styles.actionsWrap}>
          <View style={styles.actions}>
            <FollowButton
              authorId={userId}
              isPrivate={isPrivate}
              isOwner={isOwnProfile}
              isBlocked={isBlocked}
            />
            <TouchableOpacity style={[styles.messageBtn, messageBusy && { opacity: 0.6 }]} onPress={handleMessageClick} disabled={messageBusy}>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#111" }}>{messageBusy ? "Opening…" : "Message"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={isBlocked ? styles.blockedBtn : styles.blockBtn} onPress={handleBlockUserBtn} disabled={isBlocked}>
              <Text style={{ fontWeight: "700", fontSize: 14, color: isBlocked ? "#333" : "#fff" }}>{isBlocked ? "Blocked" : "Block"}</Text>
            </TouchableOpacity>
            {!isBlocked && (
              <MuteMenu userId={userId} username={user?.username || "this user"} />
            )}
          </View>
        </View>

        {/* ── Memories ("Highlights") — view-only ── */}
        {canSeePosts && (
          <MemoriesRow
            groups={groups}
            onOpenGroup={(groupId) => setMemoryViewer({ groupId, itemId: null })}
          />
        )}

        {/* ── Posts / Private Lock ── */}
        {!canSeePosts ? (
          <View style={styles.privateBox}>
            <FA5Icon name="lock" size={32} color="#ccc" style={{ marginBottom: 10 }} />
            <Text style={{ fontSize: 15, fontWeight: "600", color: "#444" }}>This account is private</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: "#999" }}>
              {followState === "requested"
                ? "Follow request sent. Waiting for approval."
                : "Follow this account to see their posts."}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tabs}>
              {["posts", "Shorts", "text"].map(tab => (
                <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)}>
                  <Text style={activeTab === tab ? styles.activeTab : styles.inactiveTab}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ padding: 10 }} {...tabPanResponder.panHandlers}>
              {activeTab === "posts" && <Posts posts={posts} navigation={navigation} userId={userId} itemRefs={itemRefs} />}
              {activeTab === "Shorts" && <Shorts posts={posts} userId={userId} navigation={navigation} itemRefs={itemRefs} />}
              {activeTab === "text" && <TextPosts posts={posts} navigation={navigation} userId={userId} itemRefs={itemRefs} />}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── STORY PREVIEW OVERLAY ── */}
      {showStoryPreview && hasStory && (
        <StoryViewer
  stories={[story]}
  index={0}
  close={() => setShowStoryPreview(false)}
  currentUserId={myId}
/>
      )}

      {/* ── MEMORY VIEWER OVERLAY (view-only) ── */}
      {memoryViewer && (
        <MemoryViewer
          groupId={memoryViewer.groupId}
          isOwner={false}
          initialItemId={memoryViewer.itemId}
          initialSheet={memoryViewer.sheet}
          initialCommentId={memoryViewer.commentId}
          initialReplyId={memoryViewer.replyId}
          // ← FIXED — belt-and-suspenders against "Cannot update a
          // component (`UserProfileView`) while rendering a different
          // component (`MemoryViewer`)", same reasoning as
          // ProfilePage.js. MemoryViewer.js already defers its own
          // risky call site, but deferring the actual setState here
          // too keeps this screen safe regardless.
          onClose={() => setTimeout(() => setMemoryViewer(null), 0)}
          onGroupEmptied={() => setTimeout(() => { setMemoryViewer(null); fetchGroups(); }, 0)}
        />
      )}
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
const Posts = ({ posts, navigation, userId, itemRefs }) => {
  const imagePosts = posts.filter(p =>
    (p?.postType === "image" || p?.postType === "carousel") &&
    p?.media?.length > 0 && p.media.some(m => m?.url)
  );
  if (!imagePosts.length)
    return <Text style={{ textAlign: "center", padding: 30, color: "gray" }}>No posts yet</Text>;
  return (
    <View style={styles.grid}>
      {imagePosts.map(post => (
        <View key={post._id} ref={(el) => { itemRefs.current[post._id] = el; }} style={styles.gridCell}>
          <PostGridCarousel
            post={post}
            onPress={async () => {
              await AsyncStorage.setItem(`userProfileReturnTab_${userId}`, "posts");
              await AsyncStorage.setItem(`userProfileReturnPostId_${userId}`, post._id);
              navigation.navigate("PostDetail", { post, allPosts: imagePosts });
            }}
          />
        </View>
      ))}
    </View>
  );
};

const Shorts = ({ posts, userId, navigation, itemRefs }) => {
  const videoPosts = posts.filter(p => p?.postType === "video");
  if (!videoPosts.length)
    return <Text style={{ textAlign: "center", padding: 20, color: "gray" }}>No reels yet 🎥</Text>;
  return (
    <FlatList
      data={videoPosts}
      numColumns={3}
      keyExtractor={(item) => item._id}
      scrollEnabled={false}
      initialNumToRender={9}
      maxToRenderPerBatch={9}
      windowSize={5}
      removeClippedSubviews={true}
      renderItem={({ item: video }) => (
        <TouchableOpacity
          ref={(el) => { itemRefs.current[video._id] = el; }}
          style={styles.gridCell}
          onPress={async () => {
            await AsyncStorage.setItem(`userProfileReturnTab_${userId}`, "Shorts");
            await AsyncStorage.setItem(`userProfileReturnPostId_${userId}`, video._id);
            navigation.navigate("ProfileReel", { video, allVideos: videoPosts, ownerUserId: userId });
          }}>
          <VideoGridThumb video={video} style={styles.postImg} />
          <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.15)" }}>
            <Text style={{ color: "#fff", fontSize: 20 }}>▶</Text>
          </View>
          {video?.isCollab && (
            <View style={{ position: "absolute", top: 4, left: 4, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>🤝</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    />
  );
};

// ── Expandable text for the Text tab ────────────────────────────────────
const ExpandableProfileText = ({ text, limit = 180 }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text style={profileTextStyle}>
        {text}
        {isLong && <Text onPress={() => setExpanded(false)} style={moreLessStyle}> less</Text>}
      </Text>
    );
  }

  return (
    <Text style={profileTextStyle}>
      {text.slice(0, limit).trimEnd()}...
      <Text onPress={() => setExpanded(true)} style={moreLessStyle}> more</Text>
    </Text>
  );
};

const TextPosts = ({ posts, navigation, userId, itemRefs }) => {
  const textPosts = posts.filter(p => p?.postType === "text");
  if (!textPosts.length)
    return <Text style={{ textAlign: "center", padding: 20, color: "gray" }}>No text posts yet 📝</Text>;
  return (
    <View style={{ gap: 12 }}>
      {textPosts.map(post => (
        <TouchableOpacity
          key={post._id}
          ref={(el) => { itemRefs.current[post._id] = el; }}
          style={textCardStyle}
          onPress={async () => {
            await AsyncStorage.setItem(`userProfileReturnTab_${userId}`, "text");
            await AsyncStorage.setItem(`userProfileReturnPostId_${userId}`, post._id);
            navigation.navigate("TextPost", { post, allPosts: textPosts });
          }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingBottom: 8 }}>
            {post?.author?.profilePic
              ? <Image source={{ uri: post.author.profilePic }} style={{ width: 38, height: 38, borderRadius: 19 }} />
              : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontWeight: "700", color: "#fff", fontSize: 15 }}>{post?.author?.username?.[0]?.toUpperCase() || "?"}</Text>
                </View>
            }
            <Text style={{ fontWeight: "600", fontSize: 14, color: "#111" }}>{post?.author?.username}</Text>
          </View>

          {!!post?.text && <ExpandableProfileText text={post.text} />}

          {post?.media?.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
              {post.media.map((m, i) => (
                <Image
                  key={i}
                  source={{ uri: m.url }}
                  style={{ width: post.media.length === 1 ? 300 : 160, height: 160, borderRadius: 10, marginRight: 6 }}
                />
              ))}
            </ScrollView>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────
const centerScreen = { flex: 1, alignItems: "center", justifyContent: "center" };
const modalOverlayStyle = { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" };
const modalBoxStyle = { backgroundColor: "#fff", borderRadius: 12, width: "90%", maxWidth: 380, maxHeight: "70%", padding: 16 };
const searchWrapperStyle = { flexDirection: "row", alignItems: "center", backgroundColor: "#f0f0f0", borderRadius: 10, marginBottom: 12 };
const searchInputStyle = { flex: 1, padding: 9, fontSize: 14 };
const userRowStyle = { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" };
const userAvatarStyle = { width: 42, height: 42, borderRadius: 21 };
const textCardStyle = { borderWidth: 1, borderColor: "#eee", borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" };

const styles = StyleSheet.create({
  container: { flex: 1, maxWidth: 420, width: "100%", alignSelf: "center", backgroundColor: "#fff" },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 15, paddingTop: 14, paddingBottom: 8 },
  coverContainer: { width: "100%", paddingHorizontal: 15, height: 170 },
  cover: { width: "100%", height: "100%", borderRadius: 16 },
  coverFallback: { width: "100%", height: "100%", borderRadius: 16, backgroundColor: "#d5d5d5" },
  profileRow: { flexDirection: "row", alignItems: "center", padding: 15, paddingTop: 16, paddingBottom: 6, gap: 16 },
  profileImg: { width: 85, height: 85, borderRadius: 43, borderWidth: 3, borderColor: "#fff" },
  profileImgFallback: { width: 85, height: 85, borderRadius: 43, backgroundColor: "#b0b0b0", alignItems: "center", justifyContent: "center" },
  info: { flexDirection: "column", flex: 1 },
  stats: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8 },
  statDivider: { width: 1, height: 24, backgroundColor: "#eee" },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 15, fontWeight: "700", color: "#111" },
  statLabel: { fontSize: 11, color: "#888", marginTop: 1 },
  bio: { marginHorizontal: 15, marginTop: 10, fontSize: 14, fontWeight: "500", color: "#444", lineHeight: 20 },
  mutualRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 15, marginTop: 12, padding: 12, backgroundColor: "#f8f8f8", borderRadius: 12 },
  mutualAvatars: { flexDirection: "row" },
  mutualAvatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", marginLeft: -6 },
  mutualText: { fontSize: 12, color: "#666", lineHeight: 17, flex: 1 },
  actionsWrap: { paddingHorizontal: 15, paddingTop: 14 },
  actions: { flexDirection: "row", gap: 8 },
  messageBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e2e2e2", backgroundColor: "#fff", alignItems: "center" },
  blockBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#ff3b30", borderRadius: 12, alignItems: "center" },
  blockedBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#e0e0e0", borderRadius: 12, alignItems: "center" },
  privateBox: { alignItems: "center", padding: 50 },
  tabs: { flexDirection: "row", justifyContent: "space-around", marginTop: 18, borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 12 },
  activeTab: { fontWeight: "700", borderBottomWidth: 2, borderBottomColor: "#111", paddingBottom: 10, color: "#111" },
  inactiveTab: { color: "#aaa", paddingBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  gridCell: { width: `${100 / 3}%`, aspectRatio: 1, padding: 2, position: "relative" },
  postImg: { width: "100%", height: "100%", borderRadius: 6 },
});

const carouselStyles = StyleSheet.create({
  cell: { width: "100%", height: "100%", position: "relative", overflow: "hidden", borderRadius: 6 },
  img: { width: "100%", height: "100%" },
  dotsRow: { position: "absolute", bottom: 5, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { width: 12, backgroundColor: "#fff" },
  counterBadge: { position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, paddingHorizontal: 6, paddingVertical: 1 },
  counterText: { color: "#fff", fontSize: 10, fontWeight: "600" },
  collabBadge: { position: "absolute", top: 6, left: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  collabText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});

// ── Story ring styles ─────────────────────────────────────────────────
const profileRingWrap = (seen) => ({
  width: 91, height: 91, borderRadius: 45.5,
  backgroundColor: seen ? "#c7c7c7" : "rgb(234,182,118)",
  alignItems: "center", justifyContent: "center", padding: 2,
});
const profileRingInner = {
  width: "100%", height: "100%", borderRadius: 45.5, backgroundColor: "#fff",
  alignItems: "center", justifyContent: "center", padding: 2,
};
const profileImgNoBorder = { width: 83, height: 83, borderRadius: 41.5 };
const profileImgFallbackNoBorder = {
  width: 83, height: 83, borderRadius: 41.5, backgroundColor: "#b0b0b0",
  alignItems: "center", justifyContent: "center",
};

const profileTextStyle = { paddingHorizontal: 12, paddingBottom: 10, fontSize: 15, lineHeight: 22, color: "#222" };
const moreLessStyle = { color: "#8e8e8e", fontWeight: "700" };

export default UserProfileView;