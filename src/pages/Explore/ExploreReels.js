import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  FlatList,
  Modal,
  Animated,
  PanResponder,
  Alert,
  Linking,
  Dimensions,
  StyleSheet,
  Platform,
  PermissionsAndroid,
} from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import FeatherIcon from "react-native-vector-icons/Feather";
import IonIcon from "react-native-vector-icons/Ionicons";
import Video from "react-native-video";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
} from "react-native-webrtc";
import { apiFetch, getCachedUser, updateCachedUser, useAuth } from "../../api/authToken";
import Config from "react-native-config";
import { useNavigation, useRoute, useIsFocused } from "@react-navigation/native";
import socket from "../../sockets/Sockets";
import CommentSection from "../../components/PostCard/CommentSection";
import ShareSheet from "../../components/PostCard/ShareSheet";
import { useFollowStore, initFollowStore, addFollowing, removeFollowing } from "../Profile/UseFollowState";
import {
  getStoryRuntime,
  subscribeStory,
  pushComment,
  setRuntimeComments,
  setLikeState,
} from "../../components/State/SyncStoryStore";
import { isPostSaved, toggleSavedPost, subscribeSavedPosts } from "../../components/State/SavedPostStore";

const API = Config.API_URL;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const DOUBLE_TAP_DELAY = 300;

function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}
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

/* ── Anchored dropdown menu — RN has no "click outside" DOM listener,
   so open/close is driven by a full-screen Modal overlay tap instead. ── */
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

function Avatar({ src, username, size = 35, style: extra, onPress }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const content = src ? (
    <Image source={{ uri: src }} style={[{ width: size, height: size, borderRadius: size / 2 }, extra]} />
  ) : (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },
        extra,
      ]}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>{letter}</Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {content}
    </TouchableOpacity>
  );
}

/* ── Mutual/social-proof likes line ── */
function LikesSummary({ likedByUsers, likesCount, hideLikeCount, isOwner, onOpen }) {
  if (hideLikeCount && !isOwner) return null;
  if (!likesCount) return null;
  const first = likedByUsers?.[0];
  const others = likesCount - (first ? 1 : 0);

  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
      <Text style={S.likesSummary}>
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

function CaptionText({ text, limit = 100 }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text style={S.caption}>
        {text}
        {isLong && (
          <Text onPress={() => setExpanded(false)} style={S.moreBtn}>
            {" "}less
          </Text>
        )}
      </Text>
    );
  }

  return (
    <Text style={S.caption}>
      {text.slice(0, limit).trimEnd()}...
      <Text onPress={() => setExpanded(true)} style={S.moreBtn}>
        {" "}more
      </Text>
    </Text>
  );
}

/* ── Co-author names, Instagram-style ──────────────────────────────────
   FIX: only used for the 1-2 person case now. 3+ collaborators are shown
   as "first with N others" in CoAuthorHeader and open the new
   CollabListSheet, instead of dumping every name inline with no way to
   tap through to the ones past the 3rd. */
function CoAuthorNames({ people, onNavigate }) {
  const NameText = ({ p }) => <Text onPress={() => onNavigate(p._id)}>{p.username || "Unknown"}</Text>;

  if (people.length === 1) return <NameText p={people[0]} />;
  return (
    <Text>
      <NameText p={people[0]} /> and <NameText p={people[1]} />
    </Text>
  );
}

/* FIX: 1-2 collaborators -> show every name (as before). 3+ collaborators
   -> show "first with N others"; tapping "N others" opens the
   CollabListSheet (same pattern as the likers/viewers sheets) with every
   collaborator listed and navigable. */
function CoAuthorHeader({ author, acceptedCollaborators, onNavigate, onOpenCollabList }) {
  const people = [author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean);

  if (people.length <= 1) {
    return (
      <>
        <Avatar
          src={author?.profilePic}
          username={author?.username}
          size={40}
          style={{ borderWidth: 2, borderColor: "#fff" }}
          onPress={() => onNavigate(author?._id)}
        />
        <Text style={S.username} onPress={() => onNavigate(author?._id)}>
          {author?.username}
        </Text>
      </>
    );
  }

  if (people.length === 2) {
    return (
      <>
        <View style={{ flexDirection: "row" }}>
          {people.map((p, i) => (
            <Avatar
              key={p._id ?? i}
              src={p.profilePic}
              username={p.username}
              size={40}
              style={i === 0 ? { borderWidth: 2, borderColor: "#fff" } : { marginLeft: -16, borderWidth: 2, borderColor: "#fff" }}
              onPress={() => onNavigate(p._id)}
            />
          ))}
        </View>
        <Text style={S.username}>
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
          <Avatar
            key={p._id ?? i}
            src={p.profilePic}
            username={p.username}
            size={40}
            style={i === 0 ? { borderWidth: 2, borderColor: "#fff" } : { marginLeft: -16, borderWidth: 2, borderColor: "#fff" }}
            onPress={() => onNavigate(p._id)}
          />
        ))}
      </View>
      <Text style={S.username}>
        <Text onPress={() => onNavigate(first?._id)}>{first?.username || "Unknown"}</Text>
        {" "}with{" "}
        <Text style={{ textDecorationLine: "underline" }} onPress={() => onOpenCollabList?.()}>
          {remaining} other{remaining > 1 ? "s" : ""}
        </Text>
      </Text>
    </>
  );
}

/* ── Tags row — tapping resolves against username-search regardless of
   ownership; owner also gets add/remove controls. ── */
function TagsRow({ tags, postId, isOwner, onTagsUpdate }) {
  const [tagInput, setTagInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const navigation = useNavigation();

  const addTag = async () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "_");
    if (!t) return;
    try {
      const res = await apiFetch(`${API}/auth/add-tag/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ tag: t })
      });
      const data = await res.json();
      if (data.success) {
        onTagsUpdate(data.tags);
        setTagInput("");
        setShowInput(false);
      }
    } catch {}
  };

  const removeTag = async (tag) => {
    try {
      const res = await apiFetch(`${API}/auth/remove-tag/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ tag })
      });
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

  if (!tags?.length && !isOwner) return null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
      {tags?.map((t) => (
        <View key={t} style={S.tagChip}>
          <Text onPress={() => goToTaggedUser(t)} style={{ color: "#ffd28a", fontSize: 12, fontWeight: "600" }}>
            #{t}
          </Text>
          {isOwner && (
            <TouchableOpacity onPress={() => removeTag(t)} style={{ marginLeft: 3 }}>
              <FeatherIcon name="x" size={10} color="#ffd28a" />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {isOwner &&
        (showInput ? (
          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            <TextInput
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={addTag}
              placeholder="tag..."
              placeholderTextColor="#ccc"
              autoFocus
              style={S.tagInput}
            />
            <TouchableOpacity onPress={addTag} style={S.addTagBtn}>
              <Text style={{ color: "#fff", fontSize: 12 }}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowInput(false)}>
              <FeatherIcon name="x" size={12} color="#ddd" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setShowInput(true)} style={S.addTagBtn}>
            <Text style={{ color: "#fff", fontSize: 12 }}>+ tag</Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}

/* ── Collaborators row — owner-only invite search; a declined
   collaborator can be re-invited. ── */
function CollabRow({ collaborators, postId, isOwner, onCollabUpdate }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const timer = useRef(null);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(timer.current);
    if (!val.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/auth/search?q=${val}`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = await res.json();
        setResults(Array.isArray(data) ? data : data.users || []);
      } catch (err) {
        console.error("[collab-search] failed:", err.message);
      }
    }, 400);
  };

  const addCollab = async (userId) => {
    try {
      const res = await apiFetch(`${API}/auth/add-collaborator/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (data.success) {
        onCollabUpdate(data.collaborators);
        setSearch("");
        setResults([]);
        setShowSearch(false);
      } else if (data.message) {
        Alert.alert("", data.message);
      }
    } catch {}
  };

  if (!isOwner) return null;

  return (
    <View style={{ marginTop: 8 }}>
      {showSearch ? (
        <View>
          <View style={S.collabSearchWrap}>
            <FeatherIcon name="search" size={12} color="#ddd" />
            <TextInput
              value={search}
              onChangeText={handleSearch}
              placeholder="Invite a collaborator..."
              placeholderTextColor="#ccc"
              autoFocus
              style={{ flex: 1, fontSize: 13, color: "#fff" }}
            />
            <TouchableOpacity
              onPress={() => {
                setShowSearch(false);
                setSearch("");
                setResults([]);
              }}
            >
              <FeatherIcon name="x" size={12} color="#ddd" />
            </TouchableOpacity>
          </View>
          {results.length > 0 && (
            <View style={S.collabResults}>
              {results
                .filter((u) => !collaborators.some((c) => c.user?._id === u._id && c.status !== "declined"))
                .map((u) => {
                  const declined = collaborators.some((c) => c.user?._id === u._id && c.status === "declined");
                  return (
                    <TouchableOpacity key={u._id} onPress={() => addCollab(u._id)} style={S.collabResultRow}>
                      <Avatar src={u.profilePic} username={u.username} size={28} />
                      <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>{u.username}</Text>
                      {declined && (
                        <Text style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>declined — invite again</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity onPress={() => setShowSearch(true)} style={[S.addTagBtn, { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }]}>
          <FeatherIcon name="users" size={11} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12 }}>+ invite collaborator</Text>
        </TouchableOpacity>
      )}
      {collaborators.some((c) => c.status === "pending") && (
        <Text style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>
          {collaborators.filter((c) => c.status === "pending").map((c) => c.user?.username).join(", ")} invited — waiting
          for them to accept.
        </Text>
      )}
    </View>
  );
}

/* ── Follow button — local pattern identical to Videopost.js: followState
   derived from myFollowingIds, which ExploreReels() keeps in sync with
   the server. ── */
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
          onFollowChange?.(authorId, true);
        }
      } else if (followState === "requested") {
        const res = await apiFetch(`${API}/auth/cancel-follow/${authorId}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.success) return;
        setFollowState("none");
        unfollow(authorId);
        onFollowChange?.(authorId, false);
        socket.emit("unfollowUser", { toUserId: authorId });
      } else if (followState === "following") {
        const ok = await confirmAsync("Unfollow this user?");
        if (!ok) return;
        const res = await apiFetch(`${API}/auth/unfollow/${authorId}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.success) return;
        setFollowState("none");
        unfollow(authorId);
        onFollowChange?.(authorId, false);
        socket.emit("unfollowUser", { toUserId: authorId });
      }
    } catch (err) {
      console.log(err);
    }
  };

  const followLabel = followState === "following" ? "Following" : followState === "requested" ? "Requested" : "Follow";
  return { followState, handleFollowBtn, followLabel };
}

function FollowButton({ authorId, isPrivate, isOwner, isBlocked, myFollowingIds, onFollowChange, style: extraStyle }) {
  const { followState, handleFollowBtn, followLabel } = useFollowState(authorId, isPrivate, onFollowChange, myFollowingIds);
  if (isOwner || isBlocked || !authorId) return null;

  return (
    <TouchableOpacity
      onPress={handleFollowBtn}
      style={[
        S.followBtnOutline,
        followState !== "none" && { backgroundColor: "rgba(255,255,255,0.15)" },
        extraStyle,
      ]}
    >
      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{followLabel}</Text>
    </TouchableOpacity>
  );
}

/* ── Story preview — same WebRTC live-stream/text-overlay/mention/repost
   pattern as Videopost.js's ReelStoryPreview. ── */
function ReelStoryPreview({ story, onClose, navigation }) {
  const { user: currentUser } = useAuth();
  const currentUserId = (currentUser?._id || currentUser?.id)?.toString();

  const [slideIndex, setSlideIndex] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [isHidden, setIsHidden] = useState(false);
  const [comment, setComment] = useState("");
  const menu = useAnchoredMenu();
  const [showViewers, setShowViewers] = useState(false);
  const [liveComments, setLiveComments] = useState([]);
  const [accessDenied, setAccessDenied] = useState(null);

  const slides = story?.slides || [];
  const slide = slides[slideIndex] || {};
  const isOwn = !!story?.isOwn;
  const isLiveSlide = slide?.type === "live" || slide?.isLive === true;
  const isVideo = slide.type === "video" || slide.image?.includes(".mp4") || slide.image?.includes("video");

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

  useEffect(() => setSlideIndex(0), [story?.id]);

  useEffect(() => {
    if (!slide?.id) return;
    socket.emit("joinStory", { storyId: slide.id, viewerId: currentUserId });
    return () => socket.emit("leaveStory", slide.id);
  }, [slide?.id, currentUserId]);

  useEffect(() => {
    if (!slide?.id) return;
    menu.close();
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
      if (res.ok) {
        setIsHidden(data.isHiddenFromNonFollowers);
        menu.close();
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
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <TouchableOpacity style={RP.overlay} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[RP.card, RP.deniedCenter]}>
            <Avatar src={story.userProfile} username={story.username} size={56} />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 8 }}>Follow to view this story</Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, textAlign: "center", marginTop: 4 }}>
              Only {story.username}'s followers can see this story.
            </Text>
            <TouchableOpacity onPress={onClose} style={RP.deniedCloseBtn}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={RP.overlay}>
        <View style={RP.card}>
          {slides.length > 1 && (
            <View style={RP.progressWrap}>
              {slides.map((_, i) => (
                <View key={i} style={RP.progressBg}>
                  <View style={[RP.progressFill, { width: i <= slideIndex ? "100%" : "0%" }]} />
                </View>
              ))}
            </View>
          )}

          <View style={RP.header}>
            <Avatar src={story.userProfile} username={story.username} size={28} />
            <Text style={RP.username}>{story.username}</Text>
            <TouchableOpacity onPress={onClose} style={RP.closeBtn}>
              <FeatherIcon name="x" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={RP.media}>
            {isLiveSlide ? (
              liveStatus === "live" && liveStream ? (
                <RTCView streamURL={liveStream.toURL()} style={RP.mediaEl} objectFit="contain" />
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
              isVideo ? (
                <Video key={slide.image} source={{ uri: slide.image }} style={RP.mediaEl} resizeMode="contain" repeat muted />
              ) : (
                <Image source={{ uri: slide.image }} style={RP.mediaEl} resizeMode="contain" />
              )
            ) : (
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No story to show</Text>
            )}

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
                    onPress={() => {
                      if (!m.user) return;
                      onClose();
                      if (m.user?.toString() === currentUserId) {
                        navigation.navigate("MainTabs", { screen: "Profile" });
                      } else {
                        navigation.navigate("UserProfile", { userId: m.user });
                      }
                    }}
                    style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 18, paddingHorizontal: 9, paddingVertical: 4 }}
                  >
                    <Text style={{ color: "#111", fontSize: 11, fontWeight: "700" }}>@{m.username || "user"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {!isLiveSlide && slide.repostAttribution?.username && (
              <TouchableOpacity
                onPress={() => {
                  if (!slide.repostAttribution.user) return;
                  onClose();
                  if (slide.repostAttribution.user?.toString() === currentUserId) {
                    navigation.navigate("MainTabs", { screen: "Profile" });
                  } else {
                    navigation.navigate("UserProfile", { userId: slide.repostAttribution.user });
                  }
                }}
                style={RP.repostBadge}
              >
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

            {slides.length > 1 && !isLiveSlide && (
              <>
                <TouchableOpacity style={RP.navLeft} activeOpacity={1} onPress={handlePrev} />
                <TouchableOpacity style={RP.navRight} activeOpacity={1} onPress={handleNext} />
              </>
            )}

            {liveComments.length > 0 && (
              <View style={RP.commentsFeed} pointerEvents="none">
                {liveComments.map((c, i) => (
                  <View key={i} style={RP.commentBubble}>
                    <Text style={RP.commentUser}>{c.username}</Text>
                    <Text style={RP.commentText}>{c.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {isOwn ? (
            <View style={RP.ownBar}>
              <TouchableOpacity onPress={() => setShowViewers(true)} style={RP.statPill}>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{viewers.length} views</Text>
              </TouchableOpacity>
              <View style={RP.statPill}>
                <Icon name="heart" solid size={13} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{formatCount(likesCount)}</Text>
              </View>
              <View style={{ position: "relative", marginLeft: "auto" }}>
                <TouchableOpacity ref={menu.anchorRef} onPress={menu.open} style={RP.iconBtn}>
                  <Icon name="ellipsis-v" size={16} color="#fff" />
                </TouchableOpacity>
                {menu.visible && (
                  <Modal transparent visible={menu.visible} animationType="fade" onRequestClose={menu.close}>
                    <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={menu.close}>
                      <View style={[RP.menu, { top: "auto", bottom: 34, right: 12, position: "absolute" }]}>
                        <TouchableOpacity onPress={handleHideFromNonFollowers} style={RP.menuItem}>
                          <Text style={{ fontSize: 14, fontWeight: "500", color: "#222" }}>
                            {isHidden ? "Show to everyone" : "Hide from non-followers"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDelete} style={[RP.menuItem, { borderBottomWidth: 0 }]}>
                          <Text style={{ fontSize: 14, fontWeight: "500", color: "#e53935" }}>Delete Story</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  </Modal>
                )}
              </View>
            </View>
          ) : (
            <View style={RP.viewerBar}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                onSubmitEditing={handleSendComment}
                placeholder="Send message..."
                placeholderTextColor="rgba(255,255,255,0.6)"
                style={RP.input}
              />
              <TouchableOpacity onPress={handleLike} style={RP.iconBtn}>
                <Icon name="heart" solid={liked} size={17} color={liked ? "#e53935" : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSendComment} disabled={!comment.trim()} style={[RP.iconBtn, { opacity: comment.trim() ? 1 : 0.4 }]}>
                <IonIcon name="paper-plane" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {showViewers && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowViewers(false)}>
          <TouchableOpacity style={RP.viewersOverlay} activeOpacity={1} onPress={() => setShowViewers(false)}>
            <TouchableOpacity activeOpacity={1} style={RP.viewersBox}>
              <View style={RP.viewersHandle} />
              <Text style={RP.viewersHeader}>{viewers.length} viewers</Text>
              <FlatList
                data={viewers}
                keyExtractor={(v, i) => v._id ?? i.toString()}
                ListEmptyComponent={<Text style={{ textAlign: "center", color: "#aaa", paddingVertical: 20 }}>No viewers yet</Text>}
                renderItem={({ item: v }) => (
                  <TouchableOpacity onPress={() => goToViewerProfile(v._id)} style={RP.viewerRow}>
                    <Avatar src={v.profilePic} username={v.username} size={40} />
                    <Text style={{ fontSize: 15, fontWeight: "600" }}>{v.username}</Text>
                  </TouchableOpacity>
                )}
              />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </Modal>
  );
}

/* ── Generic drag-to-dismiss bottom sheet used for likers/viewers/comments
   /collaborators. ──
   FIX (root cause confirmed via the ShareSheet debugging session): this
   used `useNativeDriver: true` on the spring-back animation while
   `translateY` is driven manually via `setValue()` during the drag
   (not through `Animated.event`). Mixing those two on this app's Fabric /
   New Architecture setup desyncs the native animated node graph and the
   whole sheet silently fails to paint — no error, no crash, just nothing
   on screen. `useNativeDriver: false` matches how the value is actually
   being driven, so there's no JS/native thread mismatch anymore. */
function BottomSheet({ onClose, title, children, inputBar }) {
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
      <TouchableOpacity style={sheet.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View {...panResponder.panHandlers} style={[sheet.box, { transform: [{ translateY }] }]}>
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
            <View style={sheet.handle} />
            <View style={sheet.header}>
              <Text style={{ fontWeight: "700", fontSize: 15 }}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={sheet.closeX}>
                <FeatherIcon name="x" size={18} color="#333" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>{children}</View>
            {inputBar}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ── Story ring around the small profile-pic avatar (under the ⋮ menu). ── */
function StoryRing({ children, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={discRingWrap}>
      <View style={discRingInner}>{children}</View>
    </TouchableOpacity>
  );
}

/* ── Single reel card ── */
function ExploreReelCard({ p = {}, isVisible: isVisibleProp, onBlock, onDeleted, myFollowingIds, onFollowChange }) {
  const navigation = useNavigation();
  // FIX — isVisibleProp only tracks which item is centered in the
  // FlatList; it has no idea whether THIS screen itself still has
  // navigation focus. Without this, tapping into a profile or any other
  // screen on top of ExploreReels left the video "visible" as far as
  // this component knew, so its audio kept playing in the background
  // the whole time you were on another screen. Combining with
  // useIsFocused stops it the instant you navigate away and resumes it
  // when you come back — same fix already applied to Video.js's
  // Videopost, HomePage.js's VideoFeedCard, and UserProfileVideoPost.js's
  // ProfileVideoCard.
  const isScreenFocused = useIsFocused();
  const isVisible = isVisibleProp && isScreenFocused;
  const { user: currentUser } = useAuth();
  const MY_ID = (currentUser?._id || currentUser?.id)?.toString();

  const authorId = p?.author?._id || p?.author;
  const isPrivate = p?.author?.isPrivate ?? false;
  const isOwner = MY_ID === authorId?.toString();

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
  const menu = useAnchoredMenu();
  const [flashPause, setFlashPause] = useState(false);
  const [showLikeBurst, setShowLikeBurst] = useState(false);
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
  const [sharesCount, setSharesCount] = useState(shareCount(p?.shares) ?? p?.sharesCount ?? 0);
  const [resolvedUsers, setResolvedUsers] = useState({});
const isDownloadingRef = useRef(false);
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

  const tapTimeoutRef = useRef(null);
  const lastTapRef = useRef(0);
  const flashTimer = useRef(null);

  const burstScale = useRef(new Animated.Value(0.3)).current;
  const burstOpacity = useRef(new Animated.Value(0)).current;

  const username = p?.author?.username || "user";
  const profilePic = p?.author?.profilePic;
  const caption = p?.caption || p?.desc || "";

  useEffect(() => {
    const accepted = (collaborators || []).filter((c) => c.status === "accepted");
    const needsResolve = accepted
      .map((c) => c.user)
      .filter((u) => {
        const id = (u?._id ?? u)?.toString();
        return id && !u?.username && !resolvedUsers[id];
      });
    if (needsResolve.length === 0) return;

    needsResolve.forEach(async (u) => {
      const id = (u?._id ?? u)?.toString();
      try {
        const res = await apiFetch(`${API}/auth/user/${id}`);
        const data = await res.json();
        if (data?.user) {
          setResolvedUsers((prev) => ({
            ...prev,
            [id]: { _id: id, username: data.user.username, profilePic: data.user.profilePic },
          }));
        }
      } catch {}
    });
  }, [collaborators, resolvedUsers]);

  const acceptedCollaborators = (collaborators || [])
    .filter((c) => c.status === "accepted")
    .map((c) => {
      const rawUser = c.user;
      const id = (rawUser?._id ?? rawUser)?.toString();
      if (rawUser?.username) return c;
      const resolved = resolvedUsers[id];
      return resolved ? { ...c, user: resolved } : c;
    });

  const myCollabEntry = acceptedCollaborators.find((c) => (c.user?._id ?? c.user)?.toString() === MY_ID);

  // ── NEW: full collaborator roster (author + accepted collaborators),
  // used by the CollabListSheet — same shape as likedByUsers/viewedByUsers.
 const allCollabPeople = dedupeById(
  [p?.author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean)
);
  const filteredCollabPeople = allCollabPeople.filter((u) =>
    u.username?.toLowerCase().includes(collabSearch.toLowerCase())
  );

  useEffect(() => {
    if (!p?._id) return;
    socket.emit("joinPost", p._id);
    return () => socket.emit("leavePost", p._id);
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
          setLiked((data.likedBy ?? []).some((u) => u._id === MY_ID));
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

    const onLikes = ({ totalLikes, likedBy }) => {
      setLikesCount(totalLikes);
      if (likedBy) {
        setLikedByUsers(dedupeById(likedBy));
        setLiked(dedupeById(likedBy).some((u) => u._id === MY_ID));
      }
    };
    const onNewComment = ({ comment }) => setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    const onDelComment = ({ commentId }) => setComments((prev) => prev.filter((c) => c._id !== commentId));
    const onViews = ({ totalViews }) => setViewsCount(totalViews);

    const onCollabResponded = ({ postId }) => { if (postId === p._id) fetchCollaborators(); };
    const onPostDeletedForMe = ({ postId }) => {
      if (postId === p._id) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      }
    };
    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== p._id) return;
      setCollaborators((prev) => prev.filter((c) => (c.user?._id ?? c.user)?.toString() !== userId));
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
    if (!authorId) {
      setStory(null);
      return;
    }
    try {
      const res = await apiFetch(`${API}/stories/get-user-stories/${authorId}`);
      const data = await res.json();
      if (!data.success || !data.stories?.length) {
        setStory(null);
        return;
      }
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

  useEffect(() => {
    fetchStory();
  }, [fetchStory]);

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

  // Visibility comes from the parent FlatList's onViewableItemsChanged
  // rather than an IntersectionObserver, which RN has no equivalent of.
  useEffect(() => {
    if (!isVisible) setPaused(false);
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
    } catch (err) {
      console.log(err);
    }
  };

  const handleToggleLike = () => performToggleLike();

  const triggerLikeBurst = () => {
    if (!liked) performToggleLike();
    setShowLikeBurst(true);
    burstScale.setValue(0.3);
    burstOpacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(burstScale, { toValue: 1.15, duration: 200, useNativeDriver: true }),
        Animated.timing(burstOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]),
      Animated.timing(burstScale, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(burstOpacity, { toValue: 0, duration: 180, delay: 130, useNativeDriver: true }),
    ]).start(() => setShowLikeBurst(false));
  };

  // ── Single tap = play/pause, double tap = like burst.
  // FIX: the single-tap fire delay used to be 280ms while DOUBLE_TAP_DELAY
  // (the double-tap detection window) is 300ms. Because 280 < 300, a
  // legitimate double-tap landing between 280–300ms after the first tap
  // would still register as a double-tap here, but the single-tap's
  // play/pause timeout had *already fired* a few ms earlier — so the
  // video would pause/unpause AND like at once, which is what made
  // double-tap-to-like look unreliable/broken. The single-tap delay must
  // be strictly greater than the double-tap window so the timeout can
  // never fire before a genuine second tap has had its full window to
  // arrive and cancel it.
  const handleVideoTap = () => {
    console.log("[tap]", Date.now());
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      clearTimeout(tapTimeoutRef.current);
      lastTapRef.current = 0;
      triggerLikeBurst();
      return;
    }
    lastTapRef.current = now;
    tapTimeoutRef.current = setTimeout(() => {
      setPaused((prev) => !prev);
      setFlashPause(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashPause(false), 500);
    }, DOUBLE_TAP_DELAY + 20); // always fires after the double-tap window closes
  };

  const goToProfile = (id) => {
    if (!id) return;
    // FIX: tapping your own name/avatar used to open the generic
    // "UserProfile" viewer instead of your real Profile tab.
    if (id?.toString() === MY_ID) {
      navigation.navigate("MainTabs", { screen: "Profile" });
    } else {
      navigation.navigate("UserProfile", { userId: id });
    }
  };

  const handleAvatarClick = () => {
    if (hasStory) setShowStoryPreview(true);
    else goToProfile(authorId);
  };

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
      console.log("[download-video] failed:", err?.message);
      Alert.alert("Download failed", "Something went wrong while saving this video.");
    } finally {
      isDownloadingRef.current = false;
      // Clean up the temp file so the cache doesn't fill up with videos
      if (localPath) ReactNativeBlobUtil.fs.unlink(localPath).catch(() => {});
    }
  };

  const handleBlock = async () => {
    if (isBlocked) return;
    const ok = await confirmAsync(`Block ${username}?`);
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/block/${authorId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setIsBlocked(true);
        menu.close();
        onBlock?.(authorId?.toString());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmAsync("Delete this video?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/delete-post/${p._id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const HideFromNonFollowers = async () => {
    try {
      const res = await apiFetch(`${API}/auth/hide-from-non-followers/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHidden);
        Alert.alert("", data.message);
      } else {
        Alert.alert("Error", data.message || "Something went wrong");
      }
    } catch (err) {
      console.log(err);
    }
  };

  const notInterested = async () => {
    try {
      const res = await apiFetch(`${API}/auth/not-interested/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) {
        setIsNotInterested((prev) => !prev);
        Alert.alert("", data.message);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const addComment = async () => {
    if (!commentText.trim() || !canComment) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${p._id}`, {
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

  const handleRemoveCollab = async (collabUser) => {
    const isLeavingSelf = collabUser?._id?.toString() === MY_ID;
    const confirmMsg = isLeavingSelf
      ? "Remove yourself as a collaborator on this post? It will no longer show on your profile."
      : `Remove ${collabUser?.username} as a collaborator? The post will no longer show on their profile.`;
    const ok = await confirmAsync(confirmMsg);
    if (!ok) return;

    try {
      const res = await apiFetch(`${API}/auth/remove-collaborator/${p._id}`, {
        method: "PATCH",
        body: JSON.stringify({ userId: collabUser._id })
      });
      const data = await res.json();
      if (data.success) {
        setCollaborators(data.collaborators ?? []);
        menu.close();
        if (isLeavingSelf && !isOwner) {
          setRemovedFromView(true);
          onDeleted?.(p._id);
        }
      }
    } catch {}
  };

  const menuOptions = (() => {
    const opts = [];
    if (isOwner) {
      opts.push({ key: "delete", label: "Delete", danger: true, action: handleDelete });
      opts.push({
        key: "hide",
        label: isHidden ? "Show to everyone" : "Hide from non-followers",
        action: HideFromNonFollowers,
      });
      acceptedCollaborators.forEach((c) => {
        opts.push({
          key: `remove-${c.user?._id}`,
          label: `Remove collab: ${c.user?.username}`,
          danger: true,
          action: () => handleRemoveCollab(c.user),
        });
      });
    } else if (isBlocked) {
      opts.push({ key: "blocked", label: "Blocked", disabled: true, action: () => {} });
    } else {
      opts.push({ key: "interest", label: isNotInterested ? "Interested" : "Not Interested", action: notInterested });
      opts.push({ key: "block", label: "Block", danger: true, action: handleBlock });
      if (myCollabEntry) {
        opts.push({
          key: "leave-collab",
          label: "Remove myself as collaborator",
          danger: true,
          action: () => handleRemoveCollab(myCollabEntry.user),
        });
      }
    }
    return opts;
  })();

  const handleMenuAction = (opt) => {
    if (opt.disabled) return;
    menu.close();
    opt.action();
  };

  const filteredLikers = likedByUsers.filter((u) => u.username?.toLowerCase().includes(likerSearch.toLowerCase()));
  const filteredViewers = viewedByUsers.filter((u) => u.username?.toLowerCase().includes(viewerSearch.toLowerCase()));
  const commentCount = comments.length;

  if (removedFromView) return null;

  return (
    <>
      <View style={S.wrapper}>
        {/* VIDEO */}
        <TouchableOpacity activeOpacity={1} style={S.videoBox} onPress={handleVideoTap}>
          <Video
            source={isVisible ? { uri: p?.media?.[0]?.url || "" } : undefined}
            style={S.video}
            resizeMode="contain"
            repeat
            muted={muted}
            paused={!isVisible || paused}
          />
          <View style={S.overlayGradient} pointerEvents="none" />
          {flashPause && (
            <View style={S.flashWrap} pointerEvents="none">
              <Icon name={paused ? "play" : "pause"} solid size={60} color="#fff" />
            </View>
          )}
          {showLikeBurst && (
            <View style={S.burstOverlay} pointerEvents="none">
              <Animated.View style={{ transform: [{ scale: burstScale }], opacity: burstOpacity }}>
                <Icon name="thumbs-up" solid size={90} color="#fff" />
              </Animated.View>
            </View>
          )}
        </TouchableOpacity>

        {/* RIGHT ACTIONS */}
        <View style={S.rightActions}>
          <View style={{ alignItems: "center", gap: 4 }}>
            <ActionBtn icon={<Icon name="thumbs-up" solid={liked} size={28} color={liked ? "#f5a623" : "#fff"} />} onPress={handleToggleLike} />
            {(!hideLikeCount || isOwner) && (
              <Text style={S.actionLabel} onPress={() => setShowLikers(true)}>
                {formatCount(likesCount)}
              </Text>
            )}
          </View>

          {canComment && (
            <View style={{ alignItems: "center", gap: 4 }}>
              <ActionBtn icon={<Icon name="comment" size={26} color="#fff" />} onPress={() => setShowComments(true)} />
              {(!hideCommentCount || isOwner) && <Text style={S.actionLabel}>{formatCount(commentCount)}</Text>}
            </View>
          )}

          <View style={{ alignItems: "center", gap: 4 }}>
            <ActionBtn icon={<IonIcon name="paper-plane" size={26} color="#fff" />} onPress={() => { menu.close(); setShowShare(true); }} />
            {sharesCount > 0 && <Text style={S.actionLabel}>{formatCount(sharesCount)}</Text>}
          </View>

          {canDownload && (
            <View style={{ alignItems: "center", gap: 4 }}>
              <ActionBtn icon={<Icon name="download" size={22} color="#fff" />} onPress={handleDownload} />
              {downloadCount > 0 && <Text style={S.actionLabel}>{formatCount(downloadCount)}</Text>}
            </View>
          )}

          <View style={{ alignItems: "center", gap: 4 }}>
            <ActionBtn icon={<Icon name="eye" size={22} color="#fff" />} onPress={() => setShowViews(true)} />
            <Text style={S.actionLabel}>{formatCount(viewsCount)}</Text>
          </View>

          <ActionBtn icon={<FeatherIcon name={muted ? "volume-x" : "volume-2"} size={22} color="#fff" />} onPress={() => setMuted((v) => !v)} />

          <ActionBtn icon={<Icon name="bookmark" solid={saved} size={22} color="#fff" />} onPress={toggleSave} />

          <View style={{ position: "relative" }}>
            <TouchableOpacity ref={menu.anchorRef} style={S.actionBtn} onPress={menu.open}>
              <Icon name="ellipsis-v" size={20} color="#fff" />
            </TouchableOpacity>
            {menu.visible && (
              <Modal transparent visible={menu.visible} animationType="fade" onRequestClose={menu.close}>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={menu.close}>
                  <View style={[S.menu, { position: "absolute", top: menu.coords.y, right: 60 }]}>
                    {menuOptions.map((opt, i) => (
                      <TouchableOpacity
                        key={opt.key}
                        disabled={opt.disabled}
                        onPress={() => handleMenuAction(opt)}
                        style={[S.menuItem, i === menuOptions.length - 1 && { borderBottomWidth: 0 }]}
                      >
                        <Text style={{ color: opt.disabled ? "#888" : opt.danger ? "#ff5555" : "#fff", fontSize: 14 }}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </TouchableOpacity>
              </Modal>
            )}
          </View>

          {hasStory && (
            <View style={{ alignItems: "center", gap: 4 }}>
              <StoryRing onPress={handleAvatarClick}>
                <Avatar src={profilePic} username={username} size={36} />
              </StoryRing>
              <Text style={S.seeStoryLabel}>See story</Text>
            </View>
          )}
        </View>

        {/* BOTTOM CONTENT */}
        <View style={S.bottomBar}>
          <View style={S.userRow}>
            <CoAuthorHeader
              author={p?.author}
              acceptedCollaborators={acceptedCollaborators}
              onNavigate={goToProfile}
              onOpenCollabList={() => setShowCollabList(true)}
            />
            <FollowButton
              authorId={authorId}
              isPrivate={isPrivate}
              isOwner={isOwner}
              isBlocked={isBlocked}
              myFollowingIds={myFollowingIds}
              onFollowChange={onFollowChange}
              style={S.followBtn}
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
      </View>

      {/* LIKERS SHEET */}
      {showLikers && (
        <BottomSheet
          title="Liked by"
          onClose={() => {
            setShowLikers(false);
            setLikerSearch("");
          }}
        >
          {likedByUsers.length > 0 && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <View style={sheet.searchWrap}>
                <FeatherIcon name="search" size={14} color="#999" />
                <TextInput value={likerSearch} onChangeText={setLikerSearch} placeholder="Search" style={sheet.searchInput} />
                {!!likerSearch && (
                  <TouchableOpacity onPress={() => setLikerSearch("")}>
                    <FeatherIcon name="x" size={14} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          <FlatList
            data={filteredLikers}
            keyExtractor={(u, i) => u._id ?? i.toString()}
            contentContainerStyle={{ paddingHorizontal: 12 }}
            ListEmptyComponent={<Text style={sheet.empty}>{likerSearch ? "No results found" : "No likes yet"}</Text>}
            renderItem={({ item: u }) => (
              <TouchableOpacity
                style={sheet.row}
                onPress={() => {
                  setShowLikers(false);
                  setLikerSearch("");
                  goToProfile(u._id);
                }}
              >
                <Avatar src={u.profilePic} username={u.username} size={40} />
                <View>
                  <Text style={{ fontWeight: "600", fontSize: 14 }}>{u.username}</Text>
                  {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
                </View>
              </TouchableOpacity>
            )}
          />
        </BottomSheet>
      )}

      {/* VIEWERS SHEET */}
      {showViews && (
        <BottomSheet
          title="Viewed by"
          onClose={() => {
            setShowViews(false);
            setViewerSearch("");
          }}
        >
          {viewedByUsers.length > 0 && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <View style={sheet.searchWrap}>
                <FeatherIcon name="search" size={14} color="#999" />
                <TextInput value={viewerSearch} onChangeText={setViewerSearch} placeholder="Search" style={sheet.searchInput} />
                {!!viewerSearch && (
                  <TouchableOpacity onPress={() => setViewerSearch("")}>
                    <FeatherIcon name="x" size={14} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          <FlatList
            data={filteredViewers}
            keyExtractor={(u, i) => u._id ?? i.toString()}
            contentContainerStyle={{ paddingHorizontal: 12 }}
            ListEmptyComponent={<Text style={sheet.empty}>{viewerSearch ? "No results found" : "No views yet"}</Text>}
            renderItem={({ item: u }) => (
              <TouchableOpacity
                style={sheet.row}
                onPress={() => {
                  setShowViews(false);
                  setViewerSearch("");
                  goToProfile(u._id);
                }}
              >
                <Avatar src={u.profilePic} username={u.username} size={40} />
                <View>
                  <Text style={{ fontWeight: "600", fontSize: 14 }}>{u.username}</Text>
                  {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
                </View>
              </TouchableOpacity>
            )}
          />
        </BottomSheet>
      )}

      {/* COLLABORATORS SHEET — NEW, mirrors likers/viewers sheets. Opens
          from the "N others" text in CoAuthorHeader when a post has 3+
          collaborators (author + accepted collaborators). */}
      {showCollabList && (
        <BottomSheet
          title="Collaborators"
          onClose={() => {
            setShowCollabList(false);
            setCollabSearch("");
          }}
        >
          {allCollabPeople.length > 0 && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <View style={sheet.searchWrap}>
                <FeatherIcon name="search" size={14} color="#999" />
                <TextInput value={collabSearch} onChangeText={setCollabSearch} placeholder="Search" style={sheet.searchInput} />
                {!!collabSearch && (
                  <TouchableOpacity onPress={() => setCollabSearch("")}>
                    <FeatherIcon name="x" size={14} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          <FlatList
            data={filteredCollabPeople}
            keyExtractor={(u, i) => u._id ?? i.toString()}
            contentContainerStyle={{ paddingHorizontal: 12 }}
            ListEmptyComponent={<Text style={sheet.empty}>{collabSearch ? "No results found" : "No collaborators"}</Text>}
            renderItem={({ item: u }) => (
              <TouchableOpacity
                style={sheet.row}
                onPress={() => {
                  setShowCollabList(false);
                  setCollabSearch("");
                  goToProfile(u._id);
                }}
              >
                <Avatar src={u.profilePic} username={u.username} size={40} />
                <View>
                  <Text style={{ fontWeight: "600", fontSize: 14 }}>{u.username}</Text>
                  {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
                </View>
              </TouchableOpacity>
            )}
          />
        </BottomSheet>
      )}

      {/* COMMENTS SHEET */}
      {showComments && canComment && (
        <BottomSheet
          title={`Comments (${formatCount(commentCount)})`}
          onClose={() => setShowComments(false)}
          inputBar={
            <View style={sheet.inputBar}>
              <Avatar src={currentUser?.profilePic} username={username} size={32} />
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                onSubmitEditing={addComment}
                placeholder="Add a comment..."
                style={sheet.input}
              />
              <TouchableOpacity onPress={addComment} disabled={!commentText.trim()}>
                <Text style={sheet.postBtnText}>Post</Text>
              </TouchableOpacity>
            </View>
          }
        >
          <CommentSection comments={comments} setComments={setComments} currentUser={currentUser} postId={p._id} postAuthorId={p.author?._id || p.author} />
        </BottomSheet>
      )}

      {/* SHARE SHEET — ShareSheet.js already has its own <Modal>, so it's
          rendered directly with no extra wrapper (matches the fix already
          applied there — wrapping it in another Modal here would nest
          Modals, a separate Android failure mode from the one this file
          had). */}
      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}

      {/* STORY PREVIEW */}
      {showStoryPreview && hasStory && (
        <ReelStoryPreview story={story} onClose={() => setShowStoryPreview(false)} navigation={navigation} />
      )}
    </>
  );
}

function ActionBtn({ icon, onPress }) {
  return (
    <TouchableOpacity style={S.actionBtn} onPress={onPress}>
      {icon}
    </TouchableOpacity>
  );
}

/* ── Main screen: cross-user reel feed for Explore. Vertical paging
   FlatList replaces the web version's scroll-snap div. ── */
function ExploreReels() {
  const navigation = useNavigation();
  const route = useRoute();

  const allVideos = route.params?.allVideos || [];
  const startVideo = route.params?.video || null;

  const orderedVideos = (() => {
    if (!startVideo || allVideos.length === 0) return allVideos;
    const idx = allVideos.findIndex((v) => v._id === startVideo._id);
    if (idx <= 0) return allVideos;
    return [...allVideos.slice(idx), ...allVideos.slice(0, idx)];
  })();

  const idOf = (v) => (v?._id ?? v ?? "").toString();

  const [videosList, setVideosList] = useState(orderedVideos);
  const hadVideosRef = useRef(orderedVideos.length > 0);
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [visibleId, setVisibleId] = useState(orderedVideos[0]?._id ?? null);

  const { followingIds: myFollowingIds } = useFollowStore();
  const { user: authUser, refreshAuth } = useAuth();

  useEffect(() => {
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
    fetchProfileAndFollowing();
  }, []);

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

  const handleFollowChange = (authorId, followed) => {
    if (followed) addFollowing(authorId);
    else removeFollowing(authorId);
  };

  const handleBlock = (blockedAuthorId) => {
    setBlockedIds((prev) => new Set([...prev, blockedAuthorId]));
  };

  const handleVideoDeleted = (deletedId) => {
    setVideosList((prev) => prev.filter((v) => idOf(v) !== deletedId));
  };

  useEffect(() => {
    const patchPrivacy = (list, userId, isPrivate) =>
      list.map((v) => {
        const vAuthorId = v.author?._id ? v.author._id.toString() : v.author?.toString();
        if (vAuthorId !== userId.toString()) return v;
        return {
          ...v,
          author: {
            ...(v.author?._id ? v.author : { _id: v.author }),
            isPrivate,
          },
        };
      });

    const handler = ({ userId, isPrivate }) => {
      setVideosList((prev) => patchPrivacy(prev, userId, isPrivate));
    };

    socket.on("privacyChanged", handler);
    return () => socket.off("privacyChanged", handler);
  }, []);

  const currentUserForFilter = authUser;
  const myIdForFilter = (currentUserForFilter?._id || currentUserForFilter?.id)?.toString();

  const visibleVideos = videosList.filter((v) => {
    const vAuthorId = (v?.author?._id ?? v?.author)?.toString();
    if (blockedIds.has(vAuthorId)) return false;
    if (vAuthorId === myIdForFilter) return true;
    if (v?.author?.isPrivate) return false;
    return true;
  });

  useEffect(() => {
    if (!hadVideosRef.current) return;
    if (visibleVideos.length === 0) navigation.goBack();
  }, [visibleVideos.length]);

  // Replaces the web version's per-card IntersectionObserver — FlatList
  // tells us which item is currently ≥60% visible, and only that card
  // gets isVisible=true (and therefore actually plays its video).
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setVisibleId(viewableItems[0].item._id);
    }
  }).current;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <FeatherIcon name="arrow-left" size={20} color="#fff" />
      </TouchableOpacity>

      {visibleVideos.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 16 }}>No reels available</Text>
        </View>
      ) : (
<FlatList
  data={visibleVideos}
  keyExtractor={(item) => item._id}
  pagingEnabled
  showsVerticalScrollIndicator={false}
  snapToInterval={SCREEN_HEIGHT}
  decelerationRate="fast"
  viewabilityConfig={viewabilityConfig}
  onViewableItemsChanged={onViewableItemsChanged}
  getItemLayout={(_, index) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * index, index })}
  renderItem={({ item: post }) => (
    <View style={{ height: SCREEN_HEIGHT }}>
      <ExploreReelCard
        p={post}
        isVisible={visibleId === post._id}
        onBlock={handleBlock}
        onDeleted={handleVideoDeleted}
        myFollowingIds={myFollowingIds}
        onFollowChange={handleFollowChange}
      />
    </View>
  )}
  initialNumToRender={2}
  maxToRenderPerBatch={2}
  windowSize={3}
  removeClippedSubviews={true}
/>
      )}
    </View>
  );
}

export default ExploreReels;

/* ── Styles ── */
const styles = StyleSheet.create({
  backBtn: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 999,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 19,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
});

const S = StyleSheet.create({
  wrapper: { width: "100%", maxWidth: 480, height: SCREEN_HEIGHT, alignSelf: "center", backgroundColor: "#000", position: "relative" },
  videoBox: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  video: { width: "100%", height: "100%" },
  overlayGradient: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.15)" },
  flashWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  burstOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  rightActions: { position: "absolute", right: 12, bottom: 20, alignItems: "center", gap: 16, zIndex: 25 },
  actionBtn: { alignItems: "center", justifyContent: "center" },
  actionLabel: { color: "#fff", fontSize: 12, fontWeight: "600" },
  menu: {
    backgroundColor: "#1c1c1c",
    borderRadius: 14,
    overflow: "hidden",
    minWidth: 220,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 10,
  },
  menuItem: { paddingVertical: 13, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" },
  bottomBar: { position: "absolute", left: 0, right: 70, bottom: 0, padding: 16, zIndex: 20 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  username: { color: "#fff", fontWeight: "700", fontSize: 16 },
  followBtnOutline: { borderWidth: 1, borderColor: "#fff", paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10 },
  followBtn: {},
  caption: { color: "#fff", fontSize: 14, lineHeight: 19 },
  likesSummary: { color: "#fff", fontSize: 13, marginBottom: 4 },
  moreBtn: { color: "rgba(255,255,255,0.75)", fontWeight: "600" },
  tagChip: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(245,166,35,0.25)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  tagInput: { borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", backgroundColor: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, width: 80 },
  addTagBtn: { backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  collabSearchWrap: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  collabResults: { backgroundColor: "#1c1c1c", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 10, marginTop: 4, overflow: "hidden" },
  collabResultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.08)" },
  seeStoryLabel: { color: "rgb(234,182,118)", fontSize: 10, fontWeight: "700" },
});

/* ── FIX ("mini update" — sheets opening on too small an area of the
   screen, and the confirmed root cause of the invisible-Modal bug): `box`
   previously only declared `maxHeight`. In React Native, an `Animated.View`
   carrying a `transform` needs a determinate `height` on this app's Fabric
   setup — with only `maxHeight`, it either shrinks to fit content or,
   combined with the native-driver mismatch fixed above, fails to paint at
   all. It now has an explicit `height`, fixing both the sizing complaint
   and the root visibility bug together. ── */
const sheet = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  box: { width: "100%", height: SCREEN_HEIGHT * 0.72, maxHeight: "85%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  header: { alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  closeX: { position: "absolute", right: 16, top: 10 },
  row: { flexDirection: "row", gap: 10, marginBottom: 16, alignItems: "flex-start" },
  empty: { textAlign: "center", color: "#aaa", paddingVertical: 20, fontSize: 14 },
  inputBar: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#f0f0f0", paddingVertical: 10, paddingHorizontal: 12, gap: 8 },
  input: { flex: 1, fontSize: 14 },
  postBtnText: { color: "#1877f2", fontWeight: "700", fontSize: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
});

const discRingWrap = {
  width: 46,
  height: 46,
  borderRadius: 23,
  backgroundColor: "rgb(234,182,118)",
  alignItems: "center",
  justifyContent: "center",
  padding: 2,
};
const discRingInner = {
  width: "100%",
  height: "100%",
  borderRadius: 21,
  backgroundColor: "#fff",
  alignItems: "center",
  justifyContent: "center",
};

const RP = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 340, height: "70%", maxHeight: 600, backgroundColor: "#000", borderRadius: 16, overflow: "hidden" },
  deniedCenter: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  username: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 },
  closeBtn: { padding: 4 },
  media: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" },
  mediaEl: { width: "100%", height: "100%" },
  progressWrap: { flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingTop: 8 },
  progressBg: { flex: 1, height: 2, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#fff", borderRadius: 2 },
  navLeft: { position: "absolute", left: 0, top: 0, width: "40%", height: "100%" },
  navRight: { position: "absolute", right: 0, top: 0, width: "60%", height: "100%" },
  ownBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "rgba(0,0,0,0.9)" },
  viewerBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "rgba(0,0,0,0.9)" },
  statPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  iconBtn: { padding: 4 },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: "#fff", fontSize: 13 },
  menu: {
    backgroundColor: "#fff",
    borderRadius: 14,
    minWidth: 210,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#eee",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 8,
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  commentsFeed: { position: "absolute", bottom: 8, left: 8, right: 46, gap: 5, maxHeight: "45%" },
  commentBubble: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", gap: 5, alignSelf: "flex-start", maxWidth: "90%" },
  commentUser: { color: "rgb(234,182,118)", fontSize: 10, fontWeight: "700" },
  commentText: { color: "#fff", fontSize: 12 },
  repostBadge: {
    position: "absolute",
    top: 6,
    left: "50%",
    transform: [{ translateX: -60 }],
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 14,
    paddingLeft: 3,
    paddingRight: 8,
    paddingVertical: 3,
  },
  deniedCloseBtn: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 20,
  },
  viewersOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", alignItems: "center" },
  viewersBox: { backgroundColor: "#fff", width: "100%", maxWidth: 480, maxHeight: "60%", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  viewersHandle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  viewersHeader: { textAlign: "center", paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", fontWeight: "700", fontSize: 15 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
});