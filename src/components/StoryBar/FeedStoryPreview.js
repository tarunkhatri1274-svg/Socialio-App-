// src/components/StoryBar/FeedStoryPreview.js
//
// ONE shared story preview used by every screen (Home, Explore, ExploreReels,
// Video.js reels, UserProfileVideoPost). Previously each file carried its own
// copy (FeedStoryPreview / ReelStoryPreview).
//
// Props
//   story              { id, username, userProfile, isOwn, slides: [...] }
//   onClose            () => void
//   navigation         react-navigation object
//   onSheetOpen        (bool) => void   — fires when share/viewers sheets open/close
//   initialShowViewers bool             — open Viewers sheet right away
//   initialStoryId     string           — jump to this slide id on open
//   asOverlay          bool             — render as an absolute full-screen View
//                                         instead of a <Modal> (use this when the
//                                         caller already sits inside another
//                                         native window, e.g. Explore's post
//                                         overlay, to avoid nested-Modal flicker)
//
// Progress bar: each segment now fills over time (5s for images, the real
// duration for videos), pauses while a sheet/keyboard/menu is open, and
// auto-advances to the next slide / closes at the end. Past slides are full,
// future slides empty, the current one animates.

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
  Animated,
  Easing,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  InteractionManager,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from "react-native";
import Video from "react-native-video";
import FeatherIcon from "react-native-vector-icons/Feather";
import Icon from "react-native-vector-icons/FontAwesome5";
import Config from "react-native-config";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
} from "react-native-webrtc";
import { apiFetch, useAuth } from "../../api/authToken";
import socket from "../../sockets/Sockets";
import {
  getStoryRuntime,
  subscribeStory,
  pushComment,
  setRuntimeComments,
  setLikeState,
} from "../State/SyncStoryStore";

const API = Config.API_URL;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const IMAGE_STORY_MS = 5000;
const REACTIONS = ["❤️", "😂", "😮", "🔥", "👏"];
const GOLD = "rgb(234,182,118)";

function formatCount(num) {
  const n = Number(num) || 0;
  if (n < 1000) return `${n}`;
  const fmt = (v, s) => {
    const r = Math.floor(v * 10) / 10;
    return `${Number.isInteger(r) ? r : r.toFixed(1)}${s}`;
  };
  if (n < 1_000_000) return fmt(n / 1000, "k");
  if (n < 1_000_000_000) return fmt(n / 1_000_000, "m");
  return fmt(n / 1_000_000_000, "b");
}

function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

function Avatar({ src, username, size = 28 }) {
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (src) return <Image source={{ uri: src }} style={base} />;
  return (
    <View style={[base, { backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" }]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>
        {username?.[0]?.toUpperCase() || "?"}
      </Text>
    </View>
  );
}

function FloatingEmoji({ emoji }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 2000, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
    ]).start();
  }, []);
  return <Animated.Text style={{ fontSize: 22, transform: [{ translateY }], opacity }}>{emoji}</Animated.Text>;
}

/* ── internal drag-to-dismiss bottom sheet ── */
function Sheet({ title, onClose, children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => t.cancel();
  }, []);
  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 2 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.6) {
          Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: false }).start(() => onCloseRef.current());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start(),
    })
  ).current;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={st.sheetOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[st.sheetBox, { transform: [{ translateY }] }]}>
          <View {...pan.panHandlers} style={{ paddingBottom: 4 }}>
            <View style={st.sheetHandle} />
            <View style={st.sheetTitleRow}>
              <Text style={{ fontSize: 15, fontWeight: "700" }}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={st.sheetClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <FeatherIcon name="x" size={20} color="#333" />
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {ready ? children : <ActivityIndicator style={{ marginTop: 30 }} color="#999" />}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ShareStorySheet({ storyId, onClose }) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      apiFetch(`${API}/auth/share/users?q=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((d) => { if (alive && d.success) setUsers(d.users); })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    }, search ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [search]);

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const handleSend = async () => {
    if (!selected.size || !storyId) return;
    setSending(true);
    try {
      const res = await apiFetch(`${API}/auth/share/story`, {
        method: "POST",
        body: JSON.stringify({ storyId, toUserIds: Array.from(selected) }),
      });
      const d = await res.json();
      if (d.success) { setSent(true); setTimeout(onClose, 900); }
    } catch {}
    finally { setSending(false); }
  };

  return (
    <Sheet title={sent ? "Sent!" : "Send to"} onClose={onClose}>
      {!sent && (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
            <View style={st.searchWrap}>
              <FeatherIcon name="search" size={14} color="#999" />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search people…" style={st.searchInput} autoFocus />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <FeatherIcon name="x" size={14} color="#999" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {loading ? (
              <Text style={st.emptyText}>Loading…</Text>
            ) : users.length === 0 ? (
              <Text style={st.emptyText}>No users found</Text>
            ) : (
              users.map((u) => (
                <TouchableOpacity key={u._id} onPress={() => toggle(u._id)} style={st.userRow}>
                  <Avatar src={u.profilePic} username={u.username} size={42} />
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: "600" }}>{u.username}</Text>
                  <View style={[st.checkCircle, selected.has(u._id) && { backgroundColor: GOLD, borderWidth: 0 }]}>
                    {selected.has(u._id) && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <TouchableOpacity
              onPress={handleSend}
              disabled={!selected.size || sending}
              style={[st.sendAllBtn, { opacity: selected.size > 0 && !sending ? 1 : 0.5 }]}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                {sending ? "Sending…" : `Send${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </Sheet>
  );
}

function ViewersSheet({ viewers, onClose, onNavigate }) {
  return (
    <Sheet title={`${formatCount(viewers.length)} viewers`} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
        {viewers.length === 0 ? (
          <Text style={st.emptyText}>No viewers yet</Text>
        ) : (
          viewers.map((v, i) => (
            <TouchableOpacity key={v._id ?? i} onPress={() => onNavigate(v._id)} style={st.userRow}>
              <Avatar src={v.profilePic} username={v.username} size={40} />
              <Text style={{ fontSize: 15, fontWeight: "600" }}>{v.username}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </Sheet>
  );
}

/* ═════════════════════════ main shared component ═════════════════════════ */
export default function FeedStoryPreview({
  story,
  onClose,
  navigation,
  onSheetOpen,
  initialShowViewers = false,
  initialStoryId = null,
  asOverlay = false,
}) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();

  const [slideIndex, setSlideIndex] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [isHidden, setIsHidden] = useState(false);
  const [comment, setComment] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showViewers, setShowViewers] = useState(initialShowViewers);
  const [liveComments, setLiveComments] = useState([]);
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const [accessDenied, setAccessDenied] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0); // ms
  const [restartKey, setRestartKey] = useState(0); // bump to restart the current slide's bar

  const slides = story?.slides || [];
  const slide = slides[slideIndex] || {};
  const isOwn = !!story?.isOwn || (currentUserId && story?.id?.toString() === currentUserId);
  const isLiveSlide = slide?.type === "live" || slide?.isLive === true;
  const isVideo = !isLiveSlide && (slide.type === "video" || slide.image?.includes(".mp4") || slide.image?.includes("video"));

  useEffect(() => { onSheetOpen?.(showShareSheet || showViewers); }, [showShareSheet, showViewers]);

  // hardware back (overlay mode has no <Modal onRequestClose>)
  useEffect(() => {
    if (!asOverlay) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [asOverlay, onClose]);

  // land on the requested slide (or the first one)
  useEffect(() => {
    if (initialStoryId) {
      const idx = slides.findIndex((s) => s.id === initialStoryId);
      setSlideIndex(idx >= 0 ? idx : 0);
    } else {
      setSlideIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  /* ───────────────────────── progress bar ───────────────────────── */
  const progress = useRef(new Animated.Value(0)).current;
  const progressValRef = useRef(0);
  useEffect(() => {
    const id = progress.addListener(({ value }) => { progressValRef.current = value; });
    return () => progress.removeListener(id);
  }, []);

  const handleNextRef = useRef(null);
  const handleNext = useCallback(() => {
    if (slideIndex < slides.length - 1) setSlideIndex((i) => i + 1);
    else onClose();
  }, [slideIndex, slides.length, onClose]);
  handleNextRef.current = handleNext;

  // new slide → reset bar + duration
  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    progressValRef.current = 0;
    if (restartKey === 0 || !isVideo) setVideoDuration(0);
  }, [slideIndex, slide?.id, restartKey]);

  const barPaused =
    showShareSheet || showViewers || showMenu || inputFocused || !!accessDenied;

  // run / resume the fill animation
  useEffect(() => {
    if (!slide?.id || isLiveSlide || barPaused) return;
    if (isVideo && !videoDuration) return; // wait for onLoad to tell us the length
    const total = isVideo ? videoDuration : IMAGE_STORY_MS;
    const remaining = Math.max(total * (1 - progressValRef.current), 0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: remaining,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => { if (finished) handleNextRef.current?.(); });
    return () => anim.stop();
  }, [slide?.id, slideIndex, restartKey, isLiveSlide, isVideo, videoDuration, barPaused]);

  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  /* ───────────────────────── socket / data ───────────────────────── */
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
          if (res.status === 403) { setAccessDenied("not_following"); return; }
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
    const onComment = (payload) => {
      pushComment(slide.id, payload);
      if (REACTIONS.includes(payload.text)) {
        const id = Date.now() + Math.random();
        setFloatingEmojis((prev) => [...prev.slice(-5), { id, emoji: payload.text }]);
        setTimeout(() => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)), 2200);
      }
    };
    socket.on(`story:${slide.id}:likes`, onLikes);
    socket.on(`story:${slide.id}:comment`, onComment);
    return () => {
      socket.off(`story:${slide.id}:likes`, onLikes);
      socket.off(`story:${slide.id}:comment`, onComment);
      unsubscribe();
    };
  }, [slide?.id, isOwn, isLiveSlide]);

  /* ───────────────────────── live (WebRTC) ───────────────────────── */
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

  /* ───────────────────────── actions ───────────────────────── */
  const handlePrev = () => {
    if (slideIndex > 0) setSlideIndex((i) => i - 1);
    else setRestartKey((k) => k + 1); // already on the first slide — restart its bar
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
      } else if (res.status === 403) setAccessDenied("not_following");
    } catch {}
  };

  const sendStoryComment = (text) => {
    socket.emit("storyComment", {
      storyId: slide.id,
      userId: currentUserId,
      username: currentUser?.username,
      text,
    });
  };

  const handleSendComment = () => {
    if (!comment.trim() || !slide?.id || accessDenied) return;
    sendStoryComment(comment);
    setComment("");
  };

  const sendReaction = (emoji) => {
    if (accessDenied || !slide?.id) return;
    sendStoryComment(emoji);
  };

  const handleHideFromNonFollowers = async () => {
    if (!slide?.id) return;
    try {
      const res = await apiFetch(`${API}/stories/hide-from-non-followers/${slide.id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) { setIsHidden(data.isHiddenFromNonFollowers); setShowMenu(false); }
      else Alert.alert("Error", data.message);
    } catch {}
  };

  const handleDelete = async () => {
    if (!slide?.id) return;
    setShowMenu(false);
    const ok = await confirmAsync("Delete this story?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/stories/delete-story/${slide.id}`, { method: "DELETE" });
      if (res.ok) onClose();
    } catch {}
  };

  const goToProfile = (id) => {
    if (!id) return;
    onClose();
    if (id?.toString() === currentUserId) navigation.navigate("MainTabs", { screen: "Profile" });
    else navigation.navigate("UserProfile", { userId: id });
  };

  /* ───────────────────────── render ───────────────────────── */
  if (!story) return null;

  // plain helper (NOT a component) so children aren't remounted on every render
  const wrap = (children) =>
    asOverlay ? (
      <View style={st.fullScreenOverlay}>{children}</View>
    ) : (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>{children}</Modal>
    );

  if (accessDenied) {
    return wrap(
      <>
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[st.card, st.centered]}>
            <Avatar src={story.userProfile} username={story.username} size={56} />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 8 }}>Follow to view this story</Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center", marginTop: 4 }}>
              Only {story.username}'s followers can see this story.
            </Text>
            <TouchableOpacity onPress={onClose} style={st.deniedCloseBtn}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </>
    );
  }

  const openMention = (userId) => {
    if (!userId) return;
    goToProfile(userId);
  };

  return wrap(
    <>
      <View style={st.overlay}>
        <View style={st.card}>
          {/* progress segments — past = full, current = animated, future = empty */}
          {!isLiveSlide && slides.length > 0 && (
            <View style={st.progressWrap}>
              {slides.map((_, i) => (
                <View key={i} style={st.progressBg}>
                  {i < slideIndex ? (
                    <View style={[st.progressFill, { width: "100%" }]} />
                  ) : i === slideIndex ? (
                    <Animated.View style={[st.progressFill, { width: fillWidth }]} />
                  ) : null}
                </View>
              ))}
            </View>
          )}

          <View style={st.header}>
            <Avatar src={story.userProfile} username={story.username} size={28} />
            <Text style={st.username}>{story.username}</Text>
            {isLiveSlide && liveStatus === "live" && (
              <View style={st.liveBadge}>
                <View style={st.liveDot} />
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>LIVE</Text>
              </View>
            )}
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <FeatherIcon name="x" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={st.media}>
            {isLiveSlide ? (
              liveStatus === "live" && liveStream ? (
                <RTCView streamURL={liveStream.toURL()} style={st.mediaEl} objectFit="contain" />
              ) : (
                <View style={{ alignItems: "center", gap: 10 }}>
                  {liveStatus === "denied" && (
                    <>
                      <Text style={{ fontSize: 32 }}>🔒</Text>
                      <Text style={st.liveStatusText}>Follow to watch</Text>
                    </>
                  )}
                  {liveStatus === "ended" && (
                    <>
                      <Text style={{ fontSize: 32 }}>📺</Text>
                      <Text style={st.liveStatusText}>Live has ended</Text>
                    </>
                  )}
                  {(liveStatus === "connecting" || !liveStatus) && (
                    <>
                      <ActivityIndicator size="large" color="#fff" />
                      <Text style={st.liveStatusText}>Connecting to live…</Text>
                    </>
                  )}
                </View>
              )
            ) : slide.image ? (
              isVideo ? (
                <Video
                  key={slide.image}
                  source={{ uri: slide.image }}
                  style={st.mediaEl}
                  resizeMode="contain"
                  repeat
                  muted
                  paused={barPaused}
                  onLoad={(d) => setVideoDuration(Math.max(Math.round((d?.duration || 0) * 1000), 1000))}
                  onError={() => setVideoDuration(IMAGE_STORY_MS)}
                />
              ) : (
                <Image source={{ uri: slide.image }} style={st.mediaEl} resizeMode="contain" />
              )
            ) : (
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No story to show</Text>
            )}

            {/* text overlays + mentions */}
            {!isLiveSlide && (slide.textOverlays?.length > 0 || slide.mentions?.length > 0) && (
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                {(slide.textOverlays || []).map((t, i) => (
                  <View
                    key={`text-${i}`}
                    style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, transform: [{ translateX: -0.5 }, { translateY: -0.5 }], maxWidth: "80%" }}
                  >
                    <Text style={{ color: t.color || "#fff", fontSize: t.fontSize || 18, fontWeight: "700", textAlign: t.align || "center" }}>
                      {t.text}
                    </Text>
                  </View>
                ))}
                {(slide.mentions || []).map((m, i) => (
                  <TouchableOpacity
                    key={`mention-${i}`}
                    onPress={() => openMention(m.user)}
                    style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 18, paddingHorizontal: 9, paddingVertical: 4 }}
                  >
                    <Text style={{ color: "#111", fontSize: 11, fontWeight: "700" }}>@{m.username || "user"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* repost attribution */}
            {!isLiveSlide && slide.repostAttribution?.username && (
              <TouchableOpacity onPress={() => openMention(slide.repostAttribution.user)} style={st.repostBadge}>
                {slide.repostAttribution.profilePic ? (
                  <Image source={{ uri: slide.repostAttribution.profilePic }} style={{ width: 15, height: 15, borderRadius: 8 }} />
                ) : (
                  <View style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" }}>
                      {slide.repostAttribution.username[0]?.toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}>Story by @{slide.repostAttribution.username}</Text>
              </TouchableOpacity>
            )}

            {/* tap zones — always available on non-live slides so single-slide stories can also be tapped to close */}
            {!isLiveSlide && (
              <>
                <TouchableOpacity style={st.navLeft} onPress={handlePrev} activeOpacity={1} />
                <TouchableOpacity style={st.navRight} onPress={handleNext} activeOpacity={1} />
              </>
            )}

            <View style={st.floatZone} pointerEvents="none">
              {floatingEmojis.map((e) => <FloatingEmoji key={e.id} emoji={e.emoji} />)}
            </View>

            {liveComments.length > 0 && (
              <View style={st.commentsFeed} pointerEvents="none">
                {liveComments.map((c, i) => (
                  <View key={i} style={st.commentBubble}>
                    <Text style={st.commentUser}>{c.username}</Text>
                    <Text style={st.commentText}>{c.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {isOwn ? (
            <View style={st.ownBar}>
              <TouchableOpacity onPress={() => setShowShareSheet(true)} style={st.sendBtn}>
                <Icon name="paper-plane" size={14} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Send</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowViewers(true)} style={st.statPill}>
                <Icon name="eye" size={13} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{formatCount(viewers.length)}</Text>
              </TouchableOpacity>
              <View style={st.statPill}>
                <Icon name="thumbs-up" solid size={13} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{formatCount(likesCount)}</Text>
              </View>
              <View style={{ position: "relative", marginLeft: "auto" }}>
                <TouchableOpacity onPress={() => setShowMenu((v) => !v)} style={st.iconBtn}>
                  <Icon name="ellipsis-v" size={16} color="#fff" />
                </TouchableOpacity>
                {showMenu && (
                  <View style={st.dropdown}>
                    <TouchableOpacity onPress={handleHideFromNonFollowers} style={st.dropdownItem}>
                      <Text style={{ fontSize: 14, fontWeight: "500", color: "#222" }}>
                        {isHidden ? "Show to everyone" : "Hide from non-followers"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleDelete} style={[st.dropdownItem, { borderBottomWidth: 0 }]}>
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
                  {REACTIONS.map((emoji) => (
                    <TouchableOpacity key={emoji} onPress={() => sendReaction(emoji)} style={st.reactionBtn}>
                      <Text style={{ fontSize: 20 }}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={st.viewerBar}>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  onSubmitEditing={handleSendComment}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder="Send message..."
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  style={st.input}
                />
                <TouchableOpacity onPress={handleLike} style={st.iconBtn}>
                  <Icon name="thumbs-up" solid size={17} color={liked ? GOLD : "#fff"} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSendComment}
                  disabled={!comment.trim()}
                  style={[st.iconBtn, { opacity: comment.trim() ? 1 : 0.4 }]}
                >
                  <Icon name="paper-plane" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowShareSheet(true)} style={st.iconBtn}>
                  <Icon name="share" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>

      {showShareSheet && <ShareStorySheet storyId={slide.id} onClose={() => setShowShareSheet(false)} />}
      {showViewers && <ViewersSheet viewers={viewers} onClose={() => setShowViewers(false)} onNavigate={goToProfile} />}
    </>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const st = StyleSheet.create({
  fullScreenOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 500, elevation: 500 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 340, height: "70%", maxHeight: 600, backgroundColor: "#000", borderRadius: 16, overflow: "hidden" },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  username: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 },
  media: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" },
  mediaEl: { width: "100%", height: "100%" },
  progressWrap: { flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingTop: 8 },
  progressBg: { flex: 1, height: 2.5, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  navLeft: { position: "absolute", left: 0, top: 0, width: "40%", height: "100%" },
  navRight: { position: "absolute", right: 0, top: 0, width: "60%", height: "100%" },
  ownBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "rgba(0,0,0,0.9)" },
  viewerBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "rgba(0,0,0,0.9)" },
  statPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  iconBtn: { padding: 4 },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: "#fff", fontSize: 13 },
  dropdown: { position: "absolute", bottom: 34, right: 0, backgroundColor: "#fff", borderRadius: 14, minWidth: 200, overflow: "hidden", elevation: 8, zIndex: 20 },
  dropdownItem: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0", backgroundColor: "#fff" },
  floatZone: { position: "absolute", bottom: 12, right: 10, flexDirection: "column-reverse", gap: 6 },
  commentsFeed: { position: "absolute", bottom: 8, left: 8, right: 46, gap: 5, maxHeight: "45%" },
  commentBubble: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", gap: 5, alignSelf: "flex-start", maxWidth: "90%" },
  commentUser: { color: GOLD, fontSize: 10, fontWeight: "700" },
  commentText: { color: "#fff", fontSize: 12 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: GOLD, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, marginRight: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveStatusText: { color: "rgba(255,255,255,0.75)", fontSize: 13, textAlign: "center", paddingHorizontal: 20 },
  repostBadge: { position: "absolute", top: 8, left: "50%", transform: [{ translateX: -60 }], flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 16, paddingLeft: 3, paddingRight: 9, paddingVertical: 3 },
  reactionBtn: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  deniedCloseBtn: { marginTop: 10, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", paddingHorizontal: 22, paddingVertical: 8, borderRadius: 20 },

  // sheets
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)", justifyContent: "flex-end", zIndex: 999, elevation: 999 },
  sheetBox: { width: "100%", height: SCREEN_HEIGHT * 0.72, maxHeight: SCREEN_HEIGHT * 0.85, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, zIndex: 999, elevation: 999 },
  sheetHandle: { width: 48, height: 5, backgroundColor: "#ccc", borderRadius: 10, alignSelf: "center", marginTop: 12, marginBottom: 8 },
  sheetTitleRow: { alignItems: "center", justifyContent: "center", minHeight: 48, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  sheetClose: { position: "absolute", right: 16, top: 0, padding: 4 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 32, fontSize: 15 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  checkCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  sendAllBtn: { width: "100%", paddingVertical: 12, borderRadius: 12, backgroundColor: GOLD, alignItems: "center" },
});