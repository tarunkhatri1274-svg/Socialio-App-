import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  StyleSheet,
  findNodeHandle,
  FlatList,
  UIManager,
  Animated,
  RefreshControl,
} from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import FA5Icon from "react-native-vector-icons/FontAwesome5";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import Video from "react-native-video";
import socket from "../../sockets/Sockets";
import Navbar, { subscribeTabReload, useSwipeToChangeTab } from "../../components/Navbar/Navbar";
import StoryViewer from "../../components/StoryBar/StoryViewer";
import ImageViewerModal from "./ImageViewerModal";
import MemoriesRow from "../../components/Memories/MemoryRow";
import MemoryViewer from "../../components/Memories/MemoryViewer";
import CreateMemoryModal from "../../components/Memories/CreateMemoryModal";
import { ProfileHeaderSkeleton, ProfileGridSkeleton } from "../../components/Skeleton/ProfileSkeleton";
import Config from "react-native-config";
import { carouselTouchProps } from "../../components/carouselTouch";
import { apiFetch } from "../../api/authToken";
import { consumePendingOpenMemory } from "../Activity/ActivityPage";
import { useRefresh, useSwipeTabs } from "../../hooks/useRefreshAndSwipe";

const API = Config.API_URL;

// ── Count formatter (1000 -> 1K, 1500000 -> 1.5M, etc.) ─────────────────────
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

// ── Video grid thumbnail resolver ────────────────────────────────────────
function cloudinaryVideoThumbnail(url) {
  if (!url || typeof url !== "string") return null;
  if (!url.includes("res.cloudinary.com") || !url.includes("/video/upload/")) return null;

  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const before = url.slice(0, idx + marker.length);
  let after = url.slice(idx + marker.length);

  after = after.replace(/\.(mp4|mov|webm|mkv|avi|m4v)(\?.*)?$/i, ".jpg$2");
  if (!/\.jpg(\?.*)?$/i.test(after)) return null;

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

function Profilepage() {
  const navigation = useNavigation();

  const [posts, setPosts] = useState([]);
  const [activeTab, setActiveTab] = useState("posts");

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRequests, setShowRequests] = useState(false);
  const [requests, setRequests] = useState([]);

  const [listModal, setListModal] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [modalList, setModalList] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  const [story, setStory] = useState(null);
  const [showStoryViewer, setShowStoryViewer] = useState(false);
  const hasStory = !!story && story.slides.length > 0;

  const [groups, setGroups] = useState([]);
  const [viewerGroupId, setViewerGroupId] = useState(null);
  const [viewerItemId, setViewerItemId] = useState(null);
  const [viewerSheet, setViewerSheet] = useState(null);
  const [viewerCommentId, setViewerCommentId] = useState(null);
  const [viewerReplyId, setViewerReplyId] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [imageViewerUri, setImageViewerUri] = useState(null);

  const scrollViewRef = useRef(null);
  const itemRefs = useRef({});

  // Screen-wide swipe between the navbar pages (smooth slide + fade)
  const { panHandlers: swipePanHandlers, screenStyle } =
    useSwipeToChangeTab({ capture: false, animateScreen: true });

  // Smooth swipe between Posts / Shorts / Text sub-tabs
  const tabSwipe = useSwipeTabs({ order: PROFILE_TAB_ORDER, activeTab, setActiveTab });

  // ── Restore tab whenever screen regains focus ───────────────────────────
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const remembered = await AsyncStorage.getItem("profileReturnTab");
          if (cancelled) return;
          if (remembered) {
            await AsyncStorage.removeItem("profileReturnTab");
            setActiveTab(remembered);
          } else {
            await AsyncStorage.removeItem("profileReturnPostId");
          }
        } catch (err) {
          console.log("Failed to restore profile tab:", err.message);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  const fetchStory = useCallback(async () => {
    const uid = user?._id || user?.id;
    if (!uid) { setStory(null); return; }
    try {
      const res = await apiFetch(`${API}/stories/get-user-stories/${uid}`);
      const data = await res.json();
      if (!data.success || !data.stories?.length) { setStory(null); return; }
      setStory({
        id: uid.toString(),
        username: user.username || "Unknown",
        userProfile: user.profilePic || "",
        isOwn: true,
        slides: data.stories.map((s) => ({
          id: s._id,
          image: s.media?.url || "",
          type: s.media?.type || s.storyType,
          likes: s.likesCount || 0,
          isLive: s.storyType === "live",
          liveRoomId: s.liveRoomId || null,
          authorId: uid.toString(),
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
  }, [user?._id, user?.id, user?.username, user?.profilePic]);

  useEffect(() => { fetchStory(); }, [fetchStory]);

  const fetchGroups = useCallback(async () => {
    if (!user?._id) { setGroups([]); return; }
    try {
      const res = await apiFetch(`${API}/memories/groups/user/${user._id}`);
      const data = await res.json();
      if (data.success) setGroups(data.groups);
    } catch {
      setGroups([]);
    }
  }, [user?._id]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Pick up the "open this exact memory" handoff from the notifications screen
  useFocusEffect(
    useCallback(() => {
      if (!user?._id) return;
      const pending = consumePendingOpenMemory();
      if (!pending?.groupId || !pending?.itemId) return;
      setViewerGroupId(pending.groupId);
      setViewerItemId(pending.itemId);
      setViewerSheet(pending.sheet || null);
      setViewerCommentId(pending.commentId || null);
      setViewerReplyId(pending.replyId || null);
    }, [user?._id])
  );

  useEffect(() => {
    if (!user?._id) return;
    const myId = user._id.toString();
    const handler = (payload) => {
      const aid = payload?.authorId;
      if (!aid || aid === myId) fetchGroups();
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
  }, [user?._id, fetchGroups]);

  useEffect(() => {
    if (!user?._id) return;
    const myId = user._id.toString();
    const handler = (payload) => {
      const aid = payload?.authorId;
      if (!aid || aid === myId) fetchStory();
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
  }, [user?._id, fetchStory]);

  const fetchPosts = async (userId) => {
    const uid = userId ?? user?._id;
    if (!uid) return;
    try {
      const res = await apiFetch(`${API}/auth/get-posts/${uid}`);
      const data = await res.json();
      if (data.success) setPosts(data.posts);
    } catch (err) {
      console.error("FETCH POSTS ERROR:", err);
    }
  };

  const fetchProfile = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/auth/profile`);
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setRequests(data.user?.followRequests ?? []);
        await fetchPosts(data.user?._id || data.user?.id);
      }
    } catch (err) {
      console.error("PROFILE ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // ── Pull-to-refresh + tap-active-tab refresh (shared) ────────────────────
  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([fetchProfile(), fetchStory(), fetchGroups()])
  );

  useEffect(() => {
    return subscribeTabReload("Profile", () => {
      setActiveTab("posts");
      scrollViewRef.current?.scrollTo?.({ y: 0, animated: true });
      onRefresh();
    });
  }, [onRefresh]);

  // Scroll to the exact post the user tapped when returning
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (loading || !posts.length) return;

      (async () => {
        const targetId = await AsyncStorage.getItem("profileReturnPostId");
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
          AsyncStorage.removeItem("profileReturnPostId");
        }, 80);
      })();

      return () => { cancelled = true; };
    }, [loading, posts])
  );

  // ── Live socket: own profile events ───────────────────────────────────────
  useEffect(() => {
    if (!user?._id) return;
    const myId = user._id.toString();

    socket.emit("joinUserRoom", myId);

    const onFollowersList = ({ userId: uid, followers }) => {
      if (uid !== myId) return;
      setUser(prev => prev ? { ...prev, followers: followers ?? [] } : prev);
      if (listModal === "followers") {
        setModalList(followers ?? []);
        setModalLoading(false);
      }
    };

    const onFollowingList = ({ userId: uid, following }) => {
      if (uid !== myId) return;
      setUser(prev => prev ? { ...prev, following: following ?? [] } : prev);
      if (listModal === "following") {
        setModalList(following ?? []);
        setModalLoading(false);
      }
    };

    const onFollowRequestsList = ({ requests: reqs }) => setRequests(reqs ?? []);

    const onNewFollowRequest = () => {
      socket.emit("getFollowRequests", { userId: myId, viewerId: myId });
    };
    const onFollowRequestResolved = ({ requesterId }) => {
      setRequests(prev => prev.filter(r => (r._id ?? r.id)?.toString() !== requesterId));
    };
    const onNewFollower = ({ fromUserId }) => {
      setUser(prev => {
        if (!prev) return prev;
        const alreadyIn = (prev.followers ?? []).some(f => (f?._id ?? f).toString() === fromUserId);
        if (alreadyIn) return prev;
        return { ...prev, followers: [...(prev.followers ?? []), { _id: fromUserId }] };
      });
    };
    const onUserUnfollowed = ({ fromUserId, toUserId }) => {
      if (toUserId !== myId) return;
      setUser(prev => prev ? {
        ...prev,
        followers: (prev.followers ?? []).filter(f => (f?._id ?? f).toString() !== fromUserId),
      } : prev);
    };
    const onUserFollowed = ({ fromUserId, toUserId }) => {
      if (fromUserId !== myId) return;
      setUser(prev => {
        if (!prev) return prev;
        const alreadyIn = (prev.following ?? []).some(f => (f?._id ?? f).toString() === toUserId);
        if (alreadyIn) return prev;
        return { ...prev, following: [...(prev.following ?? []), { _id: toUserId }] };
      });
    };
    const onIUnfollowed = ({ fromUserId, toUserId }) => {
      if (fromUserId !== myId) return;
      setUser(prev => prev ? {
        ...prev,
        following: (prev.following ?? []).filter(f => (f?._id ?? f).toString() !== toUserId),
      } : prev);
    };
    const onFollowAccepted = ({ from, toUserId }) => {
      if (from !== myId) return;
      setUser(prev => {
        if (!prev) return prev;
        const alreadyIn = (prev.following ?? []).some(f => (f?._id ?? f).toString() === toUserId);
        if (alreadyIn) return prev;
        return { ...prev, following: [...(prev.following ?? []), { _id: toUserId }] };
      });
    };
    const onNewPost = ({ post }) => {
      if ((post?.author?._id ?? post?.author)?.toString() === myId) {
        setPosts(prev => [post, ...prev]);
      }
    };
    const onPostDeleted = ({ postId }) => setPosts(prev => prev.filter(p => p._id !== postId));

    socket.on("followersList", onFollowersList);
    socket.on("followingList", onFollowingList);
    socket.on("followRequestsList", onFollowRequestsList);
    socket.on("newFollowRequest", onNewFollowRequest);
    socket.on("newFollower", onNewFollower);
    socket.on("userUnfollowed", onUserUnfollowed);
    socket.on("userFollowed", onUserFollowed);
    socket.on("userUnfollowed", onIUnfollowed);
    socket.on("followAccepted", onFollowAccepted);
    socket.on("newPost", onNewPost);
    socket.on("postDeleted", onPostDeleted);
    socket.on("followRequestResolved", onFollowRequestResolved);
    socket.emit("getFollowRequests", { userId: myId, viewerId: myId });

    return () => {
      socket.emit("leaveUserRoom", myId);
      socket.off("followersList", onFollowersList);
      socket.off("followingList", onFollowingList);
      socket.off("followRequestsList", onFollowRequestsList);
      socket.off("newFollowRequest", onNewFollowRequest);
      socket.off("newFollower", onNewFollower);
      socket.off("userUnfollowed", onUserUnfollowed);
      socket.off("userFollowed", onUserFollowed);
      socket.off("userUnfollowed", onIUnfollowed);
      socket.off("followAccepted", onFollowAccepted);
      socket.off("newPost", onNewPost);
      socket.off("postDeleted", onPostDeleted);
      socket.off("followRequestResolved", onFollowRequestResolved);
    };
  }, [user?._id, listModal]);

  const openModal = (type) => {
    setSearchQuery("");
    setListModal(type);
    setModalLoading(true);
    setModalList([]);
    const myId = user?._id?.toString();
    if (!myId) return;
    socket.emit(type === "followers" ? "getFollowers" : "getFollowing", { userId: myId, viewerId: myId });
  };

  const closeModal = () => { setListModal(null); setSearchQuery(""); setModalList([]); };
  const filteredList = modalList.filter(u => u.username?.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleAccept = async (requesterId) => {
    try {
      const res = await apiFetch(`${API}/auth/follow/accept/${requesterId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setRequests(prev => prev.filter(r => (r._id ?? r.id)?.toString() !== requesterId));
        setUser(prev => {
          if (!prev) return prev;
          const alreadyIn = (prev.followers ?? []).some(f => (f?._id ?? f).toString() === requesterId);
          if (alreadyIn) return prev;
          return { ...prev, followers: [...(prev.followers ?? []), { _id: requesterId }] };
        });
      }
    } catch (err) { console.error("Accept failed:", err); }
  };

  const handleReject = async (requesterId) => {
    try {
      const res = await apiFetch(`${API}/auth/follow/reject/${requesterId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) setRequests(prev => prev.filter(r => (r._id ?? r.id)?.toString() !== requesterId));
    } catch (err) { console.error("Reject failed:", err); }
  };

  const handleRemoveOrUnfollow = (targetId) => {
    const isFollowers = listModal === "followers";
    Alert.alert(
      isFollowers ? "Remove follower" : "Unfollow user",
      isFollowers ? "Remove this follower?" : "Unfollow this user?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isFollowers ? "Remove" : "Unfollow",
          style: "destructive",
          onPress: async () => {
            try {
              const endpoint = isFollowers
                ? `${API}/auth/remove-follower/${targetId}`
                : `${API}/auth/unfollow/${targetId}`;
              const res = await apiFetch(endpoint, { method: "DELETE" });
              const data = await res.json();
              if (data.success) {
                setModalList(prev => prev.filter(u => u._id?.toString() !== targetId));
                setUser(prev => {
                  if (!prev) return prev;
                  return isFollowers
                    ? { ...prev, followers: (prev.followers ?? []).filter(f => (f?._id ?? f).toString() !== targetId) }
                    : { ...prev, following: (prev.following ?? []).filter(f => (f?._id ?? f).toString() !== targetId) };
                });
              }
            } catch (err) { console.error("Modal action failed:", err); }
          },
        },
      ]
    );
  };

  const handleFollowBack = async (targetId) => {
    try {
      const res = await apiFetch(`${API}/auth/follow/${targetId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setModalList(prev => prev.map(u => u._id?.toString() === targetId ? { ...u, isFollowedBack: true } : u));
        setUser(prev => {
          if (!prev) return prev;
          const alreadyIn = (prev.following ?? []).some(f => (f?._id ?? f).toString() === targetId);
          if (alreadyIn) return prev;
          return { ...prev, following: [...(prev.following ?? []), { _id: targetId }] };
        });
      } else {
        console.error(data.message);
      }
    } catch (err) { console.error("Follow back failed:", err); }
  };

  const isFollowingUser = (targetId) => user?.following?.some(f => (f?._id ?? f).toString() === targetId);

  const isPrivate = user?.isPrivate ?? false;
  const followersCount = user?.followers?.length ?? 0;
  const followingCount = user?.following?.length ?? 0;

  const openCreateGroupModal = () => setCreateModal({ mode: "group" });
  const openAddItemModal = (groupId, groupName) => {
    setViewerGroupId(null);
    setViewerItemId(null);
    setCreateModal({ mode: "item", groupId, groupName });
  };
  const handleGroupCreated = () => fetchGroups();
  const handleItemsAdded = (groupId) => { fetchGroups(); setViewerGroupId(groupId); };
  const handleGroupEmptied = () => {
    setTimeout(() => {
      setViewerGroupId(null);
      setViewerItemId(null);
      setViewerSheet(null);
      setViewerCommentId(null);
      setViewerReplyId(null);
      fetchGroups();
    }, 0);
  };
  const closeViewer = () => {
    setTimeout(() => {
      setViewerGroupId(null);
      setViewerItemId(null);
      setViewerSheet(null);
      setViewerCommentId(null);
      setViewerReplyId(null);
    }, 0);
  };
  const switchToGroup = (nextGroupId) => {
    setTimeout(() => {
      setViewerGroupId(nextGroupId);
      setViewerItemId(null);
    }, 0);
  };

  const pickImages = async () => {
    const result = await launchImageLibrary({ mediaType: "photo", selectionLimit: 0 });
    if (result.didCancel || !result.assets?.length) return;
    navigation.navigate("EditImage", {
      images: result.assets.map((a) => a.uri),
      files: result.assets,
    });
  };

  const pickVideo = async () => {
    const result = await launchImageLibrary({ mediaType: "video" });
    if (result.didCancel || !result.assets?.length) return;
    navigation.navigate("CreateVideo", { file: result.assets[0] });
  };

  if (loading) {
    return (
      <Animated.View style={[styles.container, screenStyle]} {...swipePanHandlers}>
        <ProfileHeaderSkeleton />
        <ProfileGridSkeleton />
        <Navbar />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.container, screenStyle]} {...swipePanHandlers}>

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
              <TextInput
                placeholder="Search"
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={searchInputStyle}
              />
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
              ) : (
                filteredList.map((u) => {
                  const targetId = u._id?.toString();
                  const alreadyFollow = u.isFollowedBack || isFollowingUser(targetId);
                  return (
                    <View key={u._id ?? u.id} style={userRowStyle}>
                      {u.profilePic
                        ? <Image source={{ uri: u.profilePic }} style={userAvatarStyle} />
                        : <View style={[userAvatarStyle, avatarFallbackStyle]}>
                            <Text style={{ fontWeight: "700", color: "#888" }}>{u.username?.[0]?.toUpperCase()}</Text>
                          </View>
                      }
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => { closeModal(); if (targetId === user?._id?.toString()) { /* already on own Profile tab */ } else { navigation.navigate("UserProfile", { userId: u._id }); } }}>
                        <Text style={{ fontSize: 14, fontWeight: "500" }}>{u.username}</Text>
                      </TouchableOpacity>
                      {listModal === "followers" && (
                        alreadyFollow
                          ? <View style={followingBadgeStyle}><Text style={{ color: "#555", fontSize: 12 }}>Following</Text></View>
                          : <TouchableOpacity style={followBackBtnStyle} onPress={() => handleFollowBack(targetId)}>
                              <Text style={{ color: "#fff", fontSize: 12 }}>Follow Back</Text>
                            </TouchableOpacity>
                      )}
                      <TouchableOpacity style={actionBtnStyle} onPress={() => handleRemoveOrUnfollow(targetId)}>
                        <Text style={{ fontSize: 12 }}>{listModal === "followers" ? "Remove" : "Unfollow"}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="rgb(234,182,118)"
            colors={["rgb(234,182,118)"]}
          />
        }
      >

        {/* ── Top Bar ── */}
        <View style={styles.topBar}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 17, fontWeight: "800" }}>{user?.username}</Text>
            {isPrivate && <FA5Icon name="lock" size={12} color="#888" />}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            {isPrivate && (
              <TouchableOpacity onPress={() => setShowRequests(p => !p)} style={{ position: "relative" }}>
                <FeatherIcon name="bell" size={22} />
                {requests.length > 0 && (
                  <View style={styles.badge}><Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{formatCount(requests.length)}</Text></View>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => navigation.navigate("Settings")}>
              <FeatherIcon name="settings" size={22} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Follow Requests Dropdown ── */}
        {showRequests && isPrivate && (
          <View style={styles.requestsDropdown}>
            <Text style={{ fontSize: 15, fontWeight: "700", borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 8, marginBottom: 10 }}>
              Follow Requests
            </Text>
            {requests.length === 0 ? (
              <Text style={{ textAlign: "center", color: "gray", fontSize: 14 }}>No pending requests</Text>
            ) : (
              requests.map((req) => {
                const id = (req._id ?? req.id)?.toString();
                return (
                  <View key={id} style={styles.requestRow}>
                    {req.profilePic
                      ? <Image source={{ uri: req.profilePic }} style={{ width: 38, height: 38, borderRadius: 19 }} />
                      : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#ddd", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontWeight: "700", color: "#888" }}>{req.username?.[0]?.toUpperCase()}</Text>
                        </View>
                    }
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: "500" }}>{req.username}</Text>
                    <TouchableOpacity onPress={() => handleAccept(id)} style={styles.acceptBtn}><Text style={{ color: "#fff", fontSize: 12 }}>Accept</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleReject(id)} style={styles.declineBtn}><Text style={{ fontSize: 12 }}>Decline</Text></TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ── Cover ── */}
        <View style={styles.coverContainer}>
          {user?.coverPic
            ? (
              <TouchableOpacity activeOpacity={0.9} style={{ width: "100%", height: "100%" }} onPress={() => setImageViewerUri(user.coverPic)}>
                <Image source={{ uri: user.coverPic }} style={styles.cover} />
              </TouchableOpacity>
            )
            : <View style={styles.coverFallback} />
          }
        </View>

        {/* ── Profile Section ── */}
        <View style={styles.profileSection}>
          {hasStory ? (
            // Story exists: tap = open story, long press = view profile photo
            <TouchableOpacity
              onPress={() => setShowStoryViewer(true)}
              onLongPress={() => user?.profilePic && setImageViewerUri(user.profilePic)}
              delayLongPress={350}
              style={ownProfileRingWrap}
            >
              <View style={ownProfileRingInner}>
                {user?.profilePic
                  ? <Image source={{ uri: user.profilePic }} style={ownProfileImgNoBorder} />
                  : <View style={ownProfileImgFallbackNoBorder}><Text style={{ fontSize: 32, fontWeight: "700", color: "#fff" }}>{user?.username?.[0]?.toUpperCase()}</Text></View>
                }
              </View>
            </TouchableOpacity>
          ) : (
            user?.profilePic
              ? (
                <TouchableOpacity activeOpacity={0.9} onPress={() => setImageViewerUri(user.profilePic)}>
                  <Image source={{ uri: user.profilePic }} style={styles.profileImg} />
                </TouchableOpacity>
              )
              : <View style={styles.profileImgFallback}><Text style={{ fontSize: 32, fontWeight: "700", color: "#fff" }}>{user?.username?.[0]?.toUpperCase()}</Text></View>
          )}
          <View style={styles.profileInfo}>
            <Text style={styles.username}>{user?.username}</Text>
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{formatCount(posts.length)}</Text>
                <Text style={styles.statLabel}>posts</Text>
              </View>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statItem} onPress={() => openModal("followers")}>
                <Text style={styles.statNum}>{formatCount(followersCount)}</Text>
                <Text style={styles.statLabel}>followers</Text>
              </TouchableOpacity>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statItem} onPress={() => openModal("following")}>
                <Text style={styles.statNum}>{formatCount(followingCount)}</Text>
                <Text style={styles.statLabel}>following</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Bio ── */}
        {!!user?.bio && <Text style={styles.bio}>{user.bio}</Text>}

        {/* ── Action Boxes ── */}
        <View style={styles.actionsWrap}>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBox} onPress={pickImages}>
              <View style={styles.actionIcon}><FeatherIcon name="image" size={18} color="#fff" /></View>
              <Text style={styles.actionLabel}>+ Image</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBox} onPress={pickVideo}>
              <View style={[styles.actionIcon, { backgroundColor: "#f5576c" }]}><FeatherIcon name="video" size={18} color="#fff" /></View>
              <Text style={styles.actionLabel}>+ Shorts</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBox} onPress={() => navigation.navigate("CreateText")}>
              <View style={[styles.actionIcon, { backgroundColor: "#4facfe" }]}><FeatherIcon name="edit" size={18} color="#fff" /></View>
              <Text style={styles.actionLabel}>+ Text</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBox} onPress={() => navigation.navigate("Saved")}>
              <View style={[styles.actionIcon, { backgroundColor: "#fda085" }]}><FeatherIcon name="bookmark" size={18} color="#fff" /></View>
              <Text style={styles.actionLabel}>Saves</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Edit Profile Button ── */}
        <TouchableOpacity onPress={() => navigation.navigate("EditProfile")} style={styles.editBtn}>
          <FA5Icon name="user-edit" size={15} />
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#111" }}>Edit Profile</Text>
        </TouchableOpacity>

        {/* ── Memories ("Highlights") ── */}
        <MemoriesRow
          groups={groups}
          showAdd
          onAdd={openCreateGroupModal}
          onOpenGroup={(groupId) => { setViewerGroupId(groupId); setViewerItemId(null); setViewerSheet(null); setViewerCommentId(null); setViewerReplyId(null); }}
        />

        {/* ── Tabs ── */}
        <View style={styles.tabs}>
          {["posts", "Shorts", "text"].map((tab) => (
            <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)}>
              <Text style={activeTab === tab ? styles.activeTab : styles.inactiveTab}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Tab content: slides with your finger ── */}
        <View style={{ overflow: "hidden" }} {...tabSwipe.panHandlers}>
          <Animated.View style={{ padding: 10, transform: [{ translateX: tabSwipe.x }] }}>
            {activeTab === "posts" && <Posts posts={posts} navigation={navigation} itemRefs={itemRefs} />}
            {activeTab === "Shorts" && <Shorts posts={posts} userId={user?._id} navigation={navigation} itemRefs={itemRefs} />}
            {activeTab === "text" && <TextPosts posts={posts} navigation={navigation} itemRefs={itemRefs} />}
          </Animated.View>
        </View>
      </ScrollView>

      {showStoryViewer && hasStory && (
        <StoryViewer stories={[story]} index={0} close={() => setShowStoryViewer(false)} />
      )}

      <ImageViewerModal
        visible={!!imageViewerUri}
        uri={imageViewerUri}
        onClose={() => setImageViewerUri(null)}
      />

      {viewerGroupId && (
        <MemoryViewer
          groupId={viewerGroupId}
          groupIds={groups.map((g) => g._id)}
          onSwitchGroup={switchToGroup}
          isOwner
          initialItemId={viewerItemId}
          initialSheet={viewerSheet}
          initialCommentId={viewerCommentId}
          initialReplyId={viewerReplyId}
          onClose={closeViewer}
          onGroupEmptied={handleGroupEmptied}
          onItemDeleted={() => fetchGroups()}
          onRequestAddItem={openAddItemModal}
        />
      )}

      {createModal && (
        <CreateMemoryModal
          mode={createModal.mode}
          groupId={createModal.groupId}
          groupName={createModal.groupName}
          onClose={() => setCreateModal(null)}
          onGroupCreated={handleGroupCreated}
          onItemsAdded={() => handleItemsAdded(createModal.groupId)}
        />
      )}

      {!showStoryViewer && !viewerGroupId && <Navbar />}
    </Animated.View>
  );
}

export default Profilepage;

// ── Sub-components ─────────────────────────────────────────────────────────
const Posts = ({ posts, navigation, itemRefs }) => {
  const imagePosts = posts.filter(p => p?.postType === "image" || p?.postType === "carousel");
  if (!imagePosts.length)
    return <Text style={{ textAlign: "center", padding: 30, color: "gray" }}>No posts yet</Text>;
  return (
    <View style={styles.grid}>
      {imagePosts.map((post) => (
        <TouchableOpacity
          key={post._id}
          ref={(el) => { itemRefs.current[post._id] = el; }}
          style={styles.gridCell}
          onPress={async () => {
            await AsyncStorage.setItem("profileReturnTab", "posts");
            await AsyncStorage.setItem("profileReturnPostId", post._id);
            navigation.navigate("PostDetail", { post, allPosts: imagePosts });
          }}>
          <Image source={{ uri: post?.media?.[0]?.url || "https://via.placeholder.com/300" }} style={styles.postImg} />
        </TouchableOpacity>
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
            await AsyncStorage.setItem("profileReturnTab", "Shorts");
            await AsyncStorage.setItem("profileReturnPostId", video._id);
            navigation.navigate("ProfileReel", { video, allVideos: videoPosts, ownerUserId: userId });
          }}>
          <VideoGridThumb video={video} style={styles.postImg} />
          <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.15)" }}>
            <Text style={{ color: "#fff", fontSize: 20 }}>▶</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
};

const ExpandableProfileText = ({ text, limit = 180 }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text style={profileTextStyle}>
        {text}
        {isLong && (
          <Text onPress={() => setExpanded(false)} style={moreLessStyle}> less</Text>
        )}
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

const TextPosts = ({ posts, navigation, itemRefs }) => {
  const textPosts = posts.filter(p => p?.postType === "text");
  if (!textPosts.length)
    return <Text style={{ textAlign: "center", padding: 20, color: "gray" }}>No text posts yet 📝</Text>;
  return (
    <View style={{ gap: 12 }}>
      {textPosts.map((post) => (
        <TouchableOpacity
          key={post._id}
          ref={(el) => { itemRefs.current[post._id] = el; }}
          style={styles.textCard}
          onPress={async () => {
            await AsyncStorage.setItem("profileReturnTab", "text");
            await AsyncStorage.setItem("profileReturnPostId", post._id);
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
            <ScrollView
              horizontal
              nestedScrollEnabled
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              style={{ paddingHorizontal: 12, paddingBottom: 12 }}
              {...carouselTouchProps}
            >
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
const GRID_GAP = 4;

const styles = StyleSheet.create({
  container: { flex: 1, maxWidth: 420, width: "100%", alignSelf: "center", backgroundColor: "#fff" },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingBottom: 8 },
  badge: { position: "absolute", top: -4, right: -4, backgroundColor: "red", borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
  requestsDropdown: { position: "absolute", top: 52, right: 10, width: 300, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, zIndex: 999, elevation: 6 },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  acceptBtn: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#0095f6", borderRadius: 6 },
  declineBtn: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#f0f0f0", borderRadius: 6 },
  coverContainer: { width: "100%", paddingHorizontal: 18, height: 180 },
  cover: { width: "100%", height: "100%", borderRadius: 18 },
  coverFallback: { width: "100%", height: "100%", borderRadius: 18, backgroundColor: "#d5d5d5" },
  profileSection: { flexDirection: "row", alignItems: "center", padding: 18, paddingTop: 16, paddingBottom: 6, gap: 16 },
  profileImg: { width: 90, height: 90, borderRadius: 45, borderWidth: 4, borderColor: "#fff" },
  profileImgFallback: { width: 90, height: 90, borderRadius: 45, backgroundColor: "#b0b0b0", alignItems: "center", justifyContent: "center" },
  profileInfo: { flexDirection: "column" },
  username: { fontSize: 18, fontWeight: "800", color: "#111", marginBottom: 8 },
  stats: { flexDirection: "row", alignItems: "center", gap: 16 },
  statDivider: { width: 1, height: 26, backgroundColor: "#eee" },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 16, fontWeight: "700", color: "#111" },
  statLabel: { fontSize: 11, color: "#888", marginTop: 1 },
  bio: { fontSize: 14, fontWeight: "500", color: "#444", marginHorizontal: 18, marginTop: 10, lineHeight: 20 },
  actionsWrap: { paddingHorizontal: 18, paddingTop: 16 },
  actions: { flexDirection: "row", justifyContent: "space-around", backgroundColor: "#fafafa", borderWidth: 1, borderColor: "#f0f0f0", borderRadius: 18, paddingVertical: 14 },
  actionBox: { alignItems: "center", width: 68 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#667eea", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  actionLabel: { fontSize: 11, fontWeight: "600", color: "#444" },
  editBtn: { marginHorizontal: 18, marginTop: 14, marginBottom: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 11, borderWidth: 1.5, borderColor: "#e2e2e2", borderRadius: 14, backgroundColor: "#fff" },
  tabs: { flexDirection: "row", justifyContent: "space-around", marginTop: 14, borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 12 },
  activeTab: { fontWeight: "700", borderBottomWidth: 2, borderBottomColor: "#111", paddingBottom: 10, color: "#111" },
  inactiveTab: { color: "#aaa", paddingBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  gridCell: { width: `${100 / 3}%`, aspectRatio: 1, padding: GRID_GAP / 2, position: "relative" },
  postImg: { width: "100%", height: "100%", borderRadius: 6 },
  textCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
});

const modalOverlayStyle = { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" };
const modalBoxStyle = { backgroundColor: "#fff", borderRadius: 12, width: "90%", maxWidth: 380, maxHeight: "70%", padding: 16 };
const searchWrapperStyle = { flexDirection: "row", alignItems: "center", backgroundColor: "#f0f0f0", borderRadius: 10, marginBottom: 12 };
const searchInputStyle = { flex: 1, padding: 9, fontSize: 14 };
const userRowStyle = { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" };
const userAvatarStyle = { width: 42, height: 42, borderRadius: 21 };
const avatarFallbackStyle = { backgroundColor: "#ddd", alignItems: "center", justifyContent: "center" };
const followBackBtnStyle = { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#0095f6", borderRadius: 6 };
const followingBadgeStyle = { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#f0f0f0", borderRadius: 6 };
const actionBtnStyle = { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#f0f0f0", borderRadius: 6 };

const profileTextStyle = { paddingHorizontal: 12, paddingBottom: 10, fontSize: 15, lineHeight: 22, color: "#222" };
const moreLessStyle = { color: "#8e8e8e", fontWeight: "700" };

const ownProfileRingWrap = { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgb(234,182,118)", alignItems: "center", justifyContent: "center", padding: 3 };
const ownProfileRingInner = { width: "100%", height: "100%", borderRadius: 48, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 2 };
const ownProfileImgNoBorder = { width: 84, height: 84, borderRadius: 42 };
const ownProfileImgFallbackNoBorder = { width: 84, height: 84, borderRadius: 42, backgroundColor: "#b0b0b0", alignItems: "center", justifyContent: "center" };