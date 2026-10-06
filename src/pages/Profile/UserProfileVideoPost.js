import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  FlatList,
  TextInput,
  Modal,
  Alert,
  Animated,
  Linking,
  StyleSheet,
  Dimensions,
  Platform,
  PermissionsAndroid,
  KeyboardAvoidingView,
  useWindowDimensions,
} from "react-native";
import Video, { ViewType } from "react-native-video";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
  
} from "react-native-webrtc";
import FeatherIcon from "react-native-vector-icons/Feather";
import FA5Icon from "react-native-vector-icons/FontAwesome5";
import IonIcon from "react-native-vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useRoute, useIsFocused } from "@react-navigation/native";
import Config from "react-native-config";
import socket, { joinPostRoom, leavePostRoom } from "../../sockets/Sockets";
import CommentSection from "../../components/PostCard/CommentSection";
import ShareSheet from "../../components/PostCard/ShareSheet";
import {
  getStoryRuntime,
  subscribeStory,
  pushComment,
  setRuntimeComments,
  setLikeState,
} from "../../components/State/SyncStoryStore";
import { isPostSaved, toggleSavedPost, subscribeSavedPosts } from "../../components/State/SavedPostStore";
import { apiFetch, getCachedUser, useAuth } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL; // swap for your RN env config
const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");

function dedupeById(list) {
  const seen = new Set();
  return (list || []).filter((u) => {
    const id = (u?._id ?? u)?.toString();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
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

function shareCount(shares) {
  if (Array.isArray(shares)) return shares.length;
  if (typeof shares === "number") return shares;
  return 0;
}

// ── Likes summary line ──────────────────────────────────────────────────
function LikesSummary({ likedByUsers, likesCount, hideLikeCount, isOwner, onOpen }) {
  if (hideLikeCount && !isOwner) return null;
  if (!likesCount) return null;
  const first = likedByUsers?.[0];
  const others = likesCount - (first ? 1 : 0);

  return (
    <TouchableOpacity onPress={onOpen}>
      <Text style={S.likesSummary}>
        {first ? (
          <>
            Liked by <Text style={{ fontWeight: "700" }}>{first.username}</Text>
            {others > 0 && <> and {formatCount(others)} other{others > 1 ? "s" : ""}</>}
          </>
        ) : (
          <>{formatCount(likesCount)} like{likesCount > 1 ? "s" : ""}</>
        )}
      </Text>
    </TouchableOpacity>
  );
}

function Avatar({ src, username, size = 35, style: extra = {}, onPress }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const base = { width: size, height: size, borderRadius: size / 2 };
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress}>
      {src
        ? <Image source={{ uri: src }} style={[base, extra]} />
        : <View style={[base, extra, avatarFallback]}>
            <Text style={{ color: "#fff", fontWeight: "bold", fontSize: size * 0.4 }}>{letter}</Text>
          </View>
      }
    </Wrapper>
  );
}
const avatarFallback = { backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" };

// ── STORY PREVIEW ───────────────────────────────────────────────────────
function ReelStoryPreview({ story, onClose, navigation }) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();

  const [slideIndex, setSlideIndex] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [isHidden, setIsHidden] = useState(false);
  const [comment, setComment] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [liveComments, setLiveComments] = useState([]);
  const [accessDenied, setAccessDenied] = useState(null);

  const slides = story?.slides || [];
  const slide = slides[slideIndex] || {};
  const isOwn = !!story?.isOwn;
  const isLiveSlide = slide?.type === "live" || slide?.isLive === true;
  const isVideo = slide.type === "video" || slide.image?.includes(".mp4") || slide.image?.includes("video");

  const [liveStatus, setLiveStatus] = useState(null);
  const [liveStreamURL, setLiveStreamURL] = useState(null);
  const livePcRef = useRef(null);

  // ── WebRTC live viewing via react-native-webrtc ─────────────────────
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

    pc.onaddstream = (event) => {
      if (event.stream) {
        setLiveStreamURL(event.stream.toURL());
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

  useEffect(() => { setSlideIndex(0); }, [story?.id]);

  useEffect(() => {
    if (!slide?.id) return;
    socket.emit("joinStory", { storyId: slide.id, viewerId: currentUserId });
    return () => { socket.emit("leaveStory", slide.id); };
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
            const likedNow = (data.likedBy ?? []).some(u => u._id?.toString() === currentUserId);
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
            if (cData?.success && Array.isArray(cData.comments)) {
              setRuntimeComments(slide.id, cData.comments);
            }
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

  const handlePrev = () => { if (slideIndex > 0) setSlideIndex(i => i - 1); };
  const handleNext = () => { if (slideIndex < slides.length - 1) setSlideIndex(i => i + 1); else onClose(); };

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

  const handleSendComment = () => {
    if (!comment.trim() || !slide?.id || accessDenied) return;
    socket.emit("storyComment", {
      storyId: slide.id,
      userId: currentUserId,
      username: currentUser.username,
      text: comment,
    });
    setComment("");
  };

  const handleHideFromNonFollowers = async () => {
    if (!slide?.id) return;
    try {
      const res = await apiFetch(`${API}/stories/hide-from-non-followers/${slide.id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) { setIsHidden(data.isHiddenFromNonFollowers); setShowMenu(false); }
      else Alert.alert(data.message);
    } catch {}
  };

  const handleDelete = () => {
    if (!slide?.id) return;
    Alert.alert("Delete story", "Delete this story?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            const res = await apiFetch(`${API}/stories/delete-story/${slide.id}`, { method: "DELETE" });
            if (res.ok) onClose();
          } catch {}
        },
      },
    ]);
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
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <TouchableOpacity style={rp.overlay} activeOpacity={1} onPress={onClose}>
          <View style={[rp.card, { alignItems: "center", justifyContent: "center" }]}>
            <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 24 }}>
              <Avatar src={story.userProfile} username={story.username} size={56} />
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 8 }}>Follow to view this story</Text>
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center" }}>
                Only {story.username}'s followers can see this story.
              </Text>
              <TouchableOpacity onPress={onClose} style={{ marginTop: 10, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", paddingHorizontal: 22, paddingVertical: 8, borderRadius: 20 }}>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={rp.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={rp.card} onPress={() => {}}>

          {slides.length > 1 && (
            <View style={rp.progressWrap}>
              {slides.map((_, i) => (
                <View key={i} style={rp.progressBg}>
                  <View style={[rp.progressFill, { width: i <= slideIndex ? "100%" : "0%" }]} />
                </View>
              ))}
            </View>
          )}

          <View style={rp.header}>
            <Avatar src={story.userProfile} username={story.username} size={28} />
            <Text style={rp.username}>{story.username}</Text>
            <TouchableOpacity onPress={onClose} style={rp.closeBtn}><FeatherIcon name="x" size={18} color="#fff" /></TouchableOpacity>
          </View>

          <View style={rp.media}>
            {isLiveSlide ? (
              liveStatus === "live" && liveStreamURL ? (
                <RTCView streamURL={liveStreamURL} style={rp.mediaEl} objectFit="contain" />
              ) : (
                <View style={{ alignItems: "center", gap: 10 }}>
                  {liveStatus === "denied" && (
                    <>
                      <Text style={{ fontSize: 32 }}>🔒</Text>
                      <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Follow to watch</Text>
                    </>
                  )}
                  {liveStatus === "ended" && (
                    <>
                      <Text style={{ fontSize: 32 }}>📺</Text>
                      <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Live has ended</Text>
                    </>
                  )}
                  {(liveStatus === "connecting" || !liveStatus) && (
                    <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Connecting to live…</Text>
                  )}
                </View>
              )
            ) : slide.image ? (
              isVideo
                ? <Video source={{ uri: slide.image }} style={rp.mediaEl} resizeMode="contain" repeat muted paused={false} viewType={ViewType.TEXTURE} />
                : <Image source={{ uri: slide.image }} style={rp.mediaEl} resizeMode="contain" />
            ) : (
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No story to show</Text>
            )}

            {/* text overlays + mentions */}
            {!isLiveSlide && (slide.textOverlays?.length > 0 || slide.mentions?.length > 0) && (
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                {(slide.textOverlays || []).map((t, i) => (
                  <View key={`text-${i}`} style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, transform: [{ translateX: -50 }, { translateY: -50 }], maxWidth: "80%" }}>
                    <Text style={{ color: t.color || "#fff", fontSize: t.fontSize || 18, fontWeight: "700", textAlign: t.align || "center" }}>{t.text}</Text>
                  </View>
                ))}
                {(slide.mentions || []).map((m, i) => (
                  <TouchableOpacity
                    key={`mention-${i}`}
                    onPress={() => { if (!m.user) return; onClose(); if (m.user?.toString() === currentUserId) { navigation.navigate("MainTabs", { screen: "Profile" }); } else { navigation.navigate("UserProfile", { userId: m.user }); } }}
                    style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, transform: [{ translateX: -50 }, { translateY: -50 }], backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 18, paddingHorizontal: 9, paddingVertical: 4 }}
                  >
                    <Text style={{ color: "#111", fontSize: 11, fontWeight: "700" }}>@{m.username || "user"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* repost attribution */}
            {!isLiveSlide && slide.repostAttribution?.username && (
              <TouchableOpacity
                onPress={() => { if (!slide.repostAttribution.user) return; onClose(); if (slide.repostAttribution.user?.toString() === currentUserId) { navigation.navigate("MainTabs", { screen: "Profile" }); } else { navigation.navigate("UserProfile", { userId: slide.repostAttribution.user }); } }}
                style={{ position: "absolute", top: 6, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, paddingVertical: 3, paddingHorizontal: 8 }}
              >
                {slide.repostAttribution.profilePic ? (
                  <Image source={{ uri: slide.repostAttribution.profilePic }} style={{ width: 15, height: 15, borderRadius: 8 }} />
                ) : (
                  <View style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" }}>{slide.repostAttribution.username[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}>Story by @{slide.repostAttribution.username}</Text>
              </TouchableOpacity>
            )}

            {slides.length > 1 && !isLiveSlide && (
              <>
                <TouchableOpacity onPress={handlePrev} style={rp.navLeft} />
                <TouchableOpacity onPress={handleNext} style={rp.navRight} />
              </>
            )}

            {liveComments.length > 0 && (
              <View style={rp.commentsFeed} pointerEvents="none">
                {liveComments.map((c, i) => (
                  <View key={i} style={rp.commentBubble}>
                    <Text style={rp.commentUser}>{c.username} </Text>
                    <Text style={rp.commentText}>{c.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {isOwn ? (
            <View style={rp.ownBar}>
              <TouchableOpacity onPress={() => setShowViewers(true)} style={rp.statPill}>
                <Text style={{ color: "#fff" }}>{viewers.length} views</Text>
              </TouchableOpacity>
              <View style={rp.statPill}>
                <FA5Icon name="heart" size={13} color="#fff" solid />
                <Text style={{ color: "#fff" }}>{formatCount(likesCount)}</Text>
              </View>
              <View style={{ position: "relative", marginLeft: "auto" }}>
                <TouchableOpacity onPress={() => setShowMenu(v => !v)} style={rp.iconBtn}>
                  <FeatherIcon name="more-vertical" size={16} color="#fff" />
                </TouchableOpacity>
                {showMenu && (
                  <View style={[rp.menu, { bottom: 34, right: 0 }]}>
                    <TouchableOpacity onPress={handleHideFromNonFollowers} style={rp.menuItemBtn}>
                      <Text style={rp.menuItemText}>{isHidden ? "Show to everyone" : "Hide from non-followers"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleDelete} style={[rp.menuItemBtn, { borderBottomWidth: 0 }]}>
                      <Text style={[rp.menuItemText, { color: "#e53935" }]}>Delete Story</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <View style={rp.viewerBar}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                onSubmitEditing={handleSendComment}
                placeholder="Send message..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                style={rp.input}
              />
              <TouchableOpacity onPress={handleLike} style={rp.iconBtn}>
                {liked ? <FA5Icon name="heart" size={17} color="#e53935" solid /> : <FA5Icon name="heart" size={17} color="#fff" />}
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSendComment} disabled={!comment.trim()} style={[rp.iconBtn, { opacity: comment.trim() ? 1 : 0.4 }]}>
                <IonIcon name="paper-plane" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>

      {showViewers && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowViewers(false)}>
          <TouchableOpacity style={rp.viewersOverlay} activeOpacity={1} onPress={() => setShowViewers(false)}>
            <TouchableOpacity activeOpacity={1} style={rp.viewersBox} onPress={() => {}}>
              <View style={rp.viewersHandle} />
              <Text style={rp.viewersHeader}>{viewers.length} viewers</Text>
              <ScrollView>
                {viewers.length === 0 ? (
                  <Text style={{ textAlign: "center", color: "#aaa", padding: 20 }}>No viewers yet</Text>
                ) : viewers.map((v, i) => (
                  <TouchableOpacity key={v._id ?? i} onPress={() => goToViewerProfile(v._id)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Avatar src={v.profilePic} username={v.username} size={40} />
                    <Text style={{ fontSize: 15, fontWeight: "600" }}>{v.username}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </Modal>
  );
}

// ── Co-author names ─────────────────────────────────────────────────────
// FIX: only used for the 1-2 person case now; see CoAuthorRow.
function CoAuthorNames({ people, onNavigate }) {
  const NameSpan = ({ p }) => (
    <Text onPress={() => onNavigate(p._id)}>{p.username || "Unknown"}</Text>
  );

  if (people.length === 1) return <NameSpan p={people[0]} />;
  return <>{<NameSpan p={people[0]} />} and {<NameSpan p={people[1]} />}</>;
}

// FIX: 1-2 collaborators -> show every name (as before). 3+ collaborators ->
// show "first with N others"; tapping "N others" opens the CollabListSheet
// (same pattern as the likers/viewers sheets) with every collaborator listed
// and navigable, instead of cramming every username inline.
function CoAuthorRow({ author, acceptedCollaborators, onNavigate, onOpenCollabList }) {
  const people = [author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean);

  if (people.length <= 1) {
    return (
      <>
        <Avatar src={author?.profilePic} username={author?.username} size={40} style={{ borderWidth: 2, borderColor: "#fff" }} onPress={() => onNavigate(author?._id)} />
        <Text style={[S.username, { marginLeft: 10 }]} onPress={() => onNavigate(author?._id)}>{author?.username}</Text>
      </>
    );
  }

  if (people.length === 2) {
    return (
      <>
        <View style={{ flexDirection: "row" }}>
          {people.map((p, i) => (
            <Avatar key={p._id ?? i} src={p.profilePic} username={p.username} size={40}
              style={i === 0 ? { borderWidth: 2, borderColor: "#fff" } : { borderWidth: 2, borderColor: "#fff", marginLeft: -14 }}
              onPress={() => onNavigate(p._id)} />
          ))}
        </View>
        <Text style={[S.username, { marginLeft: 10 }]}>
          <CoAuthorNames people={people} onNavigate={onNavigate} />
        </Text>
      </>
    );
  }

  // 3+ collaborators: "first with N others", "N others" opens the sheet
  const first = people[0];
  const remaining = people.length - 1;
  return (
    <>
      <View style={{ flexDirection: "row" }}>
        {people.slice(0, 3).map((p, i) => (
          <Avatar key={p._id ?? i} src={p.profilePic} username={p.username} size={40}
            style={i === 0 ? { borderWidth: 2, borderColor: "#fff" } : { borderWidth: 2, borderColor: "#fff", marginLeft: -14 }}
            onPress={() => onNavigate(p._id)} />
        ))}
      </View>
      <Text style={[S.username, { marginLeft: 10 }]}>
        <Text onPress={() => onNavigate(first?._id)}>{first?.username || "Unknown"}</Text>
        {" "}with{" "}
        <Text style={{ textDecorationLine: "underline" }} onPress={() => onOpenCollabList?.()}>
          {remaining} other{remaining > 1 ? "s" : ""}
        </Text>
      </Text>
    </>
  );
}

// ── Caption with "...more" ──────────────────────────────────────────────
function CaptionText({ text, limit = 80 }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text style={S.caption}>
        {text}
        {isLong && <Text onPress={() => setExpanded(false)} style={S.moreBtn}> less</Text>}
      </Text>
    );
  }
  return (
    <Text style={S.caption}>
      {text.slice(0, limit).trimEnd()}...
      <Text onPress={() => setExpanded(true)} style={S.moreBtn}> more</Text>
    </Text>
  );
}

// ── Tags Row ─────────────────────────────────────────────────────────────
function TagsRow({ tags, postId, isOwner, onTagsUpdate }) {
  const [tagInput, setTagInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const navigation = useNavigation();

  const addTag = async () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "_");
    if (!t) return;
    try {
      const res = await apiFetch(`${API}/auth/add-tag/${postId}`, { method: "PATCH", body: JSON.stringify({ tag: t }) });
      const data = await res.json();
      if (data.success) { onTagsUpdate(data.tags); setTagInput(""); setShowInput(false); }
    } catch {}
  };

  const removeTag = async (tag) => {
    try {
      const res = await apiFetch(`${API}/auth/remove-tag/${postId}`, { method: "PATCH", body: JSON.stringify({ tag }) });
      const data = await res.json();
      if (data.success) onTagsUpdate(data.tags);
    } catch {}
  };

  const goToTaggedUser = async (tag) => {
    try {
      const res = await apiFetch(`${API}/auth/search?q=${encodeURIComponent(tag)}`);
      if (!res.ok) return;
      const data = await res.json();
      const results = Array.isArray(data) ? data : data.users || [];
      const match = results.find(u => u.username?.toLowerCase() === tag.toLowerCase());
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

  if (!tags?.length && !isOwner) return null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
      {tags?.map(t => (
        <View key={t} style={S.tagChip}>
          <Text onPress={() => goToTaggedUser(t)} style={{ color: "#ffd28a" }}>#{t}</Text>
          {isOwner && (
            <TouchableOpacity onPress={() => removeTag(t)} style={{ marginLeft: 3 }}>
              <FeatherIcon name="x" size={10} color="#ffd28a" />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {isOwner && (
        showInput ? (
          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            <TextInput
              value={tagInput} onChangeText={setTagInput}
              onSubmitEditing={addTag}
              placeholder="tag..." placeholderTextColor="rgba(255,255,255,0.5)"
              autoFocus
              style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", backgroundColor: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, width: 80 }}
            />
            <TouchableOpacity onPress={addTag} style={S.addTagBtn}><Text style={{ color: "#fff" }}>+</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowInput(false)}><FeatherIcon name="x" size={12} color="#ddd" /></TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setShowInput(true)} style={S.addTagBtn}><Text style={{ color: "#fff", fontSize: 12 }}>+ tag</Text></TouchableOpacity>
        )
      )}
    </View>
  );
}

// ── Collaborators Row ────────────────────────────────────────────────────
function CollabRow({ collaborators, postId, isOwner, onCollabUpdate }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const timer = useRef(null);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/auth/search?q=${val}`);
        if (!res.ok) { setResults([]); return; }
        const data = await res.json();
        setResults(Array.isArray(data) ? data : data.users || []);
      } catch (err) {
        console.error("[collab-search] failed:", err.message);
      }
    }, 400);
  };

  const addCollab = async (userId) => {
    try {
      const res = await apiFetch(`${API}/auth/add-collaborator/${postId}`, { method: "PATCH", body: JSON.stringify({ userId }) });
      const data = await res.json();
      if (data.success) { onCollabUpdate(data.collaborators); setSearch(""); setResults([]); setShowSearch(false); }
      else if (data.message) Alert.alert(data.message);
    } catch {}
  };

  if (!isOwner) return null;

  return (
    <View style={{ marginTop: 8 }}>
      {showSearch ? (
        <View>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
            <FeatherIcon name="search" size={12} color="#ddd" />
            <TextInput
              value={search} onChangeText={handleSearch}
              placeholder="Invite a collaborator..." placeholderTextColor="rgba(255,255,255,0.5)"
              autoFocus
              style={{ flex: 1, fontSize: 13, color: "#fff" }}
            />
            <TouchableOpacity onPress={() => { setShowSearch(false); setSearch(""); setResults([]); }}><FeatherIcon name="x" size={12} color="#ddd" /></TouchableOpacity>
          </View>
          {results.length > 0 && (
            <View style={{ backgroundColor: "#1c1c1c", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 10, marginTop: 4, overflow: "hidden" }}>
              {results
                .filter(u => !collaborators.some(c => c.user?._id === u._id && c.status !== "declined"))
                .map(u => {
                  const declined = collaborators.some(c => c.user?._id === u._id && c.status === "declined");
                  return (
                    <TouchableOpacity key={u._id} onPress={() => addCollab(u._id)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.08)" }}>
                      <Avatar src={u.profilePic} username={u.username} size={28} />
                      <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>{u.username}</Text>
                      {declined && <Text style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>declined — invite again</Text>}
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity onPress={() => setShowSearch(true)} style={[S.addTagBtn, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
          <FeatherIcon name="users" size={11} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12 }}>+ invite collaborator</Text>
        </TouchableOpacity>
      )}
      {collaborators.some(c => c.status === "pending") && (
        <Text style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>
          {collaborators.filter(c => c.status === "pending").map(c => c.user?.username).join(", ")} invited — waiting for them to accept.
        </Text>
      )}
    </View>
  );
}

// ── Single reel card ────────────────────────────────────────────────────
function ProfileVideoCard({ p = {}, onBlock, onDeleted, isOwner, isVisible: isVisibleProp, pendingSheet = null }) {
  const navigation = useNavigation();
  const [, forceRerender] = useState(0);

  // FIX — isVisibleProp only tracks which item is centered in the
  // FlatList; it has no idea whether THIS screen itself still has
  // navigation focus. Without this, tapping a commenter's avatar (which
  // pushes UserProfile on top, leaving this reel screen mounted
  // underneath) left the video "visible" as far as this component was
  // concerned, so its audio kept playing in the background the whole
  // time you were on another screen. Combining with useIsFocused stops
  // it the instant you navigate away and resumes it when you come back.
  const isScreenFocused = useIsFocused();
  const isVisible = isVisibleProp && isScreenFocused;

  const { user: currentUser } = useAuth();
  const MY_ID = (currentUser?._id || currentUser?.id)?.toString();

  const authorId = p?.author?._id || p?.author;

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
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flashPause, setFlashPause] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isHidden, setIsHidden] = useState(p?.isHiddenFromNonFollowers || false);
  const [isNotInterested, setIsNotInterested] = useState(p?.isNotInterested || false);
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [comments, setComments] = useState(p?.comments ?? []);
  const [commentText, setCommentText] = useState("");
  const [likerSearch, setLikerSearch] = useState("");
  const [tags, setTags] = useState(p?.tags ?? []);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);
  const [removedFromView, setRemovedFromView] = useState(false);
  const [downloadCount, setDownloadCount] = useState(p?.downloadsCount || p?.downloads?.length || 0);
  const isDownloadingRef = useRef(false);
  const [sharesCount, setSharesCount] = useState(shareCount(p?.shares) ?? p?.sharesCount ?? 0);
  // ← NEW — same pattern as Post.js's PostCard / TextPostView.js's PostCard.
  const [highlightCommentId, setHighlightCommentId] = useState(null);
  const [highlightReplyId, setHighlightReplyId] = useState(null);
  const commentsScrollRef = useRef(null);
  // ← FIXED — was a plain boolean (applied-once-ever); see Post.js's
  // PostCard for the full reasoning. Track WHICH sheet request was last
  // applied instead, so a genuinely new notification for this same reel
  // still gets applied even without a remount.
  const appliedSheetKeyRef = useRef(null);

  useEffect(() => {
    if (!pendingSheet || !p?._id) return;
    if (pendingSheet.targetId?.toString() !== p._id?.toString()) return;
    const key = `${pendingSheet.sheet}:${pendingSheet.commentId}:${pendingSheet.replyId}`;
    if (appliedSheetKeyRef.current === key) return;
    appliedSheetKeyRef.current = key;
    if (pendingSheet.sheet === "likes") setShowLikers(true);
    if (pendingSheet.sheet === "comments") {
      setShowComments(true);
      setHighlightCommentId(pendingSheet.commentId || null);
      setHighlightReplyId(pendingSheet.replyId || null);
    }
  }, [pendingSheet, p?._id]);

  const [viewsCount, setViewsCount] = useState(p?.views?.length || 0);
  const [viewedByUsers, setViewedByUsers] = useState([]);
  const [showViews, setShowViews] = useState(false);
  const [viewerSearch, setViewerSearch] = useState("");
  const hasRecordedView = useRef(false);

  // ── NEW: collaborator list sheet (mirrors likers/viewers sheets)
  const [showCollabList, setShowCollabList] = useState(false);
  const [collabSearch, setCollabSearch] = useState("");

  const [story, setStory] = useState(null);
  const [showStoryPreview, setShowStoryPreview] = useState(false);
  const hasStory = !!story && story.slides.length > 0;

  const likeBurstAnim = useRef(new Animated.Value(0)).current;
  const [showLikeBurst, setShowLikeBurst] = useState(false);
  const flashTimer = useRef(null);
  const tapTimeoutRef = useRef(null);
  const lastTapRef = useRef(0);

  const username = p?.author?.username || "user";
  const profilePic = p?.author?.profilePic;
  const caption = p?.caption || p?.desc || "";

  useEffect(() => {
    if (!p?._id) return;
    joinPostRoom(p._id);
    return () => leavePostRoom(p._id);
  }, [p?._id]);

  useEffect(() => {
    if (!p?._id) return;

    const fetchLikers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/likers/${p._id}`);
        const data = await res.json();
        if (data.success) {
          setLikedByUsers(dedupeById(data.likedBy ?? []));
          setLikesCount(data.totalLikes ?? 0);
          setLiked(dedupeById(data.likedBy ?? []).some(u => u._id === MY_ID));
        }
      } catch {}
    };
    fetchLikers();

    const fetchComments = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-comment/${p._id}`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch {}
    };
    fetchComments();

    const fetchViews = async () => {
      try {
        const res = await apiFetch(`${API}/auth/views/posts/${p._id}/views`);
        const data = await res.json();
        if (res.ok) {
               setViewedByUsers(dedupeById(data.views ?? []));
      setViewsCount(dedupeById(data.views ?? []).length);
        }
      } catch {}
    };
    fetchViews();

    const fetchCollaborators = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-post/${p._id}`);
        const data = await res.json();
        if (data.success) setCollaborators(data.post.collaborators ?? []);
      } catch {}
    };
    fetchCollaborators();

    const onLikes = ({ totalLikes, likedBy }) => { setLikesCount(totalLikes); if (likedBy) { setLikedByUsers(dedupeById(likedBy)); setLiked(dedupeById(likedBy).some(u => u._id === MY_ID)); } };
    const onNewComment = ({ comment }) => setComments(prev => prev.some(c => c._id === comment._id) ? prev : [...prev, comment]);
    const onDelComment = ({ commentId }) => setComments(prev => prev.filter(c => c._id !== commentId));
    const onViews = ({ totalViews }) => setViewsCount(totalViews);

    const onCollabResponded = ({ postId }) => {
      if (postId !== p._id) return;
      (async () => {
        try {
          const res = await apiFetch(`${API}/auth/get-posts/${authorId}`);
          const data = await res.json();
          if (!data.success) return;
          const updated = data.posts.find(post => post._id === p._id);
          if (updated) setCollaborators(updated.collaborators ?? []);
        } catch {}
      })();
    };

    const onPostDeletedForMe = ({ postId }) => {
      if (postId === p._id) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      }
    };

    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== p._id) return;
      setCollaborators(prev => prev.filter(c => (c.user?._id ?? c.user)?.toString() !== userId));
    };
    const onShareCount = ({ postId, totalShares }) => { if (postId === p._id && totalShares != null) setSharesCount(totalShares); };

    socket.on(`post:${p._id}:likes`, onLikes);
    socket.on(`post:${p._id}:newComment`, onNewComment);
    socket.on(`post:${p._id}:commentDeleted`, onDelComment);
    socket.on("commentDeleted", onDelComment);
    socket.on(`post:${p._id}:views`, onViews);
    socket.on("collabResponded", onCollabResponded);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("collabRemoved", onCollabRemoved);
    socket.on("postShared", onShareCount);
    return () => {
      socket.off(`post:${p._id}:likes`, onLikes);
      socket.off(`post:${p._id}:newComment`, onNewComment);
      socket.off(`post:${p._id}:commentDeleted`, onDelComment);
      socket.off("commentDeleted", onDelComment);
      socket.off(`post:${p._id}:views`, onViews);
      socket.off("collabResponded", onCollabResponded);
      socket.off("postDeleted", onPostDeletedForMe);
      socket.off("collabRemoved", onCollabRemoved);
      socket.off("postShared", onShareCount);
    };
  }, [p?._id, authorId, MY_ID]);

  const fetchStory = useCallback(async () => {
    if (!authorId) { setStory(null); return; }
    try {
      const res = await apiFetch(`${API}/stories/get-user-stories/${authorId}`);
      const data = await res.json();
      if (!data.success || !data.stories?.length) { setStory(null); return; }
      setStory({
        id: authorId.toString(),
        username,
        userProfile: profilePic || "",
        isOwn: authorId.toString() === MY_ID,
        slides: data.stories.map((s) => ({
          id: s._id,
          image: s.media?.url || "",
          type: s.media?.type || s.storyType,
          likes: s.likesCount || 0,
          isLive: s.storyType === "live",
          liveRoomId: s.liveRoomId || null,
          authorId: authorId.toString(),
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
  }, [authorId, username, profilePic, MY_ID]);

  useEffect(() => { fetchStory(); }, [fetchStory]);

  useEffect(() => {
    if (!authorId) return;
    const aidStr = authorId.toString();
    const handler = (payload) => {
      const aid = payload?.authorId;
      if (!aid || aid === aidStr) fetchStory();
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
  }, [authorId, fetchStory]);

  // ── play/pause driven by isVisible prop (from FlatList's
  // onViewableItemsChanged), replacing the web IntersectionObserver
  useEffect(() => {
    if (!isVisible) { setPaused(false); return; }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !p?._id || hasRecordedView.current) return;
    hasRecordedView.current = true;
    (async () => {
      try {
        await apiFetch(`${API}/auth/views/posts/${p._id}/views`, { method: "POST" });
      } catch {}
    })();
  }, [isVisible, p?._id]);

  useEffect(() => {
    const unsub = subscribeSavedPosts((postId, savedState) => {
      if (postId === p?._id) setSaved(savedState);
    });
    return unsub;
  }, [p?._id]);

  // ── cleanup any pending tap/flash timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(tapTimeoutRef.current);
      clearTimeout(flashTimer.current);
    };
  }, []);

  const toggleSave = () => toggleSavedPost(p);

  const performToggleLike = async () => {
    try {
      const res = await apiFetch(`${API}/auth/like/${p._id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikesCount(data.totalLikes);
        if (data.likedBy) setLikedByUsers(data.likedBy);
      }
    } catch (err) { console.log(err); }
  };

  const handleToggleLike = () => performToggleLike();

  const triggerLikeBurst = () => {
    if (!liked) performToggleLike();
    setShowLikeBurst(true);
    likeBurstAnim.setValue(0);
    Animated.sequence([
      Animated.timing(likeBurstAnim, { toValue: 1, duration: 210, useNativeDriver: true }),
      Animated.timing(likeBurstAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(likeBurstAnim, { toValue: 0, duration: 210, useNativeDriver: true }),
    ]).start(() => setShowLikeBurst(false));
  };

  // ── Single tap = play/pause, double tap = like burst. The single-tap
  // delay is intentionally DOUBLE_TAP_WINDOW + 20 (not less) so its
  // timeout can never fire before a genuine second tap's full detection
  // window has closed — otherwise you'd get both a pause/unpause AND a
  // like firing from what the user intended as a plain double-tap.
  const DOUBLE_TAP_WINDOW = 300;

  const handleVideoTap = () => {
    console.log("[tap]", Date.now());
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_WINDOW) {
      clearTimeout(tapTimeoutRef.current);
      lastTapRef.current = 0;
      triggerLikeBurst();
      return;
    }
    lastTapRef.current = now;
    tapTimeoutRef.current = setTimeout(() => {
      setPaused(prev => !prev);
      setFlashPause(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashPause(false), 500);
    }, DOUBLE_TAP_WINDOW + 20); // always fires after the double-tap window closes
  };

  const goToProfile = (id) => {
    if (!id) return;
    // FIX: tapping your own name/avatar (as author, collaborator, or
    // liker/viewer/tag) used to open the generic "UserProfile" viewer
    // with your own id instead of your real Profile tab.
    if (id?.toString() === MY_ID) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId: id });
    }
  };

  const handleAvatarPress = () => {
    if (hasStory) setShowStoryPreview(true);
    else goToProfile(authorId);
  };

  // ── RN has no browser download; open the URL so the OS/browser can
  // handle saving, or wire up react-native-fs / CameraRoll for a true
  // save-to-device flow.
  const requestSavePermission = async () => {
    if (Platform.OS !== "android") return true;
    if (Platform.Version >= 33) return true; // CameraRoll.save needs no runtime perm on API 33+
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: "Storage permission",
        message: "Allow access to save this video to your gallery.",
        buttonPositive: "Allow",
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const handleDownload = async () => {
    if (!canDownload || isDownloadingRef.current) return;

    const videoUrl = p?.media?.[0]?.url;
    if (!videoUrl) return;

    isDownloadingRef.current = true;
    let localPath = null;
    try {
      const hasPermission = await requestSavePermission();
      if (!hasPermission) {
        Alert.alert("Permission needed", "Storage access is required to save this video.");
        return;
      }

      const { dirs } = ReactNativeBlobUtil.fs;
      localPath = `${dirs.CacheDir}/${p?._id || "video"}_${Date.now()}.mp4`;

      // Download the actual bytes to a local file (no browser involved)
      const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true }).fetch(
        "GET",
        videoUrl
      );

      // Save the local file straight into the gallery
      await CameraRoll.save(`file://${res.path()}`, {
        type: "video",
        album: "Downloads",
      });

      setDownloadCount((c) => c + 1);
      Alert.alert("Saved", "Video saved to your gallery.");
    } catch (err) {
      console.error("[download-video] failed:", err?.message);
      Alert.alert("Download failed", "Something went wrong while saving this video.");
    } finally {
      isDownloadingRef.current = false;
      // Clean up the temp file so the cache doesn't fill up with videos
      if (localPath) ReactNativeBlobUtil.fs.unlink(localPath).catch(() => {});
    }
  };

  const handleBlock = () => {
    if (isBlocked) return;
    Alert.alert("Block user", `Block ${username}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block", style: "destructive",
        onPress: async () => {
          try {
            const res = await apiFetch(`${API}/auth/block/${authorId}`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
              setIsBlocked(true);
              setMenuOpen(false);
              onBlock?.(authorId?.toString());
            }
          } catch (err) { console.error(err); }
        },
      },
    ]);
  };

  const handleDelete = () => {
    Alert.alert("Delete video", "Delete this video?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            const res = await apiFetch(`${API}/auth/delete-post/${p._id}`, { method: "DELETE" });
            const data = await res.json();
            if (res.ok) { setRemovedFromView(true); onDeleted?.(p._id); }
            else Alert.alert(data.message);
          } catch (err) { console.log(err); }
        },
      },
    ]);
  };

  const HideFromNonFollowers = async () => {
    try {
      const res = await apiFetch(`${API}/auth/hide-from-non-followers/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) { setIsHidden(data.isHidden); Alert.alert(data.message); }
      else Alert.alert(data.message || "Something went wrong");
    } catch (err) { console.log(err); }
  };

  const notInterested = async () => {
    try {
      const res = await apiFetch(`${API}/auth/not-interested/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) { setIsNotInterested(prev => !prev); Alert.alert(data.message); }
    } catch (error) { console.log(error); }
  };

  const addComment = async () => {
    if (!commentText.trim() || !canComment) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${p._id}`, {
        method: "POST", body: JSON.stringify({ text: commentText })
      });
      const data = await res.json();
      if (data.success) {
        setComments(prev => prev.some(c => c._id === data.comment._id) ? prev : [...prev, data.comment]);
        setCommentText("");
      }
    } catch (err) { console.log(err); }
  };

  const handleRemoveCollab = (collabUser) => {
    const isLeavingSelf = collabUser?._id?.toString() === MY_ID;
    Alert.alert(
      isLeavingSelf ? "Leave collaboration" : "Remove collaborator",
      isLeavingSelf
        ? "Remove yourself as a collaborator on this post? It will no longer show on your profile."
        : `Remove ${collabUser?.username} as a collaborator? The post will no longer show on their profile.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            try {
              const res = await apiFetch(`${API}/auth/remove-collaborator/${p._id}`, {
                method: "PATCH", body: JSON.stringify({ userId: collabUser._id })
              });
              const data = await res.json();
              if (data.success) {
                setCollaborators(data.collaborators ?? []);
                setMenuOpen(false);
                if (isLeavingSelf && !isOwner) {
                  setRemovedFromView(true);
                  onDeleted?.(p._id);
                }
              }
            } catch {}
          },
        },
      ]
    );
  };

  const acceptedCollaborators = (collaborators || []).filter(c => c.status === "accepted");
  const myCollabEntry = acceptedCollaborators.find(c => (c.user?._id ?? c.user)?.toString() === MY_ID);

  // ── NEW: full collaborator roster (author + accepted collaborators),
  // used by the CollabListSheet — same shape as likedByUsers/viewedByUsers.
  const allCollabPeople = dedupeById(
  [p?.author, ...acceptedCollaborators.map(c => c.user)].filter(Boolean)
);
  const filteredCollabPeople = allCollabPeople.filter(u =>
    u.username?.toLowerCase().includes(collabSearch.toLowerCase())
  );

  const menuOptions = (() => {
    const opts = [];
    if (isOwner) {
      opts.push({ key: "delete", label: "Delete", danger: true, action: handleDelete });
      opts.push({ key: "hide", label: isHidden ? "Show to everyone" : "Hide from non-followers", action: HideFromNonFollowers });
      acceptedCollaborators.forEach((c) => {
        opts.push({ key: `remove-${c.user?._id}`, label: `Remove collab: ${c.user?.username}`, danger: true, action: () => handleRemoveCollab(c.user) });
      });
    } else if (isBlocked) {
      opts.push({ key: "blocked", label: "Blocked", disabled: true, action: () => {} });
    } else {
      opts.push({ key: "interest", label: isNotInterested ? "Interested" : "Not Interested", action: notInterested });
      opts.push({ key: "block", label: "Block", danger: true, action: handleBlock });
      if (myCollabEntry) {
        opts.push({ key: "leave-collab", label: "Remove myself as collaborator", danger: true, action: () => handleRemoveCollab(myCollabEntry.user) });
      }
    }
    return opts;
  })();

  const handleMenuAction = (opt) => {
    if (opt.disabled) return;
    setMenuOpen(false);
    opt.action();
  };

  const filteredLikers = likedByUsers.filter(u => u.username?.toLowerCase().includes(likerSearch.toLowerCase()));
  const filteredViewers = viewedByUsers.filter(u => u.username?.toLowerCase().includes(viewerSearch.toLowerCase()));
  const commentCount = comments.length;

  if (removedFromView) return null;

  return (
    <View style={S.wrapper}>

      {/* VIDEO */}
      <TouchableOpacity activeOpacity={1} style={S.videoBox} onPress={handleVideoTap}>
        <Video
          source={isVisible ? { uri: p?.media?.[0]?.url || "" } : undefined}
          style={S.video}
          resizeMode="contain"
          repeat
          muted={muted}
          paused={paused || !isVisible}
          viewType={ViewType.TEXTURE} 
        />
        <View style={S.overlay} pointerEvents="none" />
        {flashPause && (
          <View style={S.flashWrap} pointerEvents="none">
            <FA5Icon name={paused ? "play" : "pause"} size={60} color="#fff" solid />
          </View>
        )}
        {showLikeBurst && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", top: "50%", left: "50%", marginTop: -45, marginLeft: -45,
              opacity: likeBurstAnim,
              transform: [{ scale: likeBurstAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.15] }) }],
            }}
          >
            <FA5Icon name="thumbs-up" size={90} color="#fff" solid />
          </Animated.View>
        )}
      </TouchableOpacity>

      {/* RIGHT ACTIONS */}
      <View style={S.rightActions}>
        <View style={{ alignItems: "center", gap: 4 }}>
          <TouchableOpacity style={S.actionBtn} onPress={handleToggleLike}>
            <FA5Icon name="thumbs-up" size={26} color={liked ? "#f5a623" : "#fff"} solid={liked} />
          </TouchableOpacity>
          {(!hideLikeCount || isOwner) && (
            <Text style={S.actionLabel} onPress={() => setShowLikers(true)}>{formatCount(likesCount)}</Text>
          )}
        </View>

        {canComment && (
          <View style={{ alignItems: "center", gap: 4 }}>
            <TouchableOpacity style={S.actionBtn} onPress={() => setShowComments(true)}>
              <FeatherIcon name="message-circle" size={24} color="#fff" />
            </TouchableOpacity>
            {(!hideCommentCount || isOwner) && <Text style={S.actionLabel}>{formatCount(commentCount)}</Text>}
          </View>
        )}

        <View style={{ alignItems: "center", gap: 4 }}>
          <TouchableOpacity style={S.actionBtn} onPress={() => { console.log('[SHARE TAP] firing, current showShare =', showShare); setMenuOpen(false); setShowShare(true); }}>
            <IonIcon name="paper-plane" size={24} color="#fff" />
          </TouchableOpacity>
          {sharesCount > 0 && <Text style={S.actionLabel}>{formatCount(sharesCount)}</Text>}
        </View>

        {canDownload && (
          <View style={{ alignItems: "center", gap: 4 }}>
            <TouchableOpacity style={S.actionBtn} onPress={handleDownload}>
              <FeatherIcon name="download" size={22} color="#fff" />
            </TouchableOpacity>
            {downloadCount > 0 && <Text style={S.actionLabel}>{formatCount(downloadCount)}</Text>}
          </View>
        )}

        <View style={{ alignItems: "center", gap: 4 }}>
          <TouchableOpacity style={S.actionBtn} onPress={() => setShowViews(true)}>
            <FeatherIcon name="eye" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={S.actionLabel}>{formatCount(viewsCount)}</Text>
        </View>

        <TouchableOpacity style={S.actionBtn} onPress={() => setMuted(prev => !prev)}>
          <FeatherIcon name={muted ? "volume-x" : "volume-2"} size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={S.actionBtn} onPress={toggleSave}>
          <FA5Icon name="bookmark" size={22} color="#fff" solid={saved} />
        </TouchableOpacity>

        <View style={{ position: "relative" }}>
          <TouchableOpacity style={S.actionBtn} onPress={() => setMenuOpen(prev => !prev)}>
            <FeatherIcon name="more-vertical" size={20} color="#fff" />
          </TouchableOpacity>
          {menuOpen && (
            <View style={S.menu}>
              {menuOptions.map((opt) => (
                <TouchableOpacity key={opt.key} onPress={() => handleMenuAction(opt)} style={S.menuItemBtn} disabled={opt.disabled}>
                  <Text style={{ color: opt.disabled ? "#888" : opt.danger ? "#ff5555" : "#fff", fontSize: 14 }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {hasStory && (
          <View style={{ alignItems: "center", gap: 4 }}>
            <TouchableOpacity onPress={handleAvatarPress} style={discRingWrap}>
              <View style={discRingInner}>
                <Avatar src={profilePic} username={username} size={36} />
              </View>
            </TouchableOpacity>
            <Text style={S.seeStoryLabel}>See story</Text>
          </View>
        )}
      </View>

      {/* BOTTOM CONTENT */}
      <View style={S.bottomBar}>
        <View style={S.userRow}>
          <CoAuthorRow
            author={p?.author}
            acceptedCollaborators={acceptedCollaborators}
            onNavigate={goToProfile}
            onOpenCollabList={() => setShowCollabList(true)}
          />
        </View>
        <LikesSummary
          likedByUsers={likedByUsers}
          likesCount={likesCount}
          hideLikeCount={hideLikeCount}
          isOwner={isOwner}
          onOpen={() => setShowLikers(true)}
        />
        <CaptionText text={caption} />
        <TagsRow tags={tags} postId={p._id} isOwner={isOwner} onTagsUpdate={setTags} />
        <CollabRow collaborators={collaborators} postId={p._id} isOwner={isOwner} onCollabUpdate={setCollaborators} />
      </View>

      {/* LIKERS SHEET */}
      {showLikers && (
        <Modal visible transparent animationType="slide" onRequestClose={() => { setShowLikers(false); setLikerSearch(""); }}>
          <TouchableOpacity style={sheet.overlay} activeOpacity={1} onPress={() => { setShowLikers(false); setLikerSearch(""); }}>
            <TouchableOpacity activeOpacity={1} style={sheet.box} onPress={() => {}}>
              <View style={sheet.handle} />
              <View style={sheet.header}>
                <Text style={{ fontWeight: "700" }}>Liked by</Text>
                <TouchableOpacity style={sheet.closeX} onPress={() => { setShowLikers(false); setLikerSearch(""); }}><FeatherIcon name="x" size={18} /></TouchableOpacity>
              </View>
              {likedByUsers.length > 0 && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                  <View style={sheet.searchWrap}>
                    <FeatherIcon name="search" size={14} color="#999" />
                    <TextInput value={likerSearch} onChangeText={setLikerSearch} placeholder="Search" style={sheet.searchInput} />
                    {likerSearch !== "" && <TouchableOpacity onPress={() => setLikerSearch("")}><FeatherIcon name="x" size={14} color="#999" /></TouchableOpacity>}
                  </View>
                </View>
              )}
              <ScrollView style={sheet.list}>
                {filteredLikers.length > 0 ? filteredLikers.map((u, i) => (
                  <TouchableOpacity key={u._id ?? i} style={sheet.row} onPress={() => { setShowLikers(false); setLikerSearch(""); goToProfile(u._id); }}>
                    <Avatar src={u.profilePic} username={u.username} size={40} />
                    <View>
                      <Text style={{ fontWeight: "600", fontSize: 14 }}>{u.username}</Text>
                      {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
                    </View>
                  </TouchableOpacity>
                )) : <Text style={sheet.empty}>{likerSearch ? "No results found" : "No likes yet"}</Text>}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* VIEWERS SHEET */}
      {showViews && (
        <Modal visible transparent animationType="slide" onRequestClose={() => { setShowViews(false); setViewerSearch(""); }}>
          <TouchableOpacity style={sheet.overlay} activeOpacity={1} onPress={() => { setShowViews(false); setViewerSearch(""); }}>
            <TouchableOpacity activeOpacity={1} style={sheet.box} onPress={() => {}}>
              <View style={sheet.handle} />
              <View style={sheet.header}>
                <Text style={{ fontWeight: "700" }}>Viewed by</Text>
                <TouchableOpacity style={sheet.closeX} onPress={() => { setShowViews(false); setViewerSearch(""); }}><FeatherIcon name="x" size={18} /></TouchableOpacity>
              </View>
              {viewedByUsers.length > 0 && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                  <View style={sheet.searchWrap}>
                    <FeatherIcon name="search" size={14} color="#999" />
                    <TextInput value={viewerSearch} onChangeText={setViewerSearch} placeholder="Search" style={sheet.searchInput} />
                    {viewerSearch !== "" && <TouchableOpacity onPress={() => setViewerSearch("")}><FeatherIcon name="x" size={14} color="#999" /></TouchableOpacity>}
                  </View>
                </View>
              )}
              <ScrollView style={sheet.list}>
                {filteredViewers.length > 0 ? filteredViewers.map((u, i) => (
                  <TouchableOpacity key={u._id ?? i} style={sheet.row} onPress={() => { setShowViews(false); setViewerSearch(""); goToProfile(u._id); }}>
                    <Avatar src={u.profilePic} username={u.username} size={40} />
                    <View>
                      <Text style={{ fontWeight: "600", fontSize: 14 }}>{u.username}</Text>
                      {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
                    </View>
                  </TouchableOpacity>
                )) : <Text style={sheet.empty}>{viewerSearch ? "No results found" : "No views yet"}</Text>}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* COLLABORATORS SHEET — NEW, mirrors likers/viewers sheets. Opens
          from the "N others" text in CoAuthorRow when a post has 3+
          collaborators (author + accepted collaborators). */}
      {showCollabList && (
        <Modal visible transparent animationType="slide" onRequestClose={() => { setShowCollabList(false); setCollabSearch(""); }}>
          <TouchableOpacity style={sheet.overlay} activeOpacity={1} onPress={() => { setShowCollabList(false); setCollabSearch(""); }}>
            <TouchableOpacity activeOpacity={1} style={sheet.box} onPress={() => {}}>
              <View style={sheet.handle} />
              <View style={sheet.header}>
                <Text style={{ fontWeight: "700" }}>Collaborators</Text>
                <TouchableOpacity style={sheet.closeX} onPress={() => { setShowCollabList(false); setCollabSearch(""); }}><FeatherIcon name="x" size={18} /></TouchableOpacity>
              </View>
              {allCollabPeople.length > 0 && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                  <View style={sheet.searchWrap}>
                    <FeatherIcon name="search" size={14} color="#999" />
                    <TextInput value={collabSearch} onChangeText={setCollabSearch} placeholder="Search" style={sheet.searchInput} />
                    {collabSearch !== "" && <TouchableOpacity onPress={() => setCollabSearch("")}><FeatherIcon name="x" size={14} color="#999" /></TouchableOpacity>}
                  </View>
                </View>
              )}
              <ScrollView style={sheet.list}>
                {filteredCollabPeople.length > 0 ? filteredCollabPeople.map((u, i) => (
                  <TouchableOpacity key={u._id ?? i} style={sheet.row} onPress={() => { setShowCollabList(false); setCollabSearch(""); goToProfile(u._id); }}>
                    <Avatar src={u.profilePic} username={u.username} size={40} />
                    <View>
                      <Text style={{ fontWeight: "600", fontSize: 14 }}>{u.username}</Text>
                      {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
                    </View>
                  </TouchableOpacity>
                )) : <Text style={sheet.empty}>{collabSearch ? "No results found" : "No collaborators"}</Text>}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* COMMENTS SHEET */}
{showComments && canComment && (
  <Modal visible transparent animationType="slide" onRequestClose={() => { setShowComments(false); setHighlightCommentId(null); setHighlightReplyId(null); }}>
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={sheet.overlay}
    >
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setShowComments(false); setHighlightCommentId(null); setHighlightReplyId(null); }} />
      <TouchableOpacity activeOpacity={1} style={sheet.box} onPress={() => {}}>
              <View style={sheet.handle} />
              <View style={sheet.header}>
                <Text style={{ fontWeight: "700" }}>Comments ({formatCount(commentCount)})</Text>
                <TouchableOpacity style={sheet.closeX} onPress={() => { setShowComments(false); setHighlightCommentId(null); setHighlightReplyId(null); }}><FeatherIcon name="x" size={18} /></TouchableOpacity>
              </View>
<ScrollView ref={commentsScrollRef} style={sheet.list} keyboardShouldPersistTaps="handled">
  <CommentSection
    comments={comments}
    setComments={setComments}
    currentUser={currentUser}
    postId={p._id}
    postAuthorId={p.author?._id || p.author}
    highlightCommentId={highlightCommentId}
    highlightReplyId={highlightReplyId}
    scrollRef={commentsScrollRef}
  />
</ScrollView>
              <View style={sheet.inputBar}>
                <Avatar src={currentUser?.profilePic} username={username} size={32} />
                <TextInput
                  value={commentText} onChangeText={setCommentText}
                  onSubmitEditing={addComment}
                  placeholder="Add a comment..." style={sheet.input}
                />
                <TouchableOpacity onPress={addComment} disabled={!commentText.trim()}>
                  <Text style={sheet.postBtn}>Post</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          
        </KeyboardAvoidingView>
        </Modal>
      )}

      {/* FIX (real cause, not a cache issue): ShareSheet already renders
          its own <Modal visible transparent .../> internally. My earlier
          pass additionally wrapped it in a Modal here too, producing a
          nested Modal-inside-Modal. React Native's Modal renders as its
          own native window, and nesting two of them is a known Android
          failure mode — the inner Modal's window frequently never
          actually paints, which is exactly the "complete blind" /
          won't-open symptom, even though showShare/state was toggling
          correctly. Render ShareSheet directly (no extra Modal wrapper)
          so there's only ever one Modal in the tree for it. */}
      {showShare && (
        <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />
      )}

      {showStoryPreview && hasStory && (
        <ReelStoryPreview story={story} onClose={() => setShowStoryPreview(false)} navigation={navigation} />
      )}
    </View>
  );
}

// ── Main page component ──────────────────────────────────────────────────
function UserProfileVideoPost() {
  const navigation = useNavigation();
  const route = useRoute();
  const { videoId, video: routeVideo, allVideos: routeAllVideos, ownerUserId: routeOwnerId, sheet, commentId, replyId } = route.params || {};
  // ← NEW — see Post.js's Post() for the same pattern.
  const pendingSheet = sheet ? { targetId: videoId, sheet, commentId: commentId || null, replyId: replyId || null } : null;

  // FIX: Dimensions.get("window") is captured once at module load and can
  // be off from the *actually visible* area on some Android devices/status
  // bar configurations. useWindowDimensions() stays live, and we also
  // measure the real rendered container via onLayout below as the source
  // of truth for FlatList paging — this is what was causing reels to
  // appear cut off / offset with a black gap above them.
  const { height: winH, width: winW } = useWindowDimensions();
  const [containerHeight, setContainerHeight] = useState(winH || SCREEN_H);
  const containerWidth = winW || SCREEN_W;

  const { user: currentUser } = useAuth();
  const MY_ID = (currentUser?._id || currentUser?.id)?.toString();

  const idOf = (v) => (v?._id ?? v ?? "").toString();

  const [fetchedVideo, setFetchedVideo] = useState(null);
  const [fetchLoading, setFetchLoading] = useState(!routeVideo);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (routeVideo || !videoId) return;

    let cancelled = false;
    setFetchLoading(true);
    setFetchFailed(false);

    (async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-post/${videoId}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success && data.post) setFetchedVideo(data.post);
        else setFetchFailed(true);
      } catch {
        if (!cancelled) setFetchFailed(true);
      } finally {
        if (!cancelled) setFetchLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [videoId, routeVideo]);

  const startVideo = routeVideo || fetchedVideo || null;
  const ownerUserId = routeOwnerId || (startVideo?.author?._id ?? startVideo?.author) || null;

  const [videosList, setVideosList] = useState(routeAllVideos || (fetchedVideo ? [fetchedVideo] : []));

  useEffect(() => {
    if (fetchedVideo && videosList.length === 0) setVideosList([fetchedVideo]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedVideo]);

  const [blockedIds, setBlockedIds] = useState(new Set());
  const handleBlock = (blockedAuthorId) => setBlockedIds(prev => new Set([...prev, blockedAuthorId]));
  const handleVideoDeleted = (deletedId) => setVideosList(prev => prev.filter(v => idOf(v) !== deletedId));

  const visibleVideos = videosList.filter(v => {
    const vAuthorId = (v?.author?._id ?? v?.author)?.toString();
    return !blockedIds.has(vAuthorId);
  });

  useEffect(() => {
    const fetchLatestVideos = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-posts/${ownerUserId}`);
        const data = await res.json();
        if (data.success) {
          const latestVideos = data.posts.filter((p) => p.postType === "video");
          setVideosList(prev => {
            if (prev.length === 0) return latestVideos;
            const existingIds = new Set(prev.map(idOf));
            const newOnes = latestVideos.filter(v => !existingIds.has(idOf(v)));
            return newOnes.length ? [...prev, ...newOnes] : prev;
          });
        }
      } catch (err) { console.log(err); }
    };
    if (ownerUserId) fetchLatestVideos();
  }, [ownerUserId]);

const flatListRef = useRef(null);
const startId = startVideo ? idOf(startVideo) : null;

const initialIndex = (() => {
  if (!startId) return 0;
  const idx = visibleVideos.findIndex(v => idOf(v) === startId);
  return idx >= 0 ? idx : 0;
})();

const [activeIndex, setActiveIndex] = useState(initialIndex);

  const prevVisibleLenRef = useRef(visibleVideos.length);
  useEffect(() => {
    const prevLength = prevVisibleLenRef.current;
    prevVisibleLenRef.current = visibleVideos.length;
    if (visibleVideos.length >= prevLength) return;

    if (visibleVideos.length === 0) {
      if (ownerUserId) {
        // FIX: this used to always replace with "UserProfile" — the
        // generic read-only viewer — even when you'd just deleted your
        // OWN last reel, landing you on a visitor-style view of your own
        // profile instead of your real Profile tab. Also switched to the
        // MainTabs-wrapped target: replace() never bubbles into nested
        // navigators the way navigate() does, so a bare "Profile" here
        // would fail with "not handled by any navigator".
        if (ownerUserId?.toString() === MY_ID) {
          navigation.replace("MainTabs", { screen: "Profile" });
        } else {
          navigation.replace("UserProfile", { userId: ownerUserId });
        }
      }
      else navigation.goBack();
      return;
    }
    const idx = Math.min(activeIndex, visibleVideos.length - 1);
    flatListRef.current?.scrollToIndex({ index: idx, animated: false });
    setActiveIndex(idx);
  }, [visibleVideos.length]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) setActiveIndex(viewableItems[0].index ?? 0);
  }).current;

  const getItemLayout = (data, index) => ({ length: containerHeight, offset: containerHeight * index, index });

  // FIX: initialScrollIndex + getItemLayout can silently fail to land on
  // Android before layout has settled (a well-known FlatList gotcha),
  // leaving the list showing a sliver of the wrong item — exactly the
  // "black gap above the video" symptom in the screenshots. This retries
  // the scroll once layout is actually ready.
  const onScrollToIndexFailed = useRef((info) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index: Math.min(info.index, Math.max(visibleVideos.length - 1, 0)),
        animated: false,
      });
    }, 150);
  }).current;

  if (fetchLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
        <Text style={{ color: "#fff", fontSize: 15 }}>Loading...</Text>
      </View>
    );
  }

  if (fetchFailed || (!startVideo && visibleVideos.length === 0)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
        <Text style={{ color: "#aaa", fontSize: 16 }}>No video found</Text>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: "#000" }}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && Math.abs(h - containerHeight) > 1) setContainerHeight(h);
      }}
    >
      <TouchableOpacity onPress={() => navigation.goBack()} style={backBtnStyle}>
        <FeatherIcon name="arrow-left" size={20} color="#fff" />
      </TouchableOpacity>

      {visibleVideos.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 16 }}>No reels available</Text>
        </View>
      ) : (
<FlatList
  ref={flatListRef}
  data={visibleVideos}
  keyExtractor={(item) => item._id}
  initialScrollIndex={initialIndex}
  getItemLayout={getItemLayout}
  onScrollToIndexFailed={onScrollToIndexFailed}
  pagingEnabled
  showsVerticalScrollIndicator={false}
  viewabilityConfig={viewabilityConfig}
  onViewableItemsChanged={onViewableItemsChanged}
  renderItem={({ item: post, index }) => {
    const postAuthorId = (post?.author?._id ?? post?.author)?.toString();
    const isOwner = MY_ID === postAuthorId || MY_ID === ownerUserId;
    return (
      <View style={{ height: containerHeight, width: containerWidth }}>
        <ProfileVideoCard
          p={post}
          isOwner={isOwner}
          isVisible={index === activeIndex}
          onBlock={handleBlock}
          onDeleted={handleVideoDeleted}
          pendingSheet={pendingSheet}
        />
      </View>
    );
  }}
  initialNumToRender={2}
  maxToRenderPerBatch={2}
  windowSize={3}
   removeClippedSubviews={Platform.OS === "android" ? false : true}
/>
      )}
    </View>
  );
}

export default UserProfileVideoPost;

// ── Styles ────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#000" },
  videoBox: { ...StyleSheet.absoluteFillObject },
  video: { width: "100%", height: "100%" },
  overlay: { ...StyleSheet.absoluteFillObject },
  flashWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  rightActions: { position: "absolute", right: 12, bottom: 20, alignItems: "center", gap: 16, zIndex: 25 },
  actionBtn: { alignItems: "center", justifyContent: "center" },
  actionLabel: { color: "#fff", fontSize: 12, fontWeight: "600" },
  menu: { position: "absolute", right: 40, bottom: 0, backgroundColor: "#1c1c1c", borderRadius: 14, overflow: "hidden", minWidth: 220, zIndex: 50 },
  menuItemBtn: { paddingVertical: 13, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" },
  bottomBar: { position: "absolute", left: 0, right: 70, bottom: 0, padding: 16, paddingBottom: 20, zIndex: 20 },
  userRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  username: { color: "#fff", fontWeight: "700", fontSize: 16 },
  caption: { color: "#fff", fontSize: 14, lineHeight: 20 },
  likesSummary: { color: "#fff", fontSize: 13, marginBottom: 4 },
  moreBtn: { color: "rgba(255,255,255,0.75)", fontWeight: "600" },
  tagChip: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(245,166,35,0.25)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  addTagBtn: { backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  seeStoryLabel: { color: "rgb(234,182,118)", fontSize: 10, fontWeight: "700" },
});

// FIX ("mini update" — sheets opening on too small an area of the screen,
// and the underlying reason sheets could appear collapsed on Android):
// `box` previously only declared `maxHeight`, and a `maxHeight`-only parent
// doesn't give its `flex: 1` children (the `list` ScrollView) a resolvable
// height in React Native — so the sheet shrank to fit whatever content it
// had instead of consistently filling a generous, comfortable portion of
// the screen. It now has an explicit `height`, so `list` reliably expands.
const sheet = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  box: { width: "100%", height: SCREEN_H * 0.68, maxHeight: SCREEN_H * 0.85, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  header: { alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  closeX: { position: "absolute", right: 16, top: 8 },
  list: { flex: 1, padding: 12 },
  row: { flexDirection: "row", gap: 10, marginBottom: 16, alignItems: "flex-start" },
  empty: { textAlign: "center", color: "#aaa", padding: 20, fontSize: 14 },
  inputBar: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#f0f0f0", padding: 12, gap: 8 },
  input: { flex: 1, fontSize: 14 },
  postBtn: { color: "#1877f2", fontWeight: "700", fontSize: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14 },
});

const backBtnStyle = {
  position: "absolute", top: 16, left: 16, zIndex: 999,
  backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 19, width: 38, height: 38,
  alignItems: "center", justifyContent: "center",
};

const discRingWrap = {
  width: 46, height: 46, borderRadius: 23, backgroundColor: "rgb(234,182,118)",
  alignItems: "center", justifyContent: "center", padding: 2,
};
const discRingInner = {
  width: "100%", height: "100%", borderRadius: 23, backgroundColor: "#000",
  alignItems: "center", justifyContent: "center", padding: 2,
};

const rp = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 340, height: "70%", backgroundColor: "#000", borderRadius: 16, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, zIndex: 2 },
  username: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 },
  closeBtn: { padding: 4 },
  media: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" },
  mediaEl: { width: "100%", height: "100%" },
  progressWrap: { flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingTop: 8, zIndex: 2 },
  progressBg: { flex: 1, height: 2, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  navLeft: { position: "absolute", left: 0, top: 0, width: "40%", height: "100%" },
  navRight: { position: "absolute", right: 0, top: 0, width: "60%", height: "100%" },
  ownBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: "rgba(0,0,0,0.9)" },
  viewerBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: "rgba(0,0,0,0.9)" },
  statPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  iconBtn: { alignItems: "center", justifyContent: "center" },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: "#fff", fontSize: 13 },
  menu: { position: "absolute", backgroundColor: "#fff", borderRadius: 14, minWidth: 210, overflow: "hidden", zIndex: 20 },
  menuItemBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  menuItemText: { fontSize: 14, fontWeight: "500", color: "#222" },
  commentsFeed: { position: "absolute", bottom: 8, left: 8, right: 46, gap: 5, maxHeight: "45%" },
  commentBubble: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", alignSelf: "flex-start", maxWidth: "90%" },
  commentUser: { color: "rgb(234,182,118)", fontSize: 10, fontWeight: "700" },
  commentText: { color: "#fff", fontSize: 12 },
  viewersOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  viewersBox: { backgroundColor: "#fff", maxHeight: "60%", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  viewersHandle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  viewersHeader: { textAlign: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", fontWeight: "700", fontSize: 15 },
});