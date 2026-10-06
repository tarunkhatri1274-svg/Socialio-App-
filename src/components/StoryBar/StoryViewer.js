import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Modal,
  Alert,
  Animated,
  StyleSheet,
  Dimensions,
} from "react-native";
import Video from "react-native-video";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
} from "react-native-webrtc";
import FAIcon from "react-native-vector-icons/FontAwesome";
import IonIcon from "react-native-vector-icons/Ionicons";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path
import Config from "react-native-config";
import { useNavigation } from "@react-navigation/native";
import socket from "../../sockets/Sockets";
import {
  getStoryRuntime,
  subscribeStory,
  pushComment,
  setRuntimeComments,
  setLikeState,
} from "../State/SyncStoryStore";

const API = Config.API_URL;
const GOLDEN = "rgb(234,182,118)";
const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");


function formatTimeAgo(dateInput) {
  if (!dateInput) return "";
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

function Avatar({ src, username, size = 36, style: extra = {} }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (src) return <Image source={{ uri: src }} style={[base, extra]} />;
  return (
    <View style={[base, extra, avatarFallback]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.38 }}>{letter}</Text>
    </View>
  );
}
const avatarFallback = { backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" };

function MiniAvatar({ src, username, size = 16 }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (src) return <Image source={{ uri: src }} style={base} />;
  return (
    <View style={[base, avatarFallback]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.55 }}>{letter}</Text>
    </View>
  );
}

// ── Floating emoji burst — Animated.timing per emoji instead of CSS
// @keyframes floatUp; each emoji gets its own Animated.Value driving
// translateY + opacity, cleaned up on completion.
function FloatingEmoji({ emoji, onDone }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: true }).start(onDone);
  }, []);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -120] });
  const opacity = anim.interpolate({ inputRange: [0, 0.1, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.Text style={{ fontSize: 24, transform: [{ translateY }], opacity }}>
      {emoji}
    </Animated.Text>
  );
}

function EmojiFloat({ emojis, onRemove }) {
  return (
    <View style={S.emojiFloatWrap} pointerEvents="none">
      {emojis.map((e) => (
        <FloatingEmoji key={e.id} emoji={e.emoji} onDone={() => onRemove(e.id)} />
      ))}
    </View>
  );
}

// ── Owns liveComments + floatingEmojis + the comment socket listener
// itself, so a new comment/reaction only re-renders THIS small
// subtree — not the parent StoryViewer, which holds the <Video>,
// <RTCView>, and the progress-bar Animated.timing. Previously all of
// that lived in StoryViewer's own state, so every single comment
// re-ran the entire screen's render function.
const LiveCommentsFeed = React.memo(function LiveCommentsFeed({ slideId }) {
  const [liveComments, setLiveComments] = useState([]);
  const [floatingEmojis, setFloatingEmojis] = useState([]);

  useEffect(() => {
    if (!slideId) return;

    const runtime = getStoryRuntime(slideId);
    setLiveComments(runtime.comments);

    const unsubscribe = subscribeStory(slideId, (s) => {
      setLiveComments(s.comments);
    });

    const onComment = (payload) => {
      pushComment(slideId, payload);
      if (LIVE_REACTIONS.includes(payload.text)) {
        const id = Date.now() + Math.random();
        setFloatingEmojis((prev) => [...prev.slice(-5), { id, emoji: payload.text }]);
      }
    };

    socket.on(`story:${slideId}:comment`, onComment);

    return () => {
      socket.off(`story:${slideId}:comment`, onComment);
      unsubscribe();
    };
  }, [slideId]);

  return (
    <>
      <EmojiFloat
        emojis={floatingEmojis}
        onRemove={(id) => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id))}
      />
      {liveComments.length > 0 && (
        <View style={S.commentsFeed} pointerEvents="none">
          {liveComments.map((c, i) =>
            c.system ? (
              <View key={i} style={S.systemBubble}>
                <MiniAvatar src={c.profilePic} username={c.username} size={16} />
                <Text style={S.systemText}>{c.username} {c.text}</Text>
              </View>
            ) : (
              <View key={i} style={S.commentBubble}>
                <Text style={S.commentUser}>{c.username} </Text>
                <Text style={S.commentText}>{c.text}</Text>
              </View>
            )
          )}
        </View>
      )}
    </>
  );
});

/* ─── Story Share Sheet ─── */
function StoryShareSheet({ storyId, onClose }) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const timer = useRef(null);
  const navigation = useNavigation();

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API}/auth/share/users`);
        const data = await res.json();
        if (data.success) setUsers(data.users);
      } catch {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/auth/share/users?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        if (data.success) setUsers(data.users);
      } catch {}
    }, 300);
    return () => clearTimeout(timer.current);
  }, [search]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const res = await apiFetch(`${API}/auth/share/story`, {
        method: "POST",
        body: JSON.stringify({ storyId, toUserIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (data.success) { setSent(true); setTimeout(onClose, 900); }
    } catch (err) { console.error("Story share failed:", err); }
    finally { setSending(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={S.sheetOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={S.sheet} onPress={() => {}}>
          <View style={S.sheetHandle} />
          <View style={S.sheetHeader}><Text style={S.sheetTitle}>{sent ? "Sent!" : "Send to"}</Text></View>
          {!sent && (
            <>
              <TextInput value={search} onChangeText={setSearch} placeholder="Search people…" placeholderTextColor="#999" style={S.shareSearchInput} autoFocus />
              <ScrollView style={S.viewerList}>
                {loading && <Text style={S.emptyText}>Loading…</Text>}
                {!loading && users.length === 0 && <Text style={S.emptyText}>No users found</Text>}
                {!loading && users.map(u => (
                  <TouchableOpacity key={u._id} style={S.viewerRow} onPress={() => toggle(u._id)}>
                    <Avatar src={u.profilePic} username={u.username} size={42} />
                    <Text style={S.viewerName}>{u.username}</Text>
                    <View style={[S.shareCheckbox, selected.has(u._id) && S.shareCheckboxChecked]}>
                      {selected.has(u._id) && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={[S.shareSendBtn, { opacity: selected.size > 0 && !sending ? 1 : 0.5 }]} disabled={selected.size === 0 || sending} onPress={handleSend}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                  {sending ? "Sending…" : `Send${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const LIVE_REACTIONS = ["❤️", "😂", "😮", "🔥", "👏"];

// ← NEW — shared by slideIndex's and showViewers' initializers below so
// both agree on which slide the viewer is opening on before the first
// render, instead of one of them defaulting to slide 0 for a moment.
function resolveInitialSlideIndex(stories, index, initialStoryId) {
  if (!initialStoryId) return 0;
  const initialSlides = stories?.[index]?.slides || [];
  const idx = initialSlides.findIndex((s) => s.id === initialStoryId || s._id === initialStoryId);
  return idx >= 0 ? idx : 0;
}

function StoryViewer({ stories, index, close, currentUserId, initialStoryId = null, initialShowViewers = false }) {
  const navigation = useNavigation();
  const [currentUser, setCurrentUser] = useState({});
  const [myId, setMyId] = useState(currentUserId ? currentUserId.toString() : null);

  useEffect(() => {
    (async () => {
      const u = await getCachedUser();
      setCurrentUser(u);
      if (!currentUserId) {
        setMyId((u?._id || u?.id)?.toString());
        setAuthReady(true);
      }
    })();
  }, []);

  const [authReady, setAuthReady] = useState(!!currentUserId);
  const [current, setCurrent] = useState(index);
  // ← FIX — this used to always start at 0 and get corrected a moment
  // later by an effect once initialStoryId was resolved. That gap meant
  // this component's very first render (and everything that fires off
  // slide?.id on that render — the socket join, the story-data fetch,
  // and the Viewers-sheet flag) briefly ran against the WRONG slide
  // before snapping to the right one, which is exactly why the like
  // indicator flashed on then vanished: it first loaded for slide 0,
  // then a second fetch for the real target slide overwrote it a
  // moment later. Resolving the correct index synchronously, before the
  // first render, means every one of those effects only ever sees the
  // right slide.
  const [slideIndex, setSlideIndex] = useState(() => resolveInitialSlideIndex(stories, index, initialStoryId));
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [viewsCount, setViewsCount] = useState(0);
  const [liveViewers, setLiveViewers] = useState(0);
  const [comment, setComment] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  // ← NEW — RN's StoryViewer never had a way to land with the Viewers
  // sheet already open at all; that wiring only ever existed for
  // HomePage.js's FeedStoryPreview (via pendingOpenStoryShowViewers).
  // Now that ActivityPage.js opens this component directly, it needs
  // its own initialShowViewers prop, resolved synchronously (same
  // pattern as slideIndex above) so it opens on the correct slide's
  // data from the very first render — never on a live slide, which has
  // no Viewers sheet.
  const [showViewers, setShowViewers] = useState(() => {
    if (!initialShowViewers) return false;
    const idx = resolveInitialSlideIndex(stories, index, initialStoryId);
    const s = (stories?.[index]?.slides || [])[idx];
    const isLive = s?.type === "live" || s?.isLive === true;
    return !isLive;
  });
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [paused, setPaused] = useState(false);
  const [viewers, setViewers] = useState([]);
  // ← NEW — who among the viewers also liked this story, so the Viewers
  // sheet can show a heart next to their name (there's no separate
  // "who liked" sheet — story_like notifications land here instead, so
  // this is the only place that distinction can show up).
  const [likedByIds, setLikedByIds] = useState(() => new Set());
  const [accessDenied, setAccessDenied] = useState(null);
  const [isHidden, setIsHidden] = useState(false);

  const [liveStatus, setLiveStatus] = useState(null);
  const [liveStreamURL, setLiveStreamURL] = useState(null);
  const livePcRef = useRef(null);
  const timerRef = useRef(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [progressWidths, setProgressWidths] = useState({}); // per-slide final width tracking

  // ← NEW — "real time" here means the displayed "Xm/Xh ago" text actually
  // ticks forward as time passes, not just gets computed once and frozen.
  // Nothing else depends on this — it exists purely to force a re-render
  // every 30s so formatTimeAgo() below recomputes against a fresh Date.now().
  const [, forceTimeTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTimeTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

const story = stories?.[current];
const slides = story?.slides || [];
const slide = slides[slideIndex] || {};
const isOwn = story?.isOwn || (myId && story?.id?.toString() === myId);
  const isLiveSlide = slide?.type === "live" || slide?.isLive === true;
  const isVideo = slide.type === "video" || slide.image?.includes(".mp4") || slide.image?.includes("video");

  // ← Initial slideIndex is now resolved synchronously above (see its
  // useState initializer) instead of corrected here a render later —
  // that's what was causing the like-indicator flash/race. Nothing else
  // needs initialStoryId after the first render (swiping to another
  // author always starts that author's reel at slide 0, same as
  // before), so there's no effect needed here at all anymore.

  useEffect(() => {
    if (!slide?.id || !authReady) return;
    setAccessDenied(null);
    setIsHidden(slide?.isHiddenFromNonFollowers || false);
    socket.emit("joinStory", { storyId: slide.id, viewerId: myId });
    const onDenied = ({ storyId, reason }) => {
      if (storyId !== slide.id || isOwn) return;
      setAccessDenied(reason);
      setPaused(true);
    };
    socket.on("storyAccessDenied", onDenied);
    return () => {
      socket.emit("leaveStory", slide.id);
      socket.off("storyAccessDenied", onDenied);
    };
  }, [slide?.id, myId, authReady, isOwn]);

  // ── Live WebRTC — react-native-webrtc equivalent ─────────────────────
  useEffect(() => {
    if (!isLiveSlide || !slide?.liveRoomId) {
      setLiveStatus(null);
      setLiveStreamURL(null);
      return;
    }

    setLiveStatus("connecting");
    setLiveStreamURL(null);

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    livePcRef.current = pc;

    pc.ontrack = (event) => {
      const stream = event.streams && event.streams[0];
      if (stream) {
        setLiveStreamURL(stream.toURL());
        setLiveStatus("live");
      }
    };

    const iceBuffer = [];

    const handleOffer = async ({ from, offer }) => {
      if (pc.signalingState !== "stable") return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        for (const c of iceBuffer) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
        iceBuffer.length = 0;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("liveAnswer", { to: from, answer });
      } catch (e) { console.error("Failed to handle live offer:", e); }
    };

    const handleIce = async ({ candidate }) => {
      if (!candidate) return;
      try {
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        else iceBuffer.push(candidate);
      } catch (e) { console.error("ICE error:", e); }
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
      setTimeout(() => { close(); navigation.navigate("MainTabs", { screen: "Home" }); }, 1000);
    };

    socket.on("liveStoryOffer", handleOffer);
    socket.on("iceCandidate", handleIce);
    socket.on("liveAccessDenied", handleDenied);
    socket.on("liveEnded", handleEnded);
    socket.on("liveOffer", handleOffer);
    if (myId) socket.emit("joinLive", { roomId: slide.liveRoomId, viewerId: myId, username: currentUser.username });

    return () => {
      socket.off("liveStoryOffer", handleOffer);
      socket.off("iceCandidate", handleIce);
      socket.off("liveAccessDenied", handleDenied);
      socket.off("liveEnded", handleEnded);
      socket.off("liveOffer", handleOffer);
      if (myId) socket.emit("leaveLive", { roomId: slide.liveRoomId, viewerId: myId });
      pc.close();
      livePcRef.current = null;
    };
  }, [isLiveSlide, slide?.liveRoomId, slide?.authorId, myId]);

  useEffect(() => {
    if (!isLiveSlide || !slide?.id) return;
    const onViewerJoined = ({ username, profilePic }) => {
      if (isOwn) setLiveViewers(v => v + 1);
      pushComment(slide.id, { system: true, username: username || "Someone", profilePic, text: "joined the live" });
    };
    const onViewerLeft = ({ username, profilePic }) => {
      if (isOwn) setLiveViewers(v => Math.max(0, v - 1));
      pushComment(slide.id, { system: true, username: username || "Someone", profilePic, text: "left the live" });
    };
    socket.on("viewerJoined", onViewerJoined);
    socket.on("viewerLeft", onViewerLeft);
    return () => {
      socket.off("viewerJoined", onViewerJoined);
      socket.off("viewerLeft", onViewerLeft);
    };
  }, [isLiveSlide, isOwn, slide?.id]);

  useEffect(() => {
    if (!slide?.id || !authReady) return;

    let ignore = false;

    const runtime = getStoryRuntime(slide.id);
    setLikesCount(runtime.likesCount || slide.likes || 0);
    setLiked(runtime.liked);

    const fetchStoryData = async () => {
      try {
        if (ignore) return;
        if (isOwn) {
          const res = await apiFetch(`${API}/stories/viewers/${slide.id}`);
          const data = await res.json();
          if (data.success) {
            setViewers(data.viewers ?? []);
            const count = data.likesCount ?? slide.likes ?? 0;
            const likedNow = (data.likedBy ?? []).some(u => u._id === myId);
            setLikesCount(count);
            setLiked(likedNow);
            setLikeState(slide.id, { likesCount: count, liked: likedNow });
            // ← NEW — track every liker's id so each row in the Viewers
            // sheet below can show whether that person also liked it.
            setLikedByIds(new Set((data.likedBy ?? []).map(u => u._id)));
          }
        } else {
          const res = await apiFetch(`${API}/stories/like-state/${slide.id}`);
          const data = await res.json();
          if (ignore) return;
          if (data.success) {
            const count = data.likesCount ?? slide.likes ?? 0;
            setLikesCount(count);
            setLiked(!!data.liked);
            setLikeState(slide.id, { likesCount: count, liked: !!data.liked });
          } else if (res.status === 403) {
            setAccessDenied("not_following");
          }
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
    fetchStoryData();

    const unsubscribe = subscribeStory(slide.id, (s) => {
      setLikesCount(s.likesCount);
      setLiked(s.liked);
    });

    const onLikes = ({ likesCount: count }) => setLikeState(slide.id, { likesCount: count });
    const onViews = ({ viewsCount: count }) => setViewsCount(count);

    socket.on(`story:${slide.id}:likes`, onLikes);
    socket.on(`story:${slide.id}:views`, onViews);

    return () => {
      ignore = true;
      socket.off(`story:${slide.id}:likes`, onLikes);
      socket.off(`story:${slide.id}:views`, onViews);
      unsubscribe();
    };
  }, [slide?.id, myId, isOwn, authReady]);

  const accessDeniedRef = useRef(accessDenied);
  accessDeniedRef.current = accessDenied;

  useEffect(() => {
    if (!slide?.id || accessDeniedRef.current) return;
    (async () => {
      try {
        const res = await apiFetch(`${API}/stories/view-story/${slide.id}`, { method: "PUT"});
        const data = await res.json();
        if (data.success) setViewsCount(data.viewsCount ?? 0);
      } catch {}
    })();
  }, [slide?.id]);

  // ── Progress bar via Animated.timing instead of setInterval + CSS width
  useEffect(() => {
    progressAnim.setValue(0);
    clearTimeout(timerRef.current);
    if (paused || accessDenied || isLiveSlide) return;

    const anim = Animated.timing(progressAnim, { toValue: 1, duration: 5000, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished) handleNext(); });
    return () => anim.stop();
  }, [current, slideIndex, paused, accessDenied, isLiveSlide]);

  useEffect(() => { setPaused(showMenu || showViewers || showShareSheet); }, [showMenu, showViewers, showShareSheet]);

  const handleNext = () => {
    if (slideIndex < slides.length - 1) setSlideIndex(slideIndex + 1);
    else if (current < stories.length - 1) { setCurrent(current + 1); setSlideIndex(0); }
    else close();
  };

  const handlePrev = () => {
    if (slideIndex > 0) setSlideIndex(slideIndex - 1);
    else if (current > 0) {
      const prev = stories[current - 1];
      setCurrent(current - 1);
      setSlideIndex((prev?.slides?.length || 1) - 1);
    }
  };

  const handleLike = async () => {
    try {
      const res = await apiFetch(`${API}/stories/like-story/${slide.id}`, { method: "PUT" });
      const data = await res.json();
      if (data.success) {
        const nextLiked = !liked;
        setLiked(nextLiked);
        setLikesCount(data.likesCount);
        setLikeState(slide.id, { likesCount: data.likesCount, liked: nextLiked });
      } else if (res.status === 403) setAccessDenied("not_following");
    } catch {}
  };

  const sendReaction = (emoji) => {
    socket.emit("storyComment", { storyId: slide.id, userId: myId, username: currentUser.username, text: emoji });
  };

  const handleSendComment = () => {
    if (!comment.trim() || accessDenied) return;
    socket.emit("storyComment", { storyId: slide.id, userId: myId, username: currentUser.username, text: comment });
    setComment("");
  };

  const handleDelete = (storyId) => {
    if (!storyId) { Alert.alert("Story ID not found"); return; }
    Alert.alert("Delete story", "Delete this story?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            const res = await apiFetch(`${API}/stories/delete-story/${storyId}`, { method: "DELETE"});
            const data = await res.json();
            if (res.ok) close();
            else Alert.alert(data.message);
          } catch (err) { console.log(err); }
        },
      },
    ]);
  };

  const handleHideFromNonFollowers = async () => {
    if (!slide?.id) return;
    try {
      const res = await apiFetch(`${API}/stories/hide-from-non-followers/${slide.id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) { setIsHidden(data.isHiddenFromNonFollowers); setShowMenu(false); }
      else Alert.alert(data.message || "Couldn't update visibility");
    } catch (err) { console.log(err); }
  };

  const goToProfile = () => { if (story.id) navigation.navigate("UserProfile", { userId: story.id }); };

   if (accessDenied && !isOwn) {
    return (
      <View style={S.container}>
        <View style={S.deniedWrap}>
          <Avatar src={story.userProfile} username={story.username} size={64} />
          <Text style={S.deniedTitle}>
            {accessDenied === "not_following" ? "Follow to view this story" : "This story isn't available"}
          </Text>
          <Text style={S.deniedText}>
            {accessDenied === "not_following"
              ? `Only ${story.username}'s followers can see their story.`
              : "It may have expired or been removed."}
          </Text>
          <TouchableOpacity style={S.deniedBtn} onPress={close}><Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!stories || stories.length === 0 || index === undefined || !story) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={close}>
      <View style={S.container}>

        {/* PROGRESS BARS */}
        {!isLiveSlide && (
          <View style={S.progressWrap}>
            {slides.map((_, i) => (
              <View key={i} style={S.progressBg}>
                {i < slideIndex ? (
                  <View style={[S.progressFill, { width: "100%" }]} />
                ) : i === slideIndex ? (
                  <Animated.View
                    style={[S.progressFill, {
                      width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                    }]}
                  />
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* MEDIA */}
        {isLiveSlide ? (
          liveStatus === "live" && liveStreamURL ? (
            <RTCView streamURL={liveStreamURL} style={S.img} objectFit="cover" />
          ) : (
            <View style={[S.img, S.liveFallback]}>
              {liveStatus === "denied" && (
                <>
                  <Text style={{ fontSize: 40 }}>🔒</Text>
                  <Text style={S.liveFallbackTitle}>Follow to watch</Text>
                  <Text style={S.liveFallbackText}>Only {story.username}'s followers can watch their live</Text>
                </>
              )}
              {liveStatus === "ended" && (
                <>
                  <Text style={{ fontSize: 40 }}>📺</Text>
                  <Text style={S.liveFallbackTitle}>Live has ended</Text>
                  <Text style={S.liveFallbackText}>Returning to home…</Text>
                </>
              )}
              {(liveStatus === "connecting" || !liveStatus) && (
                <Text style={S.liveFallbackText}>Connecting to live…</Text>
              )}
            </View>
          )
        ) : isVideo ? (
          <Video source={{ uri: slide.image }} style={S.img} resizeMode="contain" repeat={false} onEnd={handleNext} />
        ) : (
          <Image source={{ uri: slide.image }} style={S.img} resizeMode="contain" />
        )}

        {/* Text overlays + mentions */}
        {!isLiveSlide && (slide.textOverlays?.length > 0 || slide.mentions?.length > 0) && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {(slide.textOverlays || []).map((t, i) => (
              <View key={`text-${i}`} style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, transform: [{ translateX: -50 }, { translateY: -50 }], maxWidth: "80%" }}>
                <Text style={{ color: t.color || "#fff", fontSize: t.fontSize || 24, fontWeight: "700", textAlign: t.align || "center" }}>{t.text}</Text>
              </View>
            ))}
            {(slide.mentions || []).map((m, i) => (
              <TouchableOpacity
                key={`mention-${i}`}
                onPress={() => m.user && navigation.navigate("UserProfile", { userId: m.user })}
                style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, transform: [{ translateX: -50 }, { translateY: -50 }], backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: "#111", fontSize: 13, fontWeight: "700" }}>@{m.username || "user"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Repost attribution */}
        {!isLiveSlide && slide.repostAttribution?.username && (
          <TouchableOpacity
            onPress={() => slide.repostAttribution.user && navigation.navigate("UserProfile", { userId: slide.repostAttribution.user })}
            style={S.repostBadge}
          >
            {slide.repostAttribution.profilePic ? (
              <Image source={{ uri: slide.repostAttribution.profilePic }} style={{ width: 20, height: 20, borderRadius: 10 }} />
            ) : (
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{slide.repostAttribution.username[0]?.toUpperCase()}</Text>
              </View>
            )}
            <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "600" }}>Story by @{slide.repostAttribution.username}</Text>
          </TouchableOpacity>
        )}

        {/* Gradients approximated with flat semi-transparent overlays —
            RN has no linear-gradient CSS; swap in react-native-linear-gradient
            (already in your package.json) for a closer visual match. */}
        <View style={S.topGradient} pointerEvents="none" />
        <View style={S.bottomGradient} pointerEvents="none" />

        {/* HEADER */}
        <View style={S.header}>
          <TouchableOpacity disabled={isOwn} onPress={goToProfile}>
            <Avatar src={story.userProfile} username={story.username} size={38} style={{ borderWidth: 2, borderColor: "#fff" }} />
          </TouchableOpacity>
          <TouchableOpacity disabled={isOwn} onPress={goToProfile} style={S.headerInfo}>
            <Text style={S.username}>{story.username}</Text>
            <Text style={S.timeText}>
              {isLiveSlide ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={S.liveDot} />
                  <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>LIVE</Text>
                </View>
              ) : formatTimeAgo(slide.createdAt || slide.postedAt || slide.timestamp)}
            </Text>
          </TouchableOpacity>
          {isLiveSlide && liveStatus === "live" && (
            <View style={S.liveViewersBadge}>
              <IonIcon name="eye" size={12} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{isOwn ? formatCount(liveViewers) : "Live"}</Text>
            </View>
          )}
          <TouchableOpacity onPress={close} style={S.closeBtn}><IonIcon name="close" size={24} color="#fff" /></TouchableOpacity>
        </View>

        {/* NAV ZONES */}
        {!isLiveSlide && (
          <>
            <TouchableWithoutFeedback onPress={handlePrev}><View style={S.navLeft} /></TouchableWithoutFeedback>
            <TouchableWithoutFeedback onPress={handleNext}><View style={S.navRight} /></TouchableWithoutFeedback>
          </>
        )}

        <LiveCommentsFeed slideId={slide?.id} />

        {/* BOTTOM BAR */}
        <View style={S.bottom}>
          {isOwn ? (
            <View style={S.ownBottom}>
              {!isLiveSlide && (
                <TouchableOpacity style={S.sendBtn} onPress={() => setShowShareSheet(true)}>
                  <IonIcon name="paper-plane" size={16} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>Send</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={S.viewsBtn} onPress={() => !isLiveSlide && setShowViewers(true)}>
                <IonIcon name="eye" size={16} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                  {isLiveSlide ? formatCount(liveViewers) : formatCount(viewsCount || viewers.length)}
                </Text>
              </TouchableOpacity>
              <View style={S.viewsBtn}>
                <FAIcon name="thumbs-up" size={16} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>{formatCount(likesCount)}</Text>
              </View>
              {!isLiveSlide && (
                <View style={{ position: "relative" }}>
                  <TouchableOpacity style={S.iconBtn} onPress={() => setShowMenu(!showMenu)}>
                    <IonIcon name="ellipsis-vertical" size={18} color="#fff" />
                  </TouchableOpacity>
                  {showMenu && (
                    <View style={S.feedStyleMenu}>
                      <TouchableOpacity style={S.feedMenuItem} onPress={handleHideFromNonFollowers}>
                        <Text style={{ fontSize: 14, color: "#222" }}>{isHidden ? "Show to everyone" : "Hide from non-followers"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[S.feedMenuItem, { borderBottomWidth: 0 }]} onPress={() => handleDelete(slide._id || slide.id)}>
                        <Text style={{ fontSize: 14, color: "#ff3b30" }}>Delete Story</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {isLiveSlide && liveStatus === "live" && (
                <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
                  {LIVE_REACTIONS.map(emoji => (
                    <TouchableOpacity key={emoji} onPress={() => sendReaction(emoji)} style={S.reactionBtn}>
                      <Text style={{ fontSize: 20 }}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={S.otherBottom}>
                <TextInput
                  placeholder={isLiveSlide ? "Say something…" : "Send message..."}
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  value={comment}
                  onChangeText={setComment}
                  onSubmitEditing={handleSendComment}
                  style={S.input}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                />
                <TouchableOpacity onPress={handleLike} style={S.iconBtn}>
                  <View style={S.likeWrap}>
                    <FAIcon name="thumbs-up" size={16} color={liked ? GOLDEN : "#fff"} />
                    <Text style={{ fontSize: 13, color: "#fff" }}>{formatCount(likesCount)}</Text>
                  </View>
                </TouchableOpacity>
                {!isLiveSlide && (
                  <TouchableOpacity onPress={() => setShowShareSheet(true)} style={S.iconBtn}>
                    <IonIcon name="paper-plane-outline" size={20} color="#fff" style={{ transform: [{ rotate: "20deg" }] }} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>

        {showShareSheet && <StoryShareSheet storyId={slide.id} onClose={() => setShowShareSheet(false)} />}

        {showViewers && (
          // ← FIX — this used to be a second <Modal> nested inside the
          // screen's own outer <Modal> (see "return (<Modal ..." above).
          // Stacking two native Modals like that is unreliable in RN:
          // when both try to mount on the same pass — exactly what
          // happens when showViewers starts out true from the
          // notification handoff — the inner one frequently never
          // renders, even though its state is correctly true. Tapping
          // the eye icon manually worked because by then the outer
          // Modal had already finished presenting, so the two mounts
          // weren't racing. Rendering this as a plain absolutely
          // positioned View inside the SAME outer Modal (instead of a
          // second Modal) removes that race entirely.
          <View style={S.sheetRoot}>
            <TouchableOpacity style={S.sheetOverlay} activeOpacity={1} onPress={() => setShowViewers(false)}>
              <TouchableOpacity activeOpacity={1} style={S.sheet} onPress={() => {}}>
                <View style={S.sheetHandle} />
                <View style={[S.sheetHeader, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                  <IonIcon name="eye" size={16} color="#555" />
                  <Text style={S.sheetTitle}>{formatCount(viewers.length)} viewers</Text>
                </View>
                <ScrollView style={S.viewerList}>
                  {viewers.length === 0 ? (
                    <Text style={S.emptyText}>No viewers yet</Text>
                  ) : viewers.map((v, i) => (
                    <TouchableOpacity key={v._id ?? i} style={S.viewerRow} onPress={() => { setShowViewers(false); navigation.navigate("UserProfile", { userId: v._id }); }}>
                      <Avatar src={v.profilePic} username={v.username} size={42} />
                      <Text style={S.viewerName}>{v.username}</Text>
                      {/* ← CHANGED — this app's like glyph everywhere
                          else (the bottom bar's like button) is a
                          thumbs-up, not a heart — matching that here
                          instead of introducing a second "like" symbol. */}
                      {likedByIds.has(v._id) && <FAIcon name="thumbs-up" size={15} color={GOLDEN} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

export default StoryViewer;

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  progressWrap: { flexDirection: "row", gap: 3, position: "absolute", top: 10, left: 10, right: 10, zIndex: 10 },
  progressBg: { flex: 1, height: 2, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  img: { width: "100%", height: "100%", position: "absolute" },
  liveFallback: { backgroundColor: "#111", alignItems: "center", justifyContent: "center", gap: 12 },
  liveFallbackTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  liveFallbackText: { color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center", paddingHorizontal: 32 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#ff3b30" },
  liveViewersBadge: { marginLeft: "auto", marginRight: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 120, backgroundColor: "rgba(0,0,0,0.35)", zIndex: 3 },
  bottomGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 180, backgroundColor: "rgba(0,0,0,0.45)", zIndex: 3 },
  header: { position: "absolute", top: 20, left: 0, right: 0, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  headerInfo: { flexDirection: "column", gap: 1 },
  username: { color: "#fff", fontSize: 14, fontWeight: "600" },
  timeText: { color: "rgba(255,255,255,0.65)", fontSize: 11 },
  closeBtn: { marginLeft: 4 },
  navLeft: { position: "absolute", left: 0, top: 0, width: "40%", height: "100%", zIndex: 5 },
  navRight: { position: "absolute", right: 0, top: 0, width: "60%", height: "100%", zIndex: 5 },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 14, paddingBottom: 32 },
  ownBottom: { flexDirection: "row", alignItems: "center", gap: 10 },
  otherBottom: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, color: "#fff", fontSize: 14 },
  iconBtn: { flexShrink: 0 },
  likeWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: GOLDEN, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 10 },
  viewsBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 24, paddingHorizontal: 18, paddingVertical: 10 },
  reactionBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  feedStyleMenu: { position: "absolute", right: 0, bottom: 50, backgroundColor: "#fff", borderRadius: 14, minWidth: 210, overflow: "hidden", elevation: 8, zIndex: 20 },
  feedMenuItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  // ← NEW — replaces the removed inner <Modal>'s full-screen host now
  // that the viewers sheet is a plain View living inside the outer
  // Modal's own <View style={S.container}> instead of its own Modal.
  sheetRoot: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", width: "100%", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32, maxHeight: "60%" },
  sheetHandle: { width: 36, height: 4, backgroundColor: "#ddd", borderRadius: 4, alignSelf: "center", marginBottom: 14 },
  sheetHeader: { marginBottom: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: "#111" },
  viewerList: { flexGrow: 0 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f8f8f8" },
  viewerName: { flex: 1, fontSize: 14, fontWeight: "600", color: "#111" },
  commentsFeed: { position: "absolute", bottom: 110, left: 14, right: 14, zIndex: 9, gap: 6, maxHeight: 200 },
  commentBubble: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignSelf: "flex-start", maxWidth: "85%" },
  commentUser: { color: GOLDEN, fontSize: 12, fontWeight: "700" },
  commentText: { color: "#fff", fontSize: 13 },
  systemBubble: { backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6 },
  systemText: { color: "rgba(255,255,255,0.65)", fontSize: 11.5, fontStyle: "italic" },
  deniedWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 32 },
  deniedTitle: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 10 },
  deniedText: { color: "rgba(255,255,255,0.6)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  deniedBtn: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", paddingHorizontal: 28, paddingVertical: 10, borderRadius: 24 },
  shareSearchInput: { fontSize: 14, color: "#111", backgroundColor: "#f2f2f2", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 },
  shareCheckbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center", marginLeft: "auto" },
  shareCheckboxChecked: { backgroundColor: GOLDEN, borderWidth: 0 },
  shareSendBtn: { paddingVertical: 12, borderRadius: 12, backgroundColor: GOLDEN, alignItems: "center", marginTop: 10 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 20, fontSize: 14 },
  repostBadge: { position: "absolute", top: 66, alignSelf: "center", zIndex: 6, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12, paddingLeft: 5 },
  emojiFloatWrap: { position: "absolute", bottom: 90, right: 16, zIndex: 12, flexDirection: "column-reverse", gap: 6 },
});