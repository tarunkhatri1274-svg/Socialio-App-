import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, FlatList, Dimensions, StyleSheet } from "react-native";

import Config from "react-native-config";
import Videopost from "../../components/PostCard/Video";
import Navbar, { setCommentsOpen, subscribeTabReload, useSwipeToChangeTab } from "../../components/Navbar/Navbar";
import socket from "../../sockets/Sockets";
import { useRoute } from "@react-navigation/native";
// Same hoist-to-parent pattern used in ExploreReels: fetch the real
// following list ONCE here and pass it down as a prop, instead of
// letting every mounted <Videopost /> in this scroll list each fire its
// own /auth/profile request. VideoPost.js accepts myFollowingIds/
// onFollowChange as optional props and only falls back to its own
// internal fetch when a parent doesn't supply them.
import { useFollowStore, initFollowStore, addFollowing, removeFollowing } from "../../pages/Profile/UseFollowState";
import { apiFetch, getCachedUser, updateCachedUser, useAuth } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL;
const SCREEN_HEIGHT = Dimensions.get("window").height;

function VideoPage() {
  const [videos, setVideos] = useState([]);
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [visibleVideoIds, setVisibleVideoIds] = useState(() => new Set());
const [myId, setMyId] = useState(null);
  // NEW: tracks whether any sheet (likers/viewers/comments/share/collab/
  // story preview) is currently open in the visible Videopost card, fed
  // by Videopost's existing onSheetOpen callback. Drives the Navbar's
  // zIndex/elevation below — while a sheet is open the Navbar drops to
  // zIndex -1 (behind everything) and comes back to its normal stacking
  // once every sheet closes again. This is on top of (not a replacement
  // for) the existing setCommentsOpen(...) pub/sub call, in case Navbar
  // itself does something else with that signal.
  const [sheetOpen, setSheetOpen] = useState(false);

  // NEW — screen-wide swipe to switch tabs (bubble-phase, so it never
  // steals the vertical drag from the reels FlatList below: the list
  // claims a touch that starts as a vertical pan itself, and only a
  // clearly-horizontal drag that nothing else claimed reaches this).
  const { panHandlers: swipePanHandlers } = useSwipeToChangeTab({ capture: false });

  const route = useRoute();
  const hasNavbar = route.params?.hasNavbar ?? true;

  // myFollowingIds kept in sync with the server, fetched once for this
  // whole page instead of once per video card.
  const { followingIds: myFollowingIds } = useFollowStore();
  const { user: authUser, refreshAuth } = useAuth();

  // FIX: this used to be `useFocusEffect(() => setFocusKey(k => k+1))`
  // paired with `key={focusKey}` on the FlatList below — that forced a
  // full remount of the whole list (resetting scroll back to the very
  // first video) EVERY time this screen regained focus, even from just
  // tapping into a profile and coming back. That's the opposite of the
  // desired behavior: like Instagram, returning to a tab should leave
  // you exactly where you left off, and only reload when you explicitly
  // ask for it. `focusKey` now only changes from the tab-reload
  // subscription below (fired when the user re-taps the already-active
  // VideoPage tab), and a ref lets that same handler scroll to top too.
  const [focusKey, setFocusKey] = useState(0);
  const videoListRef = useRef(null);

useEffect(() => {
  (async () => {
    try {
      const res = await apiFetch(`${API}/auth/profile`);
      const data = await res.json();
      if (!data?.user) return;
      await updateCachedUser(data.user);
      refreshAuth();
      setMyId((data.user._id || data.user.id)?.toString());
      const followingIds = (data.user.following || []).map((f) => (f?._id ?? f).toString());
      initFollowStore(followingIds);
    } catch (err) {
      console.error("FETCH PROFILE ERROR:", err);
    }
    fetchVideos();
    fetchBlocked();
  })();
}, []);

  const handleFollowChange = useCallback((authorId, followed) => {
    if (followed) addFollowing(authorId);
    else removeFollowing(authorId);
  }, []);

const fetchBlocked = useCallback(async () => {
  try {
    const res = await apiFetch(`${API}/auth/blocked-users`);
    const data = await res.json();
    if (data.success) {
      const ids = (data.blockedUsers || []).map((u) => (u?._id ?? u).toString());
      setBlockedIds(new Set(ids));
    }
  } catch (err) {
    console.error("FETCH BLOCKED USERS ERROR:", err);
  }
}, []);

  const fetchVideos = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/auth/public-reels`);
      const data = await res.json();
      if (data.success) setVideos(data.reels);
    } catch (err) {
      console.error("FETCH REELS ERROR:", err);
    }
  }, []);



  // NEW — tapping the already-active "VideoPage" (Shorts/Reels) tab
  // reloads this screen: scrolls back to the first video and refetches.
  // This is the ONLY thing that resets scroll/remounts the list now —
  // ordinary focus (swiping back from a profile, etc.) leaves everything
  // exactly as you left it.
  useEffect(() => {
    return subscribeTabReload("VideoPage", () => {
      videoListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
      setFocusKey((k) => k + 1);
      fetchVideos();
    });
  }, [fetchVideos]);

  // Live privacy toggling, same as Home/Explore/ExploreReels: patches
  // author.isPrivate on any matching video already sitting in `videos`.
  // Combined with the visibleVideos filter below, this makes a video
  // disappear from Shorts the instant its author goes private (if you
  // don't follow them) — no reload needed.
  useEffect(() => {
    const patchPrivacy = (list, userId, isPrivate) =>
      list.map((v) => {
        const vAuthorId = v.author?._id ? v.author._id.toString() : v.author?.toString();
        if (vAuthorId !== userId.toString()) return v;
        return {
          ...v,
          author: { ...(v.author?._id ? v.author : { _id: v.author }), isPrivate },
        };
      });

    const handler = ({ userId, isPrivate }) => {
      setVideos((prev) => patchPrivacy(prev, userId, isPrivate));
    };

    socket.on("privacyChanged", handler);
    return () => socket.off("privacyChanged", handler);
  }, []);

  const handleBlock = useCallback((blockedAuthorId) => {
    setBlockedIds((prev) => new Set([...prev, blockedAuthorId]));
    setVideos((prev) =>
      prev.filter((v) => {
        const vid_authorId = (v?.author?._id ?? v?.author)?.toString();
        return vid_authorId !== blockedAuthorId;
      })
    );
  }, []);

  const myIdForFilter = (authUser?._id || authUser?.id)?.toString();

  const visibleVideos = videos.filter((v) => {
    const vid_authorId = (v?.author?._id ?? v?.author)?.toString();
    if (blockedIds.has(vid_authorId)) return false;
    if (vid_authorId === myIdForFilter) return true;
    if (v?.author?.isPrivate && !myFollowingIds.includes(vid_authorId)) return false;
    return true;
  });

  // Viewability tracking replaces the web version's scroll-snap-driven
  // "one video visible at a time" behavior — drives each Videopost's
  // isVisible prop for autoplay/pause, same pattern as Homepage.js's
  // VideoFeedCard.
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const ids = new Set(viewableItems.map((v) => v.item._id));
    setVisibleVideoIds(ids);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // Fires for likers/comments/share/views/collaborators — mirrors the
  // pub/sub Navbar already subscribes to (see Navbar.js's
  // setCommentsOpen/subscribeCommentsOpen). Now ALSO drives local
  // `sheetOpen` state, which controls the Navbar wrapper's zIndex/
  // elevation directly below — sheets (rendered as Modals, which are
  // already a separate native layer) always draw above the app content
  // regardless, but this makes the layering explicit and defensive:
  // Navbar -> zIndex -1 while a sheet is open, back to its normal
  // stacking the instant every sheet closes.
  const handleSheetOpen = useCallback((open) => {
    setCommentsOpen(open);
    setSheetOpen(open);
  }, []);

  return (
    <View style={styles.container} {...swipePanHandlers}>
<FlatList
ref={videoListRef}
key={focusKey}
  data={visibleVideos}
  keyExtractor={(post) => post._id}
  renderItem={({ item }) => (
    <View style={{ height: SCREEN_HEIGHT, width: "100%" }}>
<Videopost
  p={item}
  hasNavbar={hasNavbar}
  isVisible={visibleVideoIds.has(item._id)}
  onBlock={handleBlock}
  onSheetOpen={handleSheetOpen}
  myId={myId}
  myFollowingIds={myFollowingIds}
  onFollowChange={handleFollowChange}
/>
    </View>
  )}
  pagingEnabled
  showsVerticalScrollIndicator={false}
  snapToInterval={SCREEN_HEIGHT}
  snapToAlignment="start"
  decelerationRate="fast"
  getItemLayout={(_, index) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * index, index })}
  onViewableItemsChanged={onViewableItemsChanged}
  viewabilityConfig={viewabilityConfig}
  initialNumToRender={2}
  maxToRenderPerBatch={2}
  windowSize={3}
  removeClippedSubviews={true}
  style={{ zIndex: 0 }}
/>

      {hasNavbar && (
        // FIX: wrapper controls stacking of Navbar relative to the
        // FlatList above (its sibling here) — zIndex -1 while any sheet
        // is open drops it behind the FlatList's content/Modals, and it
        // returns to normal (10) the moment sheetOpen goes false again.
        // elevation is set alongside zIndex since Android additionally
        // needs it for correct stacking order.
        <View
          style={[
            styles.navbarWrap,
            sheetOpen ? styles.navbarWrapHidden : styles.navbarWrapVisible,
          ]}
          pointerEvents={sheetOpen ? "none" : "auto"}
        >
          <Navbar />
        </View>
      )}
    </View>
  );
}

export default VideoPage;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  navbarWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  navbarWrapVisible: { zIndex: 10, elevation: 10 },
  navbarWrapHidden: { zIndex: -1, elevation: 0 },
});