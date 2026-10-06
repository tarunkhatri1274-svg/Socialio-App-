import React, { useEffect, useState, useRef } from "react";
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
} from "react-native";
import Video from "react-native-video";
import Svg, { Path, Circle, Polyline, Polygon } from "react-native-svg";
import Config from "react-native-config";
import { apiFetch as authApiFetch } from "../../api/authToken";

const API = Config.API_URL;
const GOLDEN = "rgb(234,182,118)";

const apiFetch = async (url, options = {}) => {
  // Uses the shared apiFetch from authToken.js so an expired token is
  // refreshed automatically on a 401 instead of just throwing.
  const res = await authApiFetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const GroupIcon = ({ color = "currentColor", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="9" cy="7" r="4" />
    <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);
const RepostIcon = ({ color = "#fff", size = 14 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polyline points="17 1 21 5 17 9" />
    <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <Polyline points="7 23 3 19 7 15" />
    <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Svg>
);
const PlayIcon = () => (
  <Svg viewBox="0 0 24 24" width="34" height="34">
    <Circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.35)" />
    <Polygon points="10,8 17,12 10,16" fill="rgba(255,255,255,0.92)" />
  </Svg>
);

/**
 * Builds the Instagram-style italic caption shown above a shared
 * post/story card in the chat window.
 */
export function getShareCaption(msg, fromMe, otherUsername) {
  if (!msg?.sharedPost) return null;
  const isStory = msg.sharedPost.kind === "story";
  const senderName = msg.user?.username || "Someone";

  if (msg.isMentionMessage) {
    return fromMe
      ? `You mentioned ${otherUsername || "them"} in your story`
      : `${senderName} mentioned you in their story`;
  }

  if (isStory) {
    return fromMe ? "You shared a story" : `${senderName} shared a story`;
  }

  return fromMe ? "You shared a post" : `${senderName} shared a post`;
}

/**
 * Inline post viewer — Modal overlay instead of navigating to a
 * separate route. Supports the same multi-image carousel as web.
 */
function PostViewerOverlay({ post, onClose }) {
  const [index, setIndex] = useState(0);

  if (!post) return null;

  const mediaList = Array.isArray(post.media) && post.media.length > 0
    ? post.media
    : (post.mediaUrl ? [{ url: post.mediaUrl, type: post.mediaType }] : []);

  const current = mediaList[index] || null;
  const isVideo = current?.type === "video";
  const hasMultiple = mediaList.length > 1;

  const goNext = () => setIndex((i) => (i + 1) % mediaList.length);
  const goPrev = () => setIndex((i) => (i - 1 + mediaList.length) % mediaList.length);

  const authorPic = post.authorProfilePic || post.user?.profilePic || post.author?.profilePic;
  const authorName = post.authorUsername || post.user?.username || post.author?.username;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={ov.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={ov.card} onPress={() => {}}>
          <View style={ov.header}>
            {authorPic ? (
              <Image source={{ uri: authorPic }} style={ov.avatar} />
            ) : (
              <View style={[ov.avatar, ov.avatarFallback]}>
                <Text style={ov.avatarFallbackText}>{authorName?.[0]?.toUpperCase() || "?"}</Text>
              </View>
            )}
            <Text style={ov.username}>{authorName}</Text>
            <TouchableOpacity onPress={onClose}><Text style={ov.closeBtnText}>✕</Text></TouchableOpacity>
          </View>

          {current && (
            <View style={ov.mediaWrap}>
              {isVideo ? (
                <Video source={{ uri: current.url }} style={ov.media} controls resizeMode="contain" paused={false} />
              ) : (
                <Image source={{ uri: current.url }} style={ov.media} resizeMode="contain" />
              )}

              {hasMultiple && (
                <>
                  <TouchableOpacity onPress={goPrev} style={[ov.navBtn, { left: 8 }]}>
                    <Text style={ov.navBtnText}>‹</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={goNext} style={[ov.navBtn, { right: 8 }]}>
                    <Text style={ov.navBtnText}>›</Text>
                  </TouchableOpacity>
                  <View style={ov.dotsWrap}>
                    {mediaList.map((_, i) => (
                      <View key={i} style={[ov.dot, { opacity: i === index ? 1 : 0.4 }]} />
                    ))}
                  </View>
                  <View style={ov.counter}>
                    <Text style={ov.counterText}>{index + 1}/{mediaList.length}</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {(post.caption || post.text) && <Text style={ov.caption}>{post.caption || post.text}</Text>}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/**
 * Inline story viewer — same overlay pattern.
 */
function StoryViewerOverlay({ story, author, onClose }) {
  if (!story) return null;

  const mediaUrl = story.media?.url || story.mediaUrl || null;
  const isVideo = story.media?.type === "video" || story.mediaType === "video";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={ov.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[ov.card, { backgroundColor: "#000" }]} onPress={() => {}}>
          <View style={ov.storyHeader}>
            {author?.profilePic ? (
              <Image source={{ uri: author.profilePic }} style={ov.avatar} />
            ) : (
              <View style={[ov.avatar, ov.avatarFallback]}>
                <Text style={ov.avatarFallbackText}>{author?.username?.[0]?.toUpperCase() || "?"}</Text>
              </View>
            )}
            <Text style={[ov.username, { color: "#fff" }]}>{author?.username}</Text>
            <TouchableOpacity onPress={onClose}><Text style={[ov.closeBtnText, { color: "#fff" }]}>✕</Text></TouchableOpacity>
          </View>

          <View style={[ov.mediaWrap, { aspectRatio: 9 / 16, maxHeight: "70%", backgroundColor: "#000" }]}>
            {mediaUrl ? (
              isVideo ? (
                <Video source={{ uri: mediaUrl }} style={ov.media} controls resizeMode="contain" paused={false} />
              ) : (
                <Image source={{ uri: mediaUrl }} style={ov.media} resizeMode="contain" />
              )
            ) : (
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No media found for this story.</Text>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/**
 * Renders a shared post OR a shared story inside a chat bubble.
 * Tapping it opens an inline Modal overlay directly on top of the
 * chat — no navigation to a different screen.
 */
export function SharedPostBubble({ sharedPost, fromMe, isMentionMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [storyStatus, setStoryStatus] = useState(null); // null | "checking" | "available" | "expired" | "denied"
  const [opening, setOpening] = useState(false);
  const videoRef = useRef(null);

  const [viewingPost, setViewingPost] = useState(null);
  const [viewingStory, setViewingStory] = useState(null);

  const [reposting, setReposting] = useState(false);
  const [reposted, setReposted] = useState(false);

  const isStory = sharedPost?.kind === "story";
  const canAddToStory = isMentionMessage && isStory && !fromMe && storyStatus !== "expired" && storyStatus !== "denied";

  useEffect(() => {
    if (!isStory || !sharedPost?.storyId) return;
    setStoryStatus("checking");

    (async () => {
      try {
        const res = await authApiFetch(`${API}/stories/get-user-stories/${sharedPost.authorId}`);
        if (res.status === 403) {
          setStoryStatus("denied");
          return;
        }
        const data = await res.json();
        const stillThere = data.success && data.stories?.some(s => s._id === sharedPost.storyId);
        setStoryStatus(stillThere ? "available" : "expired");
      } catch {
        setStoryStatus("expired");
      }
    })();
  }, [isStory, sharedPost?.storyId, sharedPost?.authorId]);

  if (!sharedPost) return null;

  const openPost = async () => {
    if (!sharedPost.authorId || !sharedPost.postId) {
      console.warn("Cannot open shared post: missing authorId or postId on sharedPost payload.");
      return;
    }
    setOpening(true);
    try {
      const data = await apiFetch(`${API}/auth/get-posts/${sharedPost.authorId}`);
      const allPosts = data.success ? data.posts : [];
      const post = allPosts.find(p => p._id === sharedPost.postId);

      if (!post) {
        Alert.alert("This post is no longer available.");
        return;
      }
      setViewingPost(post);
    } catch (err) {
      console.error("Failed to open shared post:", err);
      Alert.alert("Couldn't open this post.");
    } finally {
      setOpening(false);
    }
  };

  const openStory = async () => {
    setOpening(true);
    try {
      const res = await authApiFetch(`${API}/stories/get-user-stories/${sharedPost.authorId}`);

      if (res.status === 403) {
        setStoryStatus("denied");
        return;
      }

      const data = await res.json();
      const story = data.success ? data.stories?.find(s => s._id === sharedPost.storyId) : null;

      if (!story) {
        setStoryStatus("expired");
        return;
      }

      setViewingStory({
        story,
        author: { username: sharedPost.authorUsername, profilePic: sharedPost.authorProfilePic },
      });
    } catch (err) {
      console.error("Failed to open shared story:", err);
    } finally {
      setOpening(false);
    }
  };

  const handleOpen = () => {
    // Kill the inline preview video's playback first — otherwise it
    // keeps playing behind the full-screen overlay's own Video.
    if (videoRef.current) {
      videoRef.current.seek(0);
    }
    setExpanded(false);

    if (isStory) {
      if (storyStatus === "available") openStory();
      return;
    }
    openPost();
  };

  const handleVideoTap = () => {
    if (!expanded) { setExpanded(true); return; }
    // Playback toggling is handled via the `paused` prop tied to a
    // small bit of extra state if you want a real pause toggle — the
    // web version reached into the DOM video element directly, which
    // RN's Video component doesn't allow; wire up a `paused` state var
    // here if you need tap-to-pause on the inline preview.
  };

  const handleAddToStory = async () => {
    if (reposting || reposted || !sharedPost.storyId) return;
    setReposting(true);
    try {
      const res = await authApiFetch(`${API}/stories/repost/${sharedPost.storyId}`, {
        method: "POST"
      });
      const data = await res.json();
      if (data.success) {
        setReposted(true);
      } else {
        Alert.alert(data.message || "Couldn't add to your story.");
      }
    } catch (err) {
      console.error("Failed to repost story:", err);
      Alert.alert("Couldn't add to your story.");
    } finally {
      setReposting(false);
    }
  };

  // ── expired story ───────────────────────────────────────────────────
  if (isStory && storyStatus === "expired") {
    return (
      <View style={[s.card, { backgroundColor: fromMe ? "rgba(255,255,255,0.1)" : "#f0f2f5", opacity: 0.7 }]}>
        <View style={s.expiredRow}>
          <Text style={{ fontSize: 18 }}>⏱️</Text>
          <View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: fromMe ? "#fff" : "#111" }}>Story no longer available</Text>
            <Text style={{ fontSize: 11, color: fromMe ? "rgba(255,255,255,0.6)" : "#999", marginTop: 2 }}>This story has expired</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── viewer doesn't follow the story author ──────────────────────────
  if (isStory && storyStatus === "denied") {
    return (
      <View style={[s.card, { backgroundColor: fromMe ? "rgba(255,255,255,0.1)" : "#f0f2f5", opacity: 0.7 }]}>
        <View style={s.expiredRow}>
          <Text style={{ fontSize: 18 }}>🔒</Text>
          <View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: fromMe ? "#fff" : "#111" }}>Story unavailable</Text>
            <Text style={{ fontSize: 11, color: fromMe ? "rgba(255,255,255,0.6)" : "#999", marginTop: 2 }}>
              Follow {sharedPost.authorUsername || "this user"} to view their story
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      {viewingPost && <PostViewerOverlay post={viewingPost} onClose={() => setViewingPost(null)} />}
      {viewingStory && (
        <StoryViewerOverlay story={viewingStory.story} author={viewingStory.author} onClose={() => setViewingStory(null)} />
      )}

      <TouchableOpacity
        style={[s.card, opening && { opacity: 0.7 }]}
        onPress={handleOpen}
        disabled={opening}
        activeOpacity={0.85}
      >
        <View style={s.headerRow}>
          {sharedPost.authorProfilePic ? (
            <Image source={{ uri: sharedPost.authorProfilePic }} style={s.tinyAvatar} />
          ) : (
            <View style={[s.tinyAvatar, s.tinyAvatarFallback]}>
              <Text style={s.tinyAvatarFallbackText}>{sharedPost.authorUsername?.[0]?.toUpperCase() || "?"}</Text>
            </View>
          )}
          <Text style={s.headerName}>{sharedPost.authorUsername}</Text>
          {isStory && (
            <View style={s.storyPill}>
              <Text style={s.storyPillText}>{isMentionMessage ? "Mentioned you" : "Story"}</Text>
            </View>
          )}
        </View>

        {sharedPost.mediaUrl && (
          <TouchableOpacity
            style={s.mediaWrap}
            onPress={sharedPost.mediaType === "video" ? handleVideoTap : undefined}
            activeOpacity={sharedPost.mediaType === "video" ? 0.85 : 1}
          >
            {sharedPost.mediaType === "video" ? (
              <>
                <Video
                  ref={videoRef}
                  source={{ uri: sharedPost.mediaUrl }}
                  style={s.media}
                  muted={!expanded}
                  controls={expanded}
                  repeat={!expanded}
                  paused={!expanded}
                  resizeMode="cover"
                />
                {/* PlayIcon is an absolutely-positioned sibling that spans
                    the full mediaWrap box (explicit top/left/right/bottom: 0)
                    with its own zIndex/elevation so it always renders
                    centered on top of the video thumbnail. */}
                {!expanded && (
                  <View style={s.playOverlay} pointerEvents="none">
                    <PlayIcon />
                  </View>
                )}
              </>
            ) : (
              <Image source={{ uri: sharedPost.mediaUrl }} style={s.media} resizeMode="cover" />
            )}
          </TouchableOpacity>
        )}

        {!!sharedPost.caption && (
          <Text style={[s.caption, { color: fromMe ? "rgba(255,255,255,0.85)" : "#444" }]}>
            {sharedPost.caption.length > 80 ? sharedPost.caption.slice(0, 80) + "…" : sharedPost.caption}
          </Text>
        )}

        {canAddToStory && (
          <TouchableOpacity
            onPress={handleAddToStory}
            disabled={reposting || reposted}
            style={[
              s.repostBtn,
              { backgroundColor: reposted ? "rgba(76,175,80,0.15)" : GOLDEN, opacity: reposting ? 0.7 : 1 },
            ]}
          >
            {reposted ? (
              <Text style={[s.repostBtnText, { color: "#2e7d32" }]}>Added to Your Story ✓</Text>
            ) : (
              <>
                <RepostIcon />
                <Text style={s.repostBtnText}>{reposting ? "Adding…" : "Add to Your Story"}</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text style={[s.tapHint, { color: fromMe ? "rgba(255,255,255,0.55)" : "#999" }]}>
          {isStory
            ? (storyStatus === "checking" || storyStatus === null ? "Checking…" : "Tap to view story")
            : (opening ? "Opening…" : "Tap to view post")}
        </Text>
      </TouchableOpacity>
    </>
  );
}

/**
 * Forward an existing message's shared content to other destinations.
 * Two tabs: "People" (1:1 chats) and "Groups".
 */
export function ForwardModal({ msg, currentUser, onClose }) {
  const [tab, setTab] = useState("people"); // "people" | "groups"
  const [search, setSearch] = useState("");

  const [recentUsers, setRecentUsers] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [searching, setSearching] = useState(false);

  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [sending, setSending] = useState(false);
  const timer = useRef(null);

  const isSearchMode = search.trim().length > 0;
  const peopleList = isSearchMode ? searchResults : recentUsers;

  useEffect(() => {
    apiFetch(`${API}/messages/recent-users`)
      .then(data => { if (data.success) setRecentUsers(data.users); })
      .catch(console.error)
      .finally(() => setLoadingUsers(false));

    apiFetch(`${API}/groups/mine`)
      .then(data => { if (data.success) setGroups(data.groups); })
      .catch(console.error)
      .finally(() => setLoadingGroups(false));
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!search.trim()) { setSearchResults([]); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`${API}/messages/search-users?q=${encodeURIComponent(search)}`);
        if (data.success) setSearchResults(data.users);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [search]);

  const toggleUser = (id) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleGroup = (chatId) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(chatId) ? next.delete(chatId) : next.add(chatId);
      return next;
    });
  };

  const totalSelected = selectedUsers.size + selectedGroups.size;

  const filteredGroups = isSearchMode
    ? groups.filter(g => g.name?.toLowerCase().includes(search.toLowerCase()))
    : groups;

  const handleForward = async () => {
    if (totalSelected === 0) return;
    setSending(true);
    try {
      await Promise.all([
        ...Array.from(selectedUsers).map(async (recipientId) => {
          const toChatId = [currentUser._id, recipientId].sort().join("_");
          await apiFetch(`${API}/messages/forward/${msg._id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: recipientId, toChatId }),
          });
        }),
        ...Array.from(selectedGroups).map(async (chatId) => {
          await apiFetch(`${API}/groups/${chatId}/messages/forward`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId: msg._id }),
          });
        }),
      ]);
      onClose();
    } catch (err) {
      console.error("Forward failed", err);
      Alert.alert("Failed to forward message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const showLoading = tab === "people" ? (isSearchMode ? searching : loadingUsers) : loadingGroups;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.forwardModal} onPress={() => {}}>
          <View style={s.forwardModalHeader}>
            <Text style={s.forwardModalTitle}>Forward to</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.closeBtnText}>✕</Text></TouchableOpacity>
          </View>

          <View style={s.tabsRow}>
            <TouchableOpacity style={[s.tabBtn, tab === "people" && s.tabBtnActive]} onPress={() => setTab("people")}>
              <Text style={[s.tabBtnText, tab === "people" && s.tabBtnTextActive]}>
                People{selectedUsers.size > 0 ? ` (${selectedUsers.size})` : ""}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.tabBtn, tab === "groups" && s.tabBtnActive]} onPress={() => setTab("groups")}>
              <GroupIcon color={tab === "groups" ? "#fff" : "#888"} />
              <Text style={[s.tabBtnText, tab === "groups" && s.tabBtnTextActive]}>
                {" "}Groups{selectedGroups.size > 0 ? ` (${selectedGroups.size})` : ""}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={s.forwardSearchWrap}>
            <TextInput
              style={s.forwardSearchInput}
              placeholder={tab === "people" ? "Search people…" : "Search groups…"}
              placeholderTextColor="#999"
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>

          {tab === "people" && !isSearchMode && <Text style={s.sectionLabel}>Recent</Text>}
          {tab === "groups" && <Text style={s.sectionLabel}>Your Groups</Text>}

          <ScrollView style={s.forwardUserList}>
            {showLoading && <Text style={s.loadingText}>Loading…</Text>}

            {!showLoading && tab === "people" && peopleList.length === 0 && (
              <Text style={s.loadingText}>No users found</Text>
            )}
            {!showLoading && tab === "people" && peopleList.map(u => (
              <TouchableOpacity key={u._id} style={s.forwardUserItem} onPress={() => toggleUser(u._id)}>
                {u.profilePic ? (
                  <Image source={{ uri: u.profilePic }} style={s.userAvatar} />
                ) : (
                  <View style={[s.userAvatar, s.userAvatarFallback]}>
                    <Text style={s.userAvatarFallbackText}>{u.username?.[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <Text style={s.forwardUserName}>{u.username}</Text>
                <View style={[s.checkbox, selectedUsers.has(u._id) && s.checkboxChecked]}>
                  {selectedUsers.has(u._id) && <Text style={s.checkboxCheck}>✓</Text>}
                </View>
              </TouchableOpacity>
            ))}

            {!showLoading && tab === "groups" && filteredGroups.length === 0 && (
              <Text style={s.loadingText}>No groups found</Text>
            )}
            {!showLoading && tab === "groups" && filteredGroups.map(g => (
              <TouchableOpacity key={g.chatId} style={s.forwardUserItem} onPress={() => toggleGroup(g.chatId)}>
                {g.avatar ? (
                  <Image source={{ uri: g.avatar }} style={s.userAvatar} />
                ) : (
                  <View style={[s.userAvatar, { backgroundColor: "#ececec", alignItems: "center", justifyContent: "center" }]}>
                    <GroupIcon color="#999" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.forwardGroupName}>{g.name}</Text>
                  {g.memberCount != null && <Text style={s.forwardGroupMembers}>{g.memberCount} members</Text>}
                </View>
                <View style={[s.checkbox, selectedGroups.has(g.chatId) && s.checkboxChecked]}>
                  {selectedGroups.has(g.chatId) && <Text style={s.checkboxCheck}>✓</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={s.forwardFooter}>
            <TouchableOpacity
              style={[s.forwardSendBtn, { opacity: totalSelected > 0 && !sending ? 1 : 0.5 }]}
              disabled={totalSelected === 0 || sending}
              onPress={handleForward}
            >
              <Text style={s.forwardSendBtnText}>
                {sending ? "Sending…" : `Send${totalSelected > 0 ? ` (${totalSelected})` : ""}`}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 14, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.06)", maxWidth: 220, marginBottom: 4 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  tinyAvatar: { width: 20, height: 20, borderRadius: 10 },
  tinyAvatarFallback: { backgroundColor: GOLDEN, alignItems: "center", justifyContent: "center" },
  tinyAvatarFallbackText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  headerName: { fontSize: 12, fontWeight: "700" },
  storyPill: { marginLeft: "auto", backgroundColor: GOLDEN, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  storyPillText: { fontSize: 9, fontWeight: "700", color: "#fff", textTransform: "uppercase" },
  mediaWrap: { width: "100%", aspectRatio: 1, backgroundColor: "#000", position: "relative", overflow: "hidden" },
  media: { width: "100%", height: "100%" },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    elevation: 5,
  },
  caption: { fontSize: 12, marginHorizontal: 10, marginTop: 6, lineHeight: 16 },
  tapHint: { fontSize: 10, marginHorizontal: 10, marginTop: 6, marginBottom: 8, fontStyle: "italic" },
  expiredRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  repostBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: 10, marginBottom: 6, paddingVertical: 8, borderRadius: 10 },
  repostBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  forwardModal: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "78%" },
  forwardModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  forwardModalTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  closeBtnText: { fontSize: 16, color: "#888" },
  tabsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: "#f2f2f2" },
  tabBtnActive: { backgroundColor: "#111" },
  tabBtnText: { color: "#888", fontWeight: "600", fontSize: 13 },
  tabBtnTextActive: { color: "#fff" },
  forwardSearchWrap: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  forwardSearchInput: { fontSize: 14, color: "#111", backgroundColor: "#f2f2f2", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: "#aaa", textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  forwardUserList: { flex: 1, paddingVertical: 6 },
  loadingText: { textAlign: "center", color: "#bbb", paddingVertical: 24 },
  forwardUserItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  userAvatar: { width: 44, height: 44, borderRadius: 22 },
  userAvatarFallback: { backgroundColor: GOLDEN, alignItems: "center", justifyContent: "center" },
  userAvatarFallbackText: { color: "#fff", fontWeight: "700" },
  forwardUserName: { flex: 1, marginLeft: 12, fontSize: 14, fontWeight: "600", color: "#111" },
  forwardGroupName: { fontSize: 14, fontWeight: "600", color: "#111" },
  forwardGroupMembers: { fontSize: 11, color: "#999", marginTop: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: GOLDEN, borderWidth: 0 },
  checkboxCheck: { color: "#fff", fontSize: 12 },
  forwardFooter: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  forwardSendBtn: { paddingVertical: 12, borderRadius: 12, backgroundColor: GOLDEN, alignItems: "center" },
  forwardSendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});

const ov = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 18, width: "100%", maxWidth: 420, maxHeight: "85%", overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.06)" },
  storyHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "rgba(0,0,0,0.4)" },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  avatarFallback: { backgroundColor: GOLDEN, alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { color: "#fff", fontWeight: "700" },
  username: { fontSize: 14, fontWeight: "700", color: "#111", flex: 1 },
  closeBtnText: { fontSize: 16, color: "#888", padding: 4 },
  mediaWrap: { width: "100%", aspectRatio: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", position: "relative" },
  media: { width: "100%", height: "100%" },
  caption: { fontSize: 13, color: "#333", paddingHorizontal: 14, paddingVertical: 10 },
  navBtn: { position: "absolute", top: "50%", marginTop: -16, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  navBtnText: { color: "#fff", fontSize: 18 },
  dotsWrap: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  counter: { position: "absolute", top: 8, right: 10, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  counterText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});