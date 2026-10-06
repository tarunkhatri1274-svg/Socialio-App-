import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  DeviceEventEmitter,
  findNodeHandle,
  FlatList,
  PanResponder,
} from "react-native";
import Video from "react-native-video";
import FeatherIcon from "react-native-vector-icons/Feather";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { toggleSavedPost } from "../../components/State/SavedPostStore";
// ── Tab order used for horizontal swipe navigation ──────────────────────────
const SAVED_TAB_ORDER = ["posts", "videos", "texts"];
const SWIPE_HORIZONTAL_THRESHOLD = 12; // px moved before we commit to a horizontal gesture
const SWIPE_DIRECTION_RATIO = 2;       // how much more horizontal than vertical movement is required
const SWIPE_RELEASE_THRESHOLD = 50;    // px needed on release to actually change tabs

function SavedPage() {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState("posts");
  const [savedPosts, setSavedPosts] = useState([]);
  const [savedVideos, setSavedVideos] = useState([]);
  const [savedTexts, setSavedTexts] = useState([]);

  const scrollViewRef = useRef(null);
  // id -> node ref, registered by each grid cell / text card as it renders
  const itemRefs = useRef({});

  // ── Swipe left/right on the tab content to move to the next/previous tab.
  // Only claims the gesture once the drag is clearly more horizontal than
  // vertical, so the vertical scroll of the grid/list keeps working normally.
  const goToAdjacentTab = useCallback((direction) => {
    setActiveTab((current) => {
      const idx = SAVED_TAB_ORDER.indexOf(current);
      if (idx === -1) return current;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= SAVED_TAB_ORDER.length) return current;
      return SAVED_TAB_ORDER[nextIdx];
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

  const loadFromStorage = useCallback(async () => {
    try {
      const rawPosts = await AsyncStorage.getItem("savedPosts");
      const rawVideos = await AsyncStorage.getItem("savedVideos");
      const all = rawPosts ? JSON.parse(rawPosts) : [];
      setSavedPosts(all.filter((p) => p.postType === "image" || p.postType === "carousel"));
      setSavedTexts(all.filter((p) => p.postType === "text"));
      setSavedVideos(rawVideos ? JSON.parse(rawVideos) : []);
    } catch (err) {
      console.log("Failed to load saved items:", err.message);
    }
  }, []);

  useEffect(() => {
    loadFromStorage(); // always fresh on mount

    const savedSub = DeviceEventEmitter.addListener("postSaved", ({ post }) => {
      if (!post) return;
      if (post.postType === "text") {
        setSavedTexts((prev) => (prev.some((t) => t._id === post._id) ? prev : [...prev, post]));
      } else if (post.postType === "video") {
        setSavedVideos((prev) => (prev.some((v) => v._id === post._id) ? prev : [...prev, post]));
      } else {
        setSavedPosts((prev) => (prev.some((p) => p._id === post._id) ? prev : [...prev, post]));
      }
    });

    const unsavedSub = DeviceEventEmitter.addListener("postUnsaved", ({ postId, postType }) => {
      if (postType === "text") {
        setSavedTexts((prev) => prev.filter((t) => t._id !== postId));
      } else if (postType === "video") {
        setSavedVideos((prev) => prev.filter((v) => v._id !== postId));
      } else {
        setSavedPosts((prev) => prev.filter((p) => p._id !== postId));
      }
    });

    return () => {
      savedSub.remove();
      unsavedSub.remove();
    };
  }, [loadFromStorage]);

  // ── Restore tab + scroll-target id whenever this screen regains focus —
  // covers both "screen was popped back to" (still mounted underneath) and
  // "screen was actually remounted" cases, unlike a mount-only effect.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const remembered = await AsyncStorage.getItem("savedPageReturnTab");
          if (cancelled) return;
          if (remembered) {
            await AsyncStorage.removeItem("savedPageReturnTab");
            setActiveTab(remembered);
          } else {
            await AsyncStorage.removeItem("savedPageReturnPostId");
          }
        } catch (err) {
          console.log("Failed to restore saved tab:", err.message);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // ── Scroll to the exact saved item once its list has data. Runs after
  // activeTab and the relevant list settle, and whenever the screen
  // regains focus (in case data was still loading the first time).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const list =
        activeTab === "posts"  ? savedPosts  :
        activeTab === "videos" ? savedVideos :
        savedTexts;

      (async () => {
        const targetId = await AsyncStorage.getItem("savedPageReturnPostId");
        if (cancelled || !targetId || !list.length) return;

        // give the list a beat to actually lay out before measuring
        setTimeout(() => {
          if (cancelled) return;
          const target = itemRefs.current[targetId];
          const scrollView = scrollViewRef.current;
          // Fabric needs a real ref here, not a findNodeHandle() number.
          const inner = scrollView?.getInnerViewRef?.();
          if (target?.measureLayout && inner) {
            target.measureLayout(
              inner,
              (x, y) => {
                scrollView.scrollTo({ y: Math.max(y - 20, 0), animated: false });
              },
              () => {}
            );
          }
          AsyncStorage.removeItem("savedPageReturnPostId");
        }, 80);
      })();

      return () => { cancelled = true; };
    }, [activeTab, savedPosts, savedVideos, savedTexts])
  );

  const tabs = [
    { key: "posts", icon: "grid", label: "Posts" },
    { key: "videos", icon: "video", label: "Videos" },
    { key: "texts", icon: "file-text", label: "Text" },
  ];
const handleUnsave = (post) => {
  // Goes through the store: updates the cache, AsyncStorage, notifies
  // subscribers (Home bookmark icons) and emits "postUnsaved".
  toggleSavedPost(post);
};

  const goToPost = async (post, allPosts) => {
    await AsyncStorage.setItem("savedPageReturnTab", "posts");
    await AsyncStorage.setItem("savedPageReturnPostId", post._id);
    navigation.navigate("PostDetail", { post, allPosts });
  };

  const goToVideo = async (video, allVideos) => {
    await AsyncStorage.setItem("savedPageReturnTab", "videos");
    await AsyncStorage.setItem("savedPageReturnPostId", video._id);
    navigation.navigate("ProfileReel", {
      video,
      allVideos,
      ownerUserId: video?.author?._id || video?.author,
    });
  };

  const goToText = async (post, allPosts) => {
    await AsyncStorage.setItem("savedPageReturnTab", "texts");
    await AsyncStorage.setItem("savedPageReturnPostId", post._id);
    navigation.navigate("TextPost", { post, allPosts });
  };

  return (
    <View style={styles.screen}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <FeatherIcon name="arrow-left" size={22} color="#111" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Saved</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
            >
              <FeatherIcon name={tab.icon} size={20} color={active ? "#000" : "#aaa"} />
              <Text style={[styles.tabLabel, { color: active ? "#000" : "#aaa", fontWeight: active ? "600" : "400" }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <View style={{ flex: 1 }} {...tabPanResponder.panHandlers}>
        <ScrollView ref={scrollViewRef} style={{ flex: 1 }}>
          {activeTab === "posts" && (
            <PostsGrid posts={savedPosts} onPress={goToPost} onUnsave={handleUnsave} itemRefs={itemRefs} />
          )}
          {activeTab === "videos" && (
            <VideosGrid videos={savedVideos} onPress={goToVideo} onUnsave={handleUnsave} itemRefs={itemRefs} />
          )}
          {activeTab === "texts" && (
            <TextList texts={savedTexts} onPress={goToText} onUnsave={handleUnsave} itemRefs={itemRefs} />
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/* ── Posts Grid ── */
function PostsGrid({ posts, onPress, onUnsave, itemRefs }) {
  if (posts.length === 0) return <Empty message="No saved posts yet 📌" />;
  return (
    <View style={styles.grid}>
      {posts.map((post) => (
        <View
          key={post._id}
          ref={(el) => { itemRefs.current[post._id] = el; }}
          style={styles.gridCell}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => onPress(post, posts)}
          >
            <Image source={{ uri: post?.media?.[0]?.url }} style={styles.gridImage} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onUnsave(post)} style={styles.unsaveBtn}>
            <Text style={styles.unsaveBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

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
      source={{ uri: video?.media?.[0]?.url || video?.url }}
      style={style}
      muted
      paused
      resizeMode="cover"
      useTextureView
    />
  );
}

/* ── Videos Grid ── */
function VideosGrid({ videos, onPress, onUnsave, itemRefs }) {
  if (videos.length === 0) return <Empty message="No saved videos yet 🎥" />;
  return (
    <View style={styles.grid}>
      {videos.map((video) => (
        <View
          key={video._id}
          ref={(el) => { itemRefs.current[video._id] = el; }}
          style={styles.gridCell}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            style={{ flex: 1 }}
            onPress={() => onPress(video, videos)}
          >
            <VideoGridThumb video={video} style={styles.gridImage} />
            <View style={styles.videoOverlay} pointerEvents="none">
              <FeatherIcon name="play" size={22} color="#fff" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onUnsave(video)}
            style={[styles.unsaveBtn, { width: 26, height: 26 }]}
          >
            <Text style={[styles.unsaveBtnText, { fontSize: 13 }]}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

/* ── Text List ── */
function TextList({ texts, onPress, onUnsave, itemRefs }) {
  if (texts.length === 0) return <Empty message="No saved text posts yet 📝" />;
  return (
    <View style={{ padding: 12, gap: 12 }}>
      {texts.map((post) => (
        <View key={post._id} ref={(el) => { itemRefs.current[post._id] = el; }}>
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.textCard}
          onPress={() => onPress(post, texts)}
        >
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation?.();
              onUnsave(post);
            }}
            style={[styles.unsaveBtn, { top: 10, right: 10, width: 26, height: 26 }]}
          >
            <Text style={[styles.unsaveBtnText, { fontSize: 13 }]}>✕</Text>
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.textCardHeader}>
            {post?.author?.profilePic ? (
              <Image source={{ uri: post.author.profilePic }} style={styles.textCardAvatar} />
            ) : (
              <View style={[styles.textCardAvatar, styles.textCardAvatarFallback]}>
                <Text style={{ fontWeight: "700", color: "#fff", fontSize: 14 }}>
                  {(post?.author?.username || post?.username || "U")[0].toUpperCase()}
                </Text>
              </View>
            )}
            <View>
              <Text style={{ fontWeight: "600", fontSize: 14 }}>{post?.author?.username || post?.username}</Text>
              {!!post?.createdAt && (
                <Text style={{ fontSize: 11, color: "#aaa" }}>
                  {new Date(post.createdAt).toLocaleDateString()}
                </Text>
              )}
            </View>
          </View>

          {!!post?.text && <Text style={styles.textCardBody}>{post.text}</Text>}

          {post?.media?.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
              {post.media.map((m, i) => (
                <Image
                  key={i}
                  source={{ uri: m.url }}
                  style={{
                    width: post.media.length === 1 ? 260 : 160,
                    height: 160,
                    borderRadius: 10,
                    marginRight: 6,
                  }}
                />
              ))}
            </ScrollView>
          )}
        </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

/* ── Empty ── */
function Empty({ message }) {
  return (
    <Text style={styles.emptyText}>{message}</Text>
  );
}

export default SavedPage;

/* ── Styles ── */
const GRID_GAP = 3;

const styles = StyleSheet.create({
  screen: { flex: 1, maxWidth: 480, width: "100%", alignSelf: "center", backgroundColor: "#fff" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  topBarTitle: { fontSize: 16, fontWeight: "600" },
  tabsRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eee" },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: "#000" },
  tabLabel: { fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: GRID_GAP },
  gridCell: {
    width: `${100 / 3}%`,
    aspectRatio: 1,
    padding: GRID_GAP / 2,
    position: "relative",
  },
  gridImage: { width: "100%", height: "100%", borderRadius: 0 },
  videoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  unsaveBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  unsaveBtnText: { color: "#fff", fontSize: 14 },
  textCard: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 14,
    backgroundColor: "#fff",
    overflow: "hidden",
    position: "relative",
  },
  textCardHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingBottom: 8 },
  textCardAvatar: { width: 36, height: 36, borderRadius: 18 },
  textCardAvatarFallback: { backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },
  textCardBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#222",
  },
  emptyText: { textAlign: "center", padding: 60, color: "#aaa", fontSize: 14 },
});