import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated,
  PanResponder,
  Alert,
  Linking,
  Dimensions,
  StyleSheet,
  FlatList,
  Platform,
  PermissionsAndroid,
} from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import FeatherIcon from "react-native-vector-icons/Feather";
import Video from "react-native-video";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path — count folders to src/api/authToken.js
import Config from "react-native-config";
import { useNavigation, useRoute } from "@react-navigation/native";
import socket, { joinPostRoom, leavePostRoom } from "../../sockets/Sockets";
import ShareSheet from "./ShareSheet";
import CommentSection from "./CommentSection";
import { useFollowStore } from "../../pages/Profile/UseFollowState";
import { isPostSaved, toggleSavedPost, subscribeSavedPosts } from "../State/SavedPostStore";

const API = Config.API_URL;
const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;


function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

function timeAgo(d) {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

const DOUBLE_TAP_DELAY = 300;
// NOTE: unlike Video.js/Videopost.js, this hook has no competing single-tap
// timer — a single tap on a static post's media does nothing, only a
// double tap triggers `onDoubleTap`. That means the 280ms/300ms race
// condition fixed in the video files (single-tap action firing a few ms
// before the double-tap window closed) doesn't apply to this pattern; a
// single tap here was never scheduled to do anything in the first place.
// Left unchanged.
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

/* ── Anchored dropdown menu — measures the trigger button's on-screen
   position and renders the menu in a transparent full-screen Modal whose
   backdrop press closes it. Same pattern used in the Homepage/Navbar
   conversions, since RN has no "click outside" DOM listener. ── */
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
        <View style={[styles.dropdown, { position: "absolute", top: coords.y + 4, right: 12 }]}>{children}</View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ── Generic bottom sheet (drag-to-dismiss via PanResponder), same
   shape as the one built for Homepage.js's LikersSheet/CommentsSheet. ──
   FIX (root cause confirmed via the ShareSheet debugging session): this
   used `useNativeDriver: true` on the spring-back animation while
   `translateY` is driven manually via `setValue()` during the drag (not
   through `Animated.event`). Mixing those two on this app's Fabric / New
   Architecture setup desyncs the native animated node graph and the
   whole sheet silently fails to paint — no error, no crash, just nothing
   on screen. This is exactly why Likers/Comments weren't opening while
   ShareSheet (already fixed the same way in its own file) was fine.
   `useNativeDriver: false` matches how the value is actually driven, so
   there's no JS/native thread mismatch anymore. */
function BottomSheet({ title, onClose, children, inputBar, scrollViewRef }) {
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
        <Animated.View {...panResponder.panHandlers} style={[styles.sheet, { transform: [{ translateY }] }]}>
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={{ fontWeight: "700", fontSize: 15 }}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.sheetCloseIcon}>
                <FeatherIcon name="x" size={18} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView ref={scrollViewRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {inputBar}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

/* ── Render co-author names "Instagram style" as individually pressable
   spans. ──
   FIX: only used for the 1-2 person case now. 3+ collaborators are shown
   as "first with N others" in CoAuthorHeader and open the new
   CollabListSheet, instead of dumping every name inline with no way to
   tap through to the ones past the 3rd. */
function CoAuthorNames({ people, onNavigate }) {
  const NameText = ({ p }) => (
    <Text onPress={() => onNavigate(p._id)}>{p.username || "Unknown"}</Text>
  );

  if (people.length === 1) return <NameText p={people[0]} />;
  return (
    <Text>
      <NameText p={people[0]} /> and <NameText p={people[1]} />
    </Text>
  );
}

function Avatar({ src, username, size = 35, style: extraStyle, onPress }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  const content = src ? (
    <Image source={{ uri: src }} style={[{ width: size, height: size, borderRadius: size / 2 }, extraStyle]} />
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
        extraStyle,
      ]}
    >
      <Text style={{ color: "#fff", fontWeight: "600", fontSize: size * 0.4 }}>{letter}</Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {content}
    </TouchableOpacity>
  );
}

/* ── Stacked co-author avatars + combined names. ──
   FIX: 1-2 collaborators -> show every name (as before). 3+
   collaborators -> show "first with N others"; tapping "N others" opens
   the CollabListSheet (same pattern as the likers sheet) with every
   collaborator listed and navigable. */
function CoAuthorHeader({ author, acceptedCollaborators, onNavigate, onOpenCollabList }) {
  const people = [author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean);

  if (people.length <= 1) {
    return (
      <View style={styles.userInfo}>
        <Avatar src={author?.profilePic} username={author?.username} size={38} onPress={() => onNavigate(author?._id)} />
        <Text style={styles.username} onPress={() => onNavigate(author?._id)}>
          {author?.username}
        </Text>
      </View>
    );
  }

  if (people.length === 2) {
    return (
      <View style={styles.userInfo}>
        <View style={{ flexDirection: "row" }}>
          {people.map((p, i) => (
            <Avatar
              key={p._id ?? i}
              src={p.profilePic}
              username={p.username}
              size={38}
              style={i === 0 ? {} : { marginLeft: -14, borderWidth: 2, borderColor: "#fff" }}
              onPress={() => onNavigate(p._id)}
            />
          ))}
        </View>
        <Text style={styles.username}>
          <CoAuthorNames people={people} onNavigate={onNavigate} />
        </Text>
      </View>
    );
  }

  // 3+ collaborators: "first with N others", "N others" opens the sheet
  const first = people[0];
  const remaining = people.length - 1;
  return (
    <View style={styles.userInfo}>
      <View style={{ flexDirection: "row" }}>
        {people.slice(0, 3).map((p, i) => (
          <Avatar
            key={p._id ?? i}
            src={p.profilePic}
            username={p.username}
            size={38}
            style={i === 0 ? {} : { marginLeft: -14, borderWidth: 2, borderColor: "#fff" }}
            onPress={() => onNavigate(p._id)}
          />
        ))}
      </View>
      <Text style={styles.username}>
        <Text onPress={() => onNavigate(first?._id)}>{first?.username || "Unknown"}</Text>
        {" "}with{" "}
        <Text style={{ textDecorationLine: "underline" }} onPress={() => onOpenCollabList?.()}>
          {remaining} other{remaining > 1 ? "s" : ""}
        </Text>
      </Text>
    </View>
  );
}

/* ── Caption with "...more" / "less" — Instagram-style truncation with
   tap-to-expand and tap-to-collapse. ── */
function CaptionText({ text, limit = 100 }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text>
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
    <Text>
      {text.slice(0, limit).trimEnd()}...
      <Text onPress={() => setExpanded(true)} style={styles.moreBtn}>
        {" "}more
      </Text>
    </Text>
  );
}

/* ── Media carousel — swipe is handled natively by the horizontal
   ScrollView's own paging (no manual PanResponder needed, unlike the web
   version's hand-rolled touch-delta swipe detection). Double-tap-to-like
   uses the same useDoubleTap hook as elsewhere in this app, layered over
   the media via a TouchableWithoutFeedback-style press handler. ── */
function MediaCarousel({ media, onDoubleTapLike }) {
  const [current, setCurrent] = useState(0);
  const [showBurst, setShowBurst] = useState(false);
  const burstScale = useRef(new Animated.Value(0.3)).current;
  const burstOpacity = useRef(new Animated.Value(0)).current;
  const total = media?.length || 0;

  const triggerBurst = () => {
    onDoubleTapLike?.();
    setShowBurst(true);
    burstScale.setValue(0.3);
    burstOpacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(burstScale, { toValue: 1.15, duration: 210, useNativeDriver: true }),
        Animated.timing(burstOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]),
      Animated.timing(burstScale, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(burstOpacity, { toValue: 0, duration: 180, delay: 130, useNativeDriver: true }),
    ]).start(() => setShowBurst(false));
  };
  const handleTap = useDoubleTap(triggerBurst);

  const onMomentumScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrent(Math.max(0, Math.min(idx, total - 1)));
  };

  if (total === 0) return null;
  const item = media[current];

  return (
    <View style={{ position: "relative", backgroundColor: "#000" }}>
      <TouchableOpacity activeOpacity={1} onPress={handleTap}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
        >
          {media.map((m, i) =>
            m.type === "video" ? (
              <Video
                key={i}
                source={{ uri: m.url }}
                style={{ width: SCREEN_WIDTH, height: 460 }}
                resizeMode="contain"
                controls
                paused={i !== current}
              />
            ) : (
              <Image key={i} source={{ uri: m.url }} style={{ width: SCREEN_WIDTH, height: 460 }} resizeMode="cover" />
            )
          )}
        </ScrollView>
      </TouchableOpacity>

      {showBurst && (
        <View style={styles.burstOverlay} pointerEvents="none">
          <Animated.View style={{ transform: [{ scale: burstScale }], opacity: burstOpacity }}>
            <Icon name="thumbs-up" solid size={90} color="#fff" />
          </Animated.View>
        </View>
      )}

      {total > 1 && (
        <>
          <View style={styles.dotsWrap} pointerEvents="none">
            {media.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { width: i === current ? 18 : 6, backgroundColor: i === current ? "#fff" : "rgba(255,255,255,0.5)" },
                ]}
              />
            ))}
          </View>
          <View style={styles.counterWrap} pointerEvents="none">
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
              {current + 1} / {total}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

/* ── Tags row — tags are used as username mentions (see CreateImagePost's
   Tags section). Tapping a tag resolves it against the username-search
   endpoint and navigates on an exact (case-insensitive) match, same as
   the web fix. ── */
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
       
        body: JSON.stringify({ tag: t }),
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
       
        body: JSON.stringify({ tag }),
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
    if (match) navigation.navigate("UserProfile", { userId: match._id });
  } catch {}
};

  if (!tags?.length && !isOwner) return null;

  return (
    <View style={styles.tagsRow}>
      {tags?.map((t) => (
        <View key={t} style={styles.tagChip}>
          <Text onPress={() => goToTaggedUser(t)} style={{ color: "#f5a623", fontSize: 12, fontWeight: "600" }}>
            #{t}
          </Text>
          {isOwner && (
            <TouchableOpacity onPress={() => removeTag(t)} style={{ marginLeft: 3 }}>
              <FeatherIcon name="x" size={10} color="#f5a623" />
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
              autoFocus
              style={styles.tagInput}
            />
            <TouchableOpacity onPress={addTag} style={styles.addTagBtn}>
              <Text style={{ color: "#666", fontSize: 12 }}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowInput(false)}>
              <FeatherIcon name="x" size={12} color="#aaa" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setShowInput(true)} style={styles.addTagBtn}>
            <Text style={{ color: "#666", fontSize: 12 }}>+ tag</Text>
          </TouchableOpacity>
        ))}
    </View>
  );
}

/* ── Collaborators row — owner-only "invite more collaborators" search.
   Only a live pending/accepted entry blocks a user from re-appearing in
   search; a declined user shows back up and can be re-invited, matching
   the backend's addCollaborator fix. ── */
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
        
        body: JSON.stringify({ userId }),
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
    <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
      {showSearch ? (
        <View>
          <View style={styles.collabSearchWrap}>
            <FeatherIcon name="search" size={12} color="#aaa" />
            <TextInput
              value={search}
              onChangeText={handleSearch}
              placeholder="Invite a collaborator..."
              autoFocus
              style={{ flex: 1, fontSize: 13 }}
            />
            <TouchableOpacity
              onPress={() => {
                setShowSearch(false);
                setSearch("");
                setResults([]);
              }}
            >
              <FeatherIcon name="x" size={12} color="#aaa" />
            </TouchableOpacity>
          </View>
          {results.length > 0 && (
            <View style={styles.collabResults}>
              {results
                .filter((u) => !collaborators.some((c) => c.user?._id === u._id && c.status !== "declined"))
                .map((u) => {
                  const declined = collaborators.some((c) => c.user?._id === u._id && c.status === "declined");
                  return (
                    <TouchableOpacity key={u._id} onPress={() => addCollab(u._id)} style={styles.collabResultRow}>
                      <Avatar src={u.profilePic} username={u.username} size={28} />
                      <Text style={{ fontSize: 13, fontWeight: "600" }}>{u.username}</Text>
                      {declined && (
                        <Text style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>declined — invite again</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity onPress={() => setShowSearch(true)} style={[styles.addTagBtn, { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }]}>
          <FeatherIcon name="users" size={11} color="#666" />
          <Text style={{ color: "#666", fontSize: 12 }}>+ invite collaborator</Text>
        </TouchableOpacity>
      )}
      {collaborators.some((c) => c.status === "pending") && (
        <Text style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>
          {collaborators.filter((c) => c.status === "pending").map((c) => c.user?.username).join(", ")} invited — waiting
          for them to accept.
        </Text>
      )}
    </View>
  );
}

/* ── Mutual/social-proof likes line — "Liked by X and N others", tappable
   to open the full likers sheet. ── */
function LikesSummary({ likedByUsers, likesCount, hideLikeCount, isOwner, onOpen }) {
  if (hideLikeCount && !isOwner) return null;
  if (!likesCount) return null;
  const first = likedByUsers?.[0];
  const others = likesCount - (first ? 1 : 0);

  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
      <Text style={styles.mutualLikes}>
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

/* ─────────────────────────── PostCard ─────────────────────────── */
function PostCard({ p, onDeleted, pendingSheet = null }) {
  const navigation = useNavigation();
  const [, forceRerender] = useState(0);

  const [currentUser, setCurrentUser] = useState({});
  useEffect(() => {
    getCachedUser().then(setCurrentUser);
  }, []);
  const currentUserId = currentUser?._id || currentUser?.id;
  const authorId = p?.author?._id || p?.author;
  const isOwner =
    currentUserId?.toString() === p?.author?._id?.toString() || currentUserId?.toString() === p?.author?.toString();

  const [isPrivate, setIsPrivate] = useState(p?.author?.isPrivate ?? false);

  useEffect(() => {
    const onPrivacy = ({ userId, isPrivate: priv }) => {
      if (userId === authorId?.toString()) setIsPrivate(priv);
    };
    socket.on("privacyChanged", onPrivacy);
    return () => socket.off("privacyChanged", onPrivacy);
  }, [authorId]);

  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(p?.likes?.length || 0);
  const [likedByUsers, setLikedByUsers] = useState([]);
  const [saved, setSaved] = useState(() => isPostSaved(p?._id));
  const menu = useAnchoredMenu();
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [likerSearch, setLikerSearch] = useState("");
  const [isNotInterested, setIsNotInterested] = useState(p?.isNotInterested || false);
  const [isHidden, setIsHidden] = useState(p?.isHiddenFromNonFollowers || false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [comments, setComments] = useState(p?.comments ?? []);
  const [tags, setTags] = useState(p?.tags ?? []);
  const [collaborators, setCollaborators] = useState(p?.collaborators ?? []);
  const [sharesCount, setSharesCount] = useState(p?.shares?.length ?? p?.sharesCount ?? 0);
  const [downloadsCount, setDownloadsCount] = useState(p?.downloads?.length ?? p?.downloadsCount ?? 0);
  const [removedFromView, setRemovedFromView] = useState(false);
  // ← NEW — which comment/reply (if any) to scroll to + highlight once
  // the Comments sheet opens, set from a notification handoff (route
  // params — see Post()'s pendingSheet below).
  const [highlightCommentId, setHighlightCommentId] = useState(null);
  const [highlightReplyId, setHighlightReplyId] = useState(null);
  const commentsScrollRef = useRef(null);
  // ← FIXED — was a plain boolean (applied-once-ever), which permanently
  // blocked re-applying if you're already viewing this exact post and a
  // NEW notification (e.g. a second reply) arrives for it. React
  // Navigation updates route.params without remounting when you
  // navigate to a screen already in the stack, so p._id staying the same
  // doesn't mean the notification is the same one — track WHICH sheet
  // request was last applied instead, so a genuinely different one
  // (different comment/reply/sheet) still gets applied.
  const appliedSheetKeyRef = useRef(null);

  // ← NEW — a tap on a like/comment/reply notification (see
  // ActivityPage.js's getNotificationTarget) leaves the target sheet in
  // this screen's route params. Apply it once we know this is actually
  // the post it was meant for.
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

  // ── NEW: collaborator list sheet (mirrors the likers sheet)
  const [showCollabList, setShowCollabList] = useState(false);
  const [collabSearch, setCollabSearch] = useState("");

  const username = p?.author?.username || p?.username || "Unknown";
  const caption = p?.caption || "";

  const hideLikeCount = !!p?.hideLikeCount;
  const hideCommentCount = !!p?.hideCommentCount;
  const disableDownload = !!p?.disableDownload;
  const disableComments = !!p?.disableComments;
  const canDownload = !disableDownload || isOwner;
  const canComment = !disableComments || isOwner;

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
          setLikedByUsers(data.likedBy ?? []);
          setLikesCount(data.totalLikes ?? 0);
          setLiked((data.likedBy ?? []).some((u) => u._id === currentUserId));
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


// ← NEW: refresh collaborators from the DB on every mount, so an
// accept/decline/removal that happened while this screen wasn't
// mounted shows up immediately instead of relying on the stale
// route params post object.
const fetchCollaborators = async () => {
  try {
    const res  = await apiFetch(`${API}/auth/get-post/${p._id}`);
    const data = await res.json();
    if (data.success) setCollaborators(data.post.collaborators ?? []);
  } catch {}
};
fetchCollaborators();
    const onLikes = ({ totalLikes, likedBy }) => {
      setLikesCount(totalLikes);
      if (likedBy) {
        setLikedByUsers(likedBy);
        setLiked(likedBy.some((u) => u._id === currentUserId));
      }
    };
    const onNewComment = ({ comment }) =>
      setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    const onDelComment = ({ commentId }) => setComments((prev) => prev.filter((c) => c._id !== commentId));

const onCollabResponded = ({ postId }) => {
  if (postId === p._id) fetchCollaborators();
};

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

    const onShareCount = ({ postId, totalShares }) => {
      if (postId === p._id && totalShares != null) setSharesCount(totalShares);
    };
    const onDownloadCount = ({ postId, totalDownloads }) => {
      if (postId === p._id && totalDownloads != null) setDownloadsCount(totalDownloads);
    };

    socket.on(`post:${p._id}:likes`, onLikes);
    socket.on(`post:${p._id}:newComment`, onNewComment);
    socket.on(`post:${p._id}:commentDeleted`, onDelComment);
    socket.on("commentDeleted", onDelComment);
    socket.on("collabResponded", onCollabResponded);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("collabRemoved", onCollabRemoved);
    socket.on("postShared", onShareCount);
    socket.on("postDownloaded", onDownloadCount);

    return () => {
      socket.off(`post:${p._id}:likes`, onLikes);
      socket.off(`post:${p._id}:newComment`, onNewComment);
      socket.off(`post:${p._id}:commentDeleted`, onDelComment);
      socket.off("commentDeleted", onDelComment);
      socket.off("collabResponded", onCollabResponded);
      socket.off("postDeleted", onPostDeletedForMe);
      socket.off("collabRemoved", onCollabRemoved);
      socket.off("postShared", onShareCount);
      socket.off("postDownloaded", onDownloadCount);
    };
  }, [p?._id, authorId, currentUserId]);

  useEffect(() => {
    const unsub = subscribeSavedPosts((postId, savedState) => {
      if (postId === p?._id) setSaved(savedState);
    });
    return unsub;
  }, [p?._id]);

  const toggleSave = () => toggleSavedPost(p);

  const handleToggleLike = async () => {
    try {
      const res = await apiFetch(`${API}/auth/like/${p._id}`, { method: "POST"});
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikesCount(data.totalLikes);
        if (data.likedBy) setLikedByUsers(data.likedBy);
      }
    } catch {}
  };

  // Double-tap gesture from MediaCarousel — only LIKES, never unlikes,
  // matching Instagram's convention (repeat double-taps just replay the
  // animation).
  const handleDoubleTapLike = () => {
    if (!liked) handleToggleLike();
  };

  const handleBlock = async () => {
    if (isBlocked) return;
    const ok = await confirmAsync(`Block ${username}?`);
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/block/${authorId}`, { method: "POST"});
      const data = await res.json();
      if (data.success) {
        setIsBlocked(true);
        menu.close();
      }
    } catch {}
  };

  const handleDelete = async () => {
    const ok = await confirmAsync("Delete this post?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/delete-post/${p._id}`, { method: "DELETE"});
      const data = await res.json();
      if (res.ok) {
        setRemovedFromView(true);
        onDeleted?.(p._id);
      } else {
        Alert.alert("Error", data.message);
      }
    } catch {}
  };

  const HideFromNonFollowers = async () => {
    try {
      const res = await apiFetch(`${API}/auth/hide-from-non-followers/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHidden);
        Alert.alert("", data.message);
      }
    } catch {}
  };

  const notInterested = async () => {
    try {
      const res = await apiFetch(`${API}/auth/not-interested/${p._id}`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) {
        setIsNotInterested((prev) => !prev);
        Alert.alert("", data.message);
      }
    } catch {}
  };

  const handleRemoveCollab = async (collabUser) => {
    const isLeavingSelf = collabUser?._id?.toString() === currentUserId?.toString();
    const confirmMsg = isLeavingSelf
      ? "Remove yourself as a collaborator on this post? It will no longer show on your profile."
      : `Remove ${collabUser?.username} as a collaborator? The post will no longer show on their profile.`;
    const ok = await confirmAsync(confirmMsg);
    if (!ok) return;

    try {
      const res = await apiFetch(`${API}/auth/remove-collaborator/${p._id}`, {
        method: "PATCH",
       
        body: JSON.stringify({ userId: collabUser._id }),
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

  const acceptedCollaborators = (collaborators || []).filter((c) => c.status === "accepted");
  const myCollabEntry = acceptedCollaborators.find((c) => (c.user?._id ?? c.user)?.toString() === currentUserId?.toString());

  // ── NEW: full collaborator roster (author + accepted collaborators),
  // used by the CollabListSheet — same shape as likedByUsers.
  const allCollabPeople = [p?.author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean);
  const filteredCollabPeople = allCollabPeople.filter((u) =>
    u.username?.toLowerCase().includes(collabSearch.toLowerCase())
  );

  const buildMenuOptions = () => {
    const opts = [];
    if (isOwner) {
      opts.push({ key: "delete", label: "Delete", danger: true, action: handleDelete });
      opts.push({
        key: "hide",
        label: isHidden ? "Show to everyone" : "Hide from non-followers",
        action: HideFromNonFollowers,
      });
      // FIXED — key was `remove-${c.user?._id}`. If the backend sends a
      // collaborator entry where `user` isn't populated (a raw id string,
      // or missing), c.user?._id is undefined for every one of them, so
      // 2+ collaborators all got the literal key "remove-undefined" —
      // the duplicate-key warning seen in logcat. Falling back through
      // c.user (in case it's a raw id string) and finally the loop
      // index guarantees uniqueness regardless of population state.
      acceptedCollaborators.forEach((c, i) => {
        const uid = c.user?._id || c.user || i;
        opts.push({
          key: `remove-${uid}`,
          label: `Remove collab: ${c.user?.username ?? "Unknown"}`,
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
  };

  const menuOptions = buildMenuOptions();

  const handleMenuAction = (opt) => {
    if (opt.disabled) return;
    menu.close();
    opt.action();
  };

  // Download all media straight to the device — no chooser, no "open with
  // Chrome". Linking.openURL only ever hands the URL to the OS, which is
  // why it surfaced an app picker instead of actually saving anything.
  // Fix: pull the bytes ourselves with react-native-blob-util and write
  // them straight into the gallery via @react-native-camera-roll/camera-roll.
  const requestSavePermission = async () => {
    if (Platform.OS !== "android") return true; // iOS prompts via Info.plist (NSPhotoLibraryAddUsageDescription)
    if (Platform.Version >= 33) return true; // scoped storage — CameraRoll.save doesn't need a runtime perm on API 33+
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: "Storage permission",
        message: "Allow access to save this post to your gallery.",
        buttonPositive: "Allow",
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const download = async () => {
    if (!canDownload) return;
    try {
      const hasPermission = await requestSavePermission();
      if (!hasPermission) {
        Alert.alert("Permission needed", "Storage access is required to save this post.");
        return;
      }

      const items = p?.media || [];
      const { dirs } = ReactNativeBlobUtil.fs;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isVideo = item.type === "video" || /\.(mp4|mov|m4v)(\?|$)/i.test(item.url);
        const ext = isVideo ? "mp4" : "jpg";
        const fileName = `${p._id || "post"}_${Date.now()}_${i}.${ext}`;
        const localPath = `${dirs.CacheDir}/${fileName}`;

        // Download the actual bytes to a local file (this is the part
        // Linking.openURL never did — it just deep-linked out to a browser).
        const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true }).fetch(
          "GET",
          item.url
        );

        // Hand the local file to the OS gallery/photos app directly.
        await CameraRoll.save(`file://${res.path()}`, {
          type: isVideo ? "video" : "photo",
          album: "Downloads",
        });

        if (i < items.length - 1) await new Promise((r) => setTimeout(r, 200));
      }

      setDownloadsCount((prev) => prev + 1);
      Alert.alert("Saved", "Post saved to your gallery.");
    } catch (err) {
      Alert.alert("Download failed", "Something went wrong while saving this post.");
    }
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${p._id}`, {
        method: "POST",
        
        body: JSON.stringify({ text: commentText }),
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) => (prev.some((c) => c._id === data.comment._id) ? prev : [...prev, data.comment]));
        setCommentText("");
      }
    } catch {}
  };

  const filteredLikers = likedByUsers.filter((u) => u.username?.toLowerCase().includes(likerSearch.toLowerCase()));
  const goToProfile = (userId) => userId && navigation.navigate("UserProfile", { userId });

  if (removedFromView) return null;

  return (
    <>
      <View style={styles.card}>
        <View style={styles.header}>
          <CoAuthorHeader
            author={p?.author}
            acceptedCollaborators={acceptedCollaborators}
            onNavigate={goToProfile}
            onOpenCollabList={() => setShowCollabList(true)}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              onPress={toggleSave}
              style={[styles.headerIconBtn, { backgroundColor: saved ? "#fff3e0" : "#f0f0f0" }]}
            >
              <Icon name="bookmark" solid={saved} size={15} color={saved ? "#f5a623" : "#888"} />
            </TouchableOpacity>
            <TouchableOpacity ref={menu.anchorRef} onPress={menu.open} style={styles.headerIconBtn}>
              <Icon name="ellipsis-v" size={15} color="#555" />
            </TouchableOpacity>
            <AnchoredMenu visible={menu.visible} coords={menu.coords} onClose={menu.close}>
              {menuOptions.map((opt, i) => (
                <TouchableOpacity
                  key={opt.key}
                  disabled={opt.disabled}
                  onPress={() => handleMenuAction(opt)}
                  style={[styles.menuItem, i === menuOptions.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Text style={{ fontSize: 14, fontWeight: "500", color: opt.disabled ? "#888" : opt.danger ? "#e53935" : "#333" }}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </AnchoredMenu>
          </View>
        </View>

        <MediaCarousel media={p?.media} onDoubleTapLike={handleDoubleTapLike} />

        <View style={styles.actions}>
          <TouchableOpacity onPress={handleToggleLike} style={styles.actionBtn}>
            <Icon name="thumbs-up" solid={liked} size={16} color={liked ? "#f5a623" : "#666"} />
            {(!hideLikeCount || isOwner) && (
              <Text onPress={() => setShowLikers(true)} style={styles.likesCountText}>
                {formatCount(likesCount)}
              </Text>
            )}
          </TouchableOpacity>
          {canComment && (
            <TouchableOpacity onPress={() => setShowComments(true)} style={styles.actionBtn}>
              <Icon name="comment" size={16} color="#666" />
              {(!hideCommentCount || isOwner) && comments.length > 0 && (
                <Text style={styles.likesCountText}>{formatCount(comments.length)}</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { menu.close(); setShowShare(true); }} style={styles.actionBtn}>
            <Icon name="paper-plane" size={16} color="#666" />
            {sharesCount > 0 && <Text style={styles.likesCountText}>{formatCount(sharesCount)}</Text>}
          </TouchableOpacity>
          {canDownload && (
            <TouchableOpacity onPress={download} style={styles.actionBtn}>
              <Icon name="download" size={16} color="#666" />
              {downloadsCount > 0 && <Text style={styles.likesCountText}>{formatCount(downloadsCount)}</Text>}
            </TouchableOpacity>
          )}
        </View>

        <LikesSummary
          likedByUsers={likedByUsers}
          likesCount={likesCount}
          hideLikeCount={hideLikeCount}
          isOwner={isOwner}
          onOpen={() => setShowLikers(true)}
        />

        {!!caption && (
          <Text style={styles.caption}>
            <Text style={{ fontWeight: "700" }} onPress={() => goToProfile(authorId)}>
              {username}{" "}
            </Text>
            <CaptionText text={caption} />
          </Text>
        )}
        <TagsRow tags={tags} postId={p._id} isOwner={isOwner} onTagsUpdate={setTags} />
        <CollabRow collaborators={collaborators} postId={p._id} isOwner={isOwner} onCollabUpdate={setCollaborators} />
      </View>

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
              <View style={styles.searchWrap}>
                <FeatherIcon name="search" size={14} color="#999" />
                <TextInput value={likerSearch} onChangeText={setLikerSearch} placeholder="Search" style={styles.searchInput} />
                {!!likerSearch && (
                  <TouchableOpacity onPress={() => setLikerSearch("")}>
                    <FeatherIcon name="x" size={14} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          <View style={{ paddingHorizontal: 12 }}>
            {filteredLikers.length > 0 ? (
              filteredLikers.map((u, i) => (
                <TouchableOpacity
                  key={u._id ?? i}
                  style={styles.likerRow}
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
              ))
            ) : (
              <Text style={styles.emptyText}>{likerSearch ? "No results found" : "No likes yet"}</Text>
            )}
          </View>
        </BottomSheet>
      )}

      {/* COLLABORATORS SHEET — NEW, mirrors the likers sheet. Opens from
          the "N others" text in CoAuthorHeader when a post has 3+
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
              <View style={styles.searchWrap}>
                <FeatherIcon name="search" size={14} color="#999" />
                <TextInput value={collabSearch} onChangeText={setCollabSearch} placeholder="Search" style={styles.searchInput} />
                {!!collabSearch && (
                  <TouchableOpacity onPress={() => setCollabSearch("")}>
                    <FeatherIcon name="x" size={14} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          <View style={{ paddingHorizontal: 12 }}>
            {filteredCollabPeople.length > 0 ? (
              filteredCollabPeople.map((u, i) => (
                <TouchableOpacity
                  key={u._id ?? i}
                  style={styles.likerRow}
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
              ))
            ) : (
              <Text style={styles.emptyText}>{collabSearch ? "No results found" : "No collaborators"}</Text>
            )}
          </View>
        </BottomSheet>
      )}

      {showComments && (
        <BottomSheet
          title={`Comments (${formatCount(comments.length)})`}
          onClose={() => { setShowComments(false); setHighlightCommentId(null); setHighlightReplyId(null); }}
          scrollViewRef={commentsScrollRef}
          inputBar={
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
          }
        >
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
        </BottomSheet>
      )}

      {showShare && <ShareSheet postId={p._id} post={p} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── Post (screen) ─────────────────────────── */
function Post() {
  const route = useRoute();
  const navigation = useNavigation();
  const { id, post: statePost, allPosts: initialPosts = [], sheet, commentId, replyId } = route.params || {};
  // ← NEW — built once per screen mount; PostCard checks pendingSheet.targetId
  // against its own p._id before applying it, so only the deep-linked post
  // (not every card in the surrounding FlatList) reacts to it.
  const pendingSheet = sheet ? { targetId: id, sheet, commentId: commentId || null, replyId: replyId || null } : null;

  const idOf = (v) => (v?._id ?? v ?? "").toString();
  const [currentUser, setCurrentUser] = useState({});
  useEffect(() => {
    getCachedUser().then(setCurrentUser);
  }, []);
  const currentUserId = currentUser?._id || currentUser?.id;
  const goToOwnerProfile = (ownerId) => {
    if (!ownerId) {
      navigation.goBack();
      return;
    }
    const oid = ownerId.toString();
    if (currentUserId && oid === currentUserId.toString()) {
      navigation.navigate("Profile");
    } else {
      navigation.navigate("UserProfile", { userId: oid });
    }
  };
  const [fetchedPost, setFetchedPost] = useState(null);
  const [loading, setLoading] = useState(!statePost);
  const [notFound, setNotFound] = useState(false);

  const post = statePost || fetchedPost;

  const [postsList, setPostsList] = useState(initialPosts);
  const hadPostsRef = useRef(initialPosts.length > 0);

  const scrollRef = useRef(null);
  const targetYRef = useRef(0);

  useEffect(() => {
    if (statePost || !id) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    apiFetch(`${API}/auth/get-post/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success && data.post) {
          setFetchedPost(data.post);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, statePost]);

  // Web's scrollIntoView({block:"start"}) has no direct RN equivalent —
  // instead, the target PostCard reports its own Y offset via onLayout,
  // and once we have it we scroll the surrounding ScrollView there.
  useEffect(() => {
    if (targetYRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ y: targetYRef.current, animated: false });
    }
  }, [post?._id]);

  const handlePostDeleted = (deletedId) => {
    setPostsList((prev) => prev.filter((item) => idOf(item) !== deletedId));
    if (!statePost && deletedId === idOf(post)) {
      goToOwnerProfile(post?.author?._id || post?.author);
    }
  };

  useEffect(() => {
    if (!hadPostsRef.current) return;
    if (postsList.length === 0) {
      goToOwnerProfile(post?.author?._id || post?.author);
    }
  }, [postsList.length]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: "#aaa", fontSize: 18 }}>Loading post...</Text>
      </View>
    );
  }

  if (!post || notFound) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: "#aaa", fontSize: 18 }}>No post found</Text>
      </View>
    );
  }
if (!statePost) {
  return (
    <ScrollView ref={scrollRef}>
      <PostCard p={post} onDeleted={handlePostDeleted} pendingSheet={pendingSheet} />
    </ScrollView>
  );
}

const currentIndex = postsList.findIndex((item) => idOf(item) === idOf(post));

const ESTIMATED_ITEM_HEIGHT = 600; // rough avg height of a PostCard — tune to taste

return (
  <FlatList
    ref={scrollRef}
    data={postsList}
    keyExtractor={(item) => item._id}
    initialScrollIndex={currentIndex >= 0 ? currentIndex : 0}
    getItemLayout={(data, index) => ({
      length: ESTIMATED_ITEM_HEIGHT,
      offset: ESTIMATED_ITEM_HEIGHT * index,
      index,
    })}
    onScrollToIndexFailed={(info) => {
      setTimeout(() => {
        scrollRef.current?.scrollToIndex({ index: info.index, animated: false });
      }, 300);
    }}
    maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
    initialNumToRender={1}
    maxToRenderPerBatch={3}
    windowSize={5}
    removeClippedSubviews={false}
    renderItem={({ item: p }) => (
      <PostCard p={p} onDeleted={handlePostDeleted} pendingSheet={pendingSheet} />
    )}
  />
);
}

export default Post;
export { PostCard };

/* ─────────────────────────── Styles ─────────────────────────── */
const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderBottomWidth: 8, borderBottomColor: "#f5f5f5" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12 },
  userInfo: { flexDirection: "row", gap: 10, alignItems: "center", flexShrink: 1 },
  username: { fontWeight: "700", fontSize: 14, lineHeight: 18 },

  headerIconBtn: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f0f0" },

  dropdown: {
    backgroundColor: "#fff",
    borderRadius: 12,
    minWidth: 220,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#eee",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  menuItem: { paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },

  burstOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  dotsWrap: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 4 },
  dot: { height: 6, borderRadius: 3 },
  counterWrap: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },

  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  actionBtn: { flex: 1, height: 42, borderRadius: 10, backgroundColor: "#ebebeb", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  likesCountText: { fontSize: 13, fontWeight: "600", color: "#444" },
  mutualLikes: { paddingHorizontal: 12, paddingTop: 2, fontSize: 13, color: "#333" },
  caption: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14, fontSize: 14, lineHeight: 21, color: "#222" },
  moreBtn: { color: "#8e8e8e", fontWeight: "700" },

  tagsRow: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  tagChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff3e0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  tagInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, width: 80 },
  addTagBtn: { backgroundColor: "#f5f5f5", borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },

  collabSearchWrap: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  collabResults: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee", borderRadius: 10, marginTop: 4, overflow: "hidden" },
  collabResultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#f5f5f5" },

  // FIX ("mini update" — sheets opening on too small an area of the
  // screen, and the confirmed root cause of the invisible-Modal bug):
  // `sheet` previously only declared `maxHeight`. In React Native, an
  // `Animated.View` carrying a `transform` needs a determinate `height`
  // on this app's Fabric setup — with only `maxHeight`, it either
  // shrinks to fit content or, combined with the native-driver mismatch
  // fixed in BottomSheet above, fails to paint at all. It now has an
  // explicit `height`, fixing both the sizing complaint and the root
  // visibility bug together.
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { width: "100%", height: SCREEN_HEIGHT * 0.72, maxHeight: "85%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHandle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  sheetHeader: { alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  sheetCloseIcon: { position: "absolute", right: 16, top: 10 },

  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 20, fontSize: 14 },
  likerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },

  commentInputBar: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#f0f0f0", paddingVertical: 10, paddingHorizontal: 12, gap: 8 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", marginTop: 40 },
});