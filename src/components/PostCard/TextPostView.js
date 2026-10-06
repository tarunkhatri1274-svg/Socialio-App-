import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  Animated,
  PanResponder,
  Alert,
  Dimensions,
  StyleSheet,
} from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import FeatherIcon from "react-native-vector-icons/Feather";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path — count folders to src/api/authToken.js
import Config from "react-native-config";
import { useNavigation, useRoute } from "@react-navigation/native";
import socket, { joinPostRoom, leavePostRoom } from "../../sockets/Sockets";
import CommentSection from "./CommentSection";
import ShareSheet from "./ShareSheet";
import { isPostSaved, toggleSavedPost, subscribeSavedPosts } from "../State/SavedPostStore";

const API = Config.API_URL;
// FIX: this file never imported/measured screen dimensions at all, so
// there was nothing to size the sheet against. Added the same
// SCREEN_HEIGHT constant used in the other converted files.
const SCREEN_HEIGHT = Dimensions.get("window").height;



function confirmAsync(message, title = "Confirm") {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

function timeAgo(createdAt) {
  if (!createdAt) return "now";
  const diff = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatCount(num) {
  const n = Number(num) || 0;
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
}

const DOUBLE_TAP_DELAY = 300;
// NOTE: same as PostCard.js — no competing single-tap timer here, so the
// 280ms/300ms race condition fixed in the video files doesn't apply to
// this hook. Left unchanged.
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

/* ── Anchored dropdown menu — same pattern as PostCard.js/Homepage.js,
   since RN has no "click outside" DOM listener to lean on. ── */
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

/* ── Generic drag-to-dismiss bottom sheet, same shape used across the
   other converted files. ──
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
function BottomSheet({ onClose, title, children, inputBar, scrollViewRef }) {
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

/* ── Avatar ── */
function Avatar({ src, username, size = 44, style: extra, onPress }) {
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
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.38 }}>{letter}</Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {content}
    </TouchableOpacity>
  );
}

/* ── Co-author names, "Instagram style" — see PostCard.js for the same
   pattern with fuller comments. ──
   FIX: only used for the 1-2 person case now. 3+ collaborators are shown
   as "first with N others" in CoAuthorHeader and open the new
   CollabListSheet. */
function CoAuthorNames({ people, onNavigate }) {
  const NameText = ({ p }) => <Text onPress={() => onNavigate(p._id)}>{p.username || "Unknown"}</Text>;

  if (people.length === 1) return <NameText p={people[0]} />;
  return (
    <Text>
      <NameText p={people[0]} /> and <NameText p={people[1]} />
    </Text>
  );
}

/* FIX: 1-2 collaborators -> show every name (as before). 3+
   collaborators -> show "first with N others"; tapping "N others" opens
   the CollabListSheet with every collaborator listed and navigable. */
function CoAuthorHeader({ author, acceptedCollaborators, onNavigate, onOpenCollabList }) {
  const people = [author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean);

  if (people.length <= 1) {
    return (
      <>
        <Avatar src={author?.profilePic} username={author?.username} size={44} onPress={() => onNavigate(author?._id)} />
        <Text style={styles.username} onPress={() => onNavigate(author?._id)}>
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
              size={44}
              style={i === 0 ? {} : { marginLeft: -16, borderWidth: 2, borderColor: "#fff" }}
              onPress={() => onNavigate(p._id)}
            />
          ))}
        </View>
        <Text style={styles.username}>
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
            size={44}
            style={i === 0 ? {} : { marginLeft: -16, borderWidth: 2, borderColor: "#fff" }}
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
    </>
  );
}

/* ── Expandable text — "...more" / "less" ── */
function ExpandableText({ text, limit = 240 }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const isLong = text.length > limit;

  if (!isLong || expanded) {
    return (
      <Text style={styles.postText}>
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
    <Text style={styles.postText}>
      {text.slice(0, limit).trimEnd()}...
      <Text onPress={() => setExpanded(true)} style={styles.moreBtn}>
        {" "}more
      </Text>
    </Text>
  );
}

/* ── Mutual/social-proof likes line ── */
function LikesSummary({ likedByUsers, likeCount, hideLikeCount, isOwner, onOpen }) {
  if (hideLikeCount && !isOwner) return null;
  if (!likeCount) return null;
  const first = likedByUsers?.[0];
  const others = likeCount - (first ? 1 : 0);

  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
      <Text style={styles.likesSummary}>
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
            {formatCount(likeCount)} like{likeCount > 1 ? "s" : ""}
          </Text>
        )}
      </Text>
    </TouchableOpacity>
  );
}

/* ── Tags row — tags are used as username mentions, tapping resolves
   against the username-search endpoint. ── */
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

/* ── Collaborators row — owner-only invite search. A previously-declined
   collaborator can be found again in search and re-invited. ── */
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
    <View style={{ marginTop: 8 }}>
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

/* ── Likers sheet — search bar shows whenever there's at least one liker. ── */
function LikersSheet({ likedByUsers, onClose, onNavigate }) {
  const [search, setSearch] = useState("");
  const filtered = likedByUsers.filter((u) => u.username?.toLowerCase().includes(search.toLowerCase()));

  return (
    <BottomSheet title="Liked by" onClose={onClose}>
      {likedByUsers.length > 0 && (
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
          <View style={styles.searchWrap}>
            <FeatherIcon name="search" size={14} color="#999" />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search" style={styles.searchInput} />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <FeatherIcon name="x" size={14} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
        {filtered.length > 0 ? (
          filtered.map((u, i) => (
            <TouchableOpacity
              key={u._id ?? i}
              onPress={() => {
                onClose();
                onNavigate(u._id);
              }}
              style={styles.likerRow}
            >
              <Avatar src={u.profilePic} username={u.username} size={40} />
              <View>
                <Text style={{ fontSize: 15, fontWeight: "600" }}>{u.username}</Text>
                {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyText}>{search ? "No results found" : "No likes yet"}</Text>
        )}
      </View>
    </BottomSheet>
  );
}

/* ── Collaborators sheet — NEW, mirrors LikersSheet above. Opens from the
   "N others" text in CoAuthorHeader when a post has 3+ collaborators
   (author + accepted collaborators). ── */
function CollabListSheet({ people, onClose, onNavigate }) {
  const [search, setSearch] = useState("");
  const filtered = people.filter((u) => u.username?.toLowerCase().includes(search.toLowerCase()));

  return (
    <BottomSheet title="Collaborators" onClose={onClose}>
      {people.length > 0 && (
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
          <View style={styles.searchWrap}>
            <FeatherIcon name="search" size={14} color="#999" />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search" style={styles.searchInput} />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <FeatherIcon name="x" size={14} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
        {filtered.length > 0 ? (
          filtered.map((u, i) => (
            <TouchableOpacity
              key={u._id ?? i}
              onPress={() => {
                onClose();
                onNavigate(u._id);
              }}
              style={styles.likerRow}
            >
              <Avatar src={u.profilePic} username={u.username} size={40} />
              <View>
                <Text style={{ fontSize: 15, fontWeight: "600" }}>{u.username}</Text>
                {!!u.bio && <Text style={{ fontSize: 12, color: "#999" }}>{u.bio}</Text>}
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.emptyText}>{search ? "No results found" : "No collaborators"}</Text>
        )}
      </View>
    </BottomSheet>
  );
}

/* ── Comments sheet ── */
function CommentsSheet({ postId, postAuthorId, username, currentUser, comments, setComments, onClose, highlightCommentId = null, highlightReplyId = null }) {
  const [commentText, setCommentText] = useState("");
  const scrollRef = useRef(null);

  const addComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${postId}`, {
        method: "POST",
       
        body: JSON.stringify({ text: commentText }),
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

  const inputBar = (
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
  );

  return (
    <BottomSheet title={`Comments (${comments.length})`} onClose={onClose} inputBar={inputBar} scrollViewRef={scrollRef}>
      <CommentSection
        comments={comments}
        setComments={setComments}
        currentUser={currentUser}
        postId={postId}
        postAuthorId={postAuthorId}
        highlightCommentId={highlightCommentId}
        highlightReplyId={highlightReplyId}
        scrollRef={scrollRef}
      />
    </BottomSheet>
  );
}

/* ─────────────────────────── PostCard (text post) ─────────────────────────── */
function PostCard({ post, isFirst, onDeleted, onLayout, pendingSheet = null }) {
  const navigation = useNavigation();
  const [, forceRerender] = useState(0);

  const [currentUser, setCurrentUser] = useState({});
  useEffect(() => {
    getCachedUser().then(setCurrentUser);
  }, []);
  const MY_ID = (currentUser?._id || currentUser?.id)?.toString();

  const isOwner = MY_ID === post?.author?._id?.toString() || MY_ID === post?.author?.toString();

  // Per-post visibility/interaction flags set at creation time
  // (CreateTextPost's "Advanced settings"). This card has no download
  // button at all (text posts never had one), so disableDownload has
  // nothing to enforce here — read only for data-shape consistency with
  // the other post types.
  const hideLikeCount = !!post?.hideLikeCount;
  const hideCommentCount = !!post?.hideCommentCount;
  const disableComments = !!post?.disableComments;
  const canComment = !disableComments || isOwner;

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post?.likes?.length || 0);
  const [likedByUsers, setLikedByUsers] = useState([]);
  const [saved, setSaved] = useState(() => isPostSaved(post?._id));
  const menu = useAnchoredMenu();
  const [showLikeBurst, setShowLikeBurst] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isHidden, setIsHidden] = useState(post?.isHiddenFromNonFollowers || false);
  const [isNotInterested, setIsNotInterested] = useState(post?.isNotInterested || false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [comments, setComments] = useState(post?.comments ?? []);
  const [tags, setTags] = useState(post?.tags ?? []);
const [collaborators, setCollaborators] = useState(post?.collaborators ?? []);
const [sharesCount, setSharesCount] = useState(post?.shares?.length ?? post?.sharesCount ?? 0);
const [removedFromView, setRemovedFromView] = useState(false);
  // ← NEW — see Post.js's PostCard for the same pattern.
  const [highlightCommentId, setHighlightCommentId] = useState(null);
  const [highlightReplyId, setHighlightReplyId] = useState(null);
  // ← FIXED — was a plain boolean (applied-once-ever); see Post.js's
  // PostCard for the full reasoning. Track WHICH sheet request was last
  // applied instead, so a genuinely new notification for this same post
  // (e.g. a second reply) still gets applied even without a remount.
  const appliedSheetKeyRef = useRef(null);

  useEffect(() => {
    if (!pendingSheet || !post?._id) return;
    if (pendingSheet.targetId?.toString() !== post._id?.toString()) return;
    const key = `${pendingSheet.sheet}:${pendingSheet.commentId}:${pendingSheet.replyId}`;
    if (appliedSheetKeyRef.current === key) return;
    appliedSheetKeyRef.current = key;
    if (pendingSheet.sheet === "likes") setShowLikers(true);
    if (pendingSheet.sheet === "comments") {
      setShowComments(true);
      setHighlightCommentId(pendingSheet.commentId || null);
      setHighlightReplyId(pendingSheet.replyId || null);
    }
  }, [pendingSheet, post?._id]);

  // ── NEW: collaborator list sheet (mirrors the likers sheet)
  const [showCollabList, setShowCollabList] = useState(false);

  const burstScale = useRef(new Animated.Value(0.3)).current;
  const burstOpacity = useRef(new Animated.Value(0)).current;

  const username = post?.author?.username || "Unknown";
  const authorId = post?.author?._id || post?.author;

  useEffect(() => {
    if (!post?._id) return;
    joinPostRoom(post._id);
    return () => leavePostRoom(post._id);
  }, [post?._id]);

  useEffect(() => {
    if (!post?._id) return;

    const fetchLikers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/likers/${post._id}`);
        const data = await res.json();
        if (data.success) {
          setLikedByUsers(data.likedBy ?? []);
          setLikeCount(data.totalLikes ?? 0);
          setLiked((data.likedBy ?? []).some((u) => u._id?.toString() === MY_ID));
        }
      } catch (err) {
        console.log(err);
      }
    };
    fetchLikers();

    const fetchComments = async () => {
      try {
        const res = await apiFetch(`${API}/auth/get-comment/${post._id}`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch (err) {
        console.log(err);
      }
    };
    fetchComments();


// ← NEW: refresh collaborators from the DB on every mount.
const fetchCollaborators = async () => {
  try {
    const res  = await apiFetch(`${API}/auth/get-post/${post._id}`);
    const data = await res.json();
    if (data.success) setCollaborators(data.post.collaborators ?? []);
  } catch {}
};
fetchCollaborators();
    const onPostLikes = ({ totalLikes, likedBy }) => {
      setLikeCount(totalLikes);
      if (likedBy) {
        setLikedByUsers(likedBy);
        setLiked(likedBy.some((u) => u._id?.toString() === MY_ID));
      }
    };
    const onNewComment = ({ comment }) => {
      setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    };
    const onCommentDeleted = ({ commentId }) => {
      setComments((prev) => prev.filter((c) => c._id !== commentId));
    };
const onDelComment   = ({ commentId }) => setComments(prev => prev.filter(c => c._id !== commentId));
const onCollabResponded = ({ postId }) => {
  if (postId === post._id) fetchCollaborators();
};
    const onPostDeletedForMe = ({ postId }) => {
      if (postId === post._id) {
        setRemovedFromView(true);
        onDeleted?.(post._id);
      }
    };

    const onCollabRemoved = ({ postId, userId }) => {
      if (postId !== post._id) return;
      setCollaborators((prev) => prev.filter((c) => (c.user?._id ?? c.user)?.toString() !== userId));
    };
const onShareCount = ({ postId, totalShares }) => { if (postId === post._id && totalShares != null) setSharesCount(totalShares); };
    socket.on(`post:${post._id}:likes`, onPostLikes);
    socket.on(`post:${post._id}:newComment`, onNewComment);
     socket.on(`post:${post._id}:commentDeleted`, onDelComment);
    socket.on("commentDeleted", onCommentDeleted);
    socket.on("collabResponded", onCollabResponded);
    socket.on("postDeleted", onPostDeletedForMe);
    socket.on("collabRemoved", onCollabRemoved);
socket.on("postShared", onShareCount);
    return () => {
      socket.off(`post:${post._id}:likes`, onPostLikes);
      socket.off(`post:${post._id}:newComment`, onNewComment);
      socket.off(`post:${post._id}:commentDeleted`, onDelComment);
      socket.off("commentDeleted", onCommentDeleted);
      socket.off("collabResponded", onCollabResponded);
      socket.off("postDeleted", onPostDeletedForMe);
      socket.off("collabRemoved", onCollabRemoved);
      socket.off("postShared", onShareCount);
    };
  }, [post?._id, authorId, MY_ID]);

  useEffect(() => {
    const unsub = subscribeSavedPosts((postId, savedState) => {
      if (postId === post?._id) setSaved(savedState);
    });
    return unsub;
  }, [post?._id]);

  const toggleSave = () => toggleSavedPost(post);

  // Core like toggle, split so double-tap can call it directly.
  const performLike = async () => {
    try {
      const res = await apiFetch(`${API}/auth/like/${post._id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setLiked(data.liked);
        setLikeCount(data.totalLikes);
        if (data.likedBy) setLikedByUsers(data.likedBy);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleLike = () => performLike();

  const triggerBurst = () => {
    if (!liked) performLike();
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
  // Double-tap-to-like on the post body (text + media) — only LIKES,
  // never unlikes, same convention as the image/video post cards.
  const handleBodyTap = useDoubleTap(triggerBurst);

  const handleDelete = async () => {
    menu.close();
    const ok = await confirmAsync("Delete this post?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/delete-post/${post._id}`, { method: "DELETE"});
      const data = await res.json();
      if (res.ok) {
        setRemovedFromView(true);
        onDeleted?.(post._id);
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleHide = async () => {
    menu.close();
    try {
      const res = await apiFetch(`${API}/auth/hide-from-non-followers/${post._id}`, { method: "PATCH"});
      const data = await res.json();
      if (res.ok) {
        setIsHidden(data.isHidden);
        Alert.alert("", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleNotInterested = async () => {
    menu.close();
    try {
      const res = await apiFetch(`${API}/auth/not-interested/${post._id}`, { method: "PATCH"});
      const data = await res.json();
      if (data.success) {
        setIsNotInterested((prev) => !prev);
        Alert.alert("", data.message);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleBlock = async () => {
    menu.close();
    const ok = await confirmAsync(`Block ${username}?`);
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/block/${authorId}`, { method: "POST"});
      const data = await res.json();
      if (data.success) setIsBlocked(true);
    } catch (err) {
      console.log(err);
    }
  };

  const handleRemoveCollab = async (collabUser) => {
    menu.close();
    const isLeavingSelf = collabUser?._id?.toString() === MY_ID;
    const confirmMsg = isLeavingSelf
      ? "Remove yourself as a collaborator on this post? It will no longer show on your profile."
      : `Remove ${collabUser?.username} as a collaborator? The post will no longer show on their profile.`;
    const ok = await confirmAsync(confirmMsg);
    if (!ok) return;

    try {
      const res = await apiFetch(`${API}/auth/remove-collaborator/${post._id}`, {
        method: "PATCH",
       
        body: JSON.stringify({ userId: collabUser._id }),
      });
      const data = await res.json();
      if (data.success) {
        setCollaborators(data.collaborators ?? []);
        if (isLeavingSelf && !isOwner) {
          setRemovedFromView(true);
          onDeleted?.(post._id);
        }
      }
    } catch {}
  };

const goToProfile = (id) => {
  if (id) navigation.navigate("UserProfile", { userId: id });
};

  const acceptedCollaborators = (collaborators || []).filter((c) => c.status === "accepted");
  const myCollabEntry = acceptedCollaborators.find((c) => (c.user?._id ?? c.user)?.toString() === MY_ID);

  // ── NEW: full collaborator roster (author + accepted collaborators),
  // used by CollabListSheet — same shape as likedByUsers.
  const allCollabPeople = [post?.author, ...acceptedCollaborators.map((c) => c.user)].filter(Boolean);

  const menuOptions = isOwner
    ? [
        { label: "Delete", icon: "trash", color: "#e53935", action: handleDelete },
        { label: isHidden ? "Show to everyone" : "Hide from non-followers", icon: "eye-slash", color: "#222", action: handleHide },
        ...acceptedCollaborators.map((c) => ({
          label: `Remove collab: ${c.user?.username}`,
          icon: "ban",
          color: "#e53935",
          action: () => handleRemoveCollab(c.user),
        })),
      ]
    : isBlocked
    ? [{ label: "Blocked", icon: "ban", color: "#888", disabled: true, action: () => {} }]
    : [
        { label: isNotInterested ? "Interested" : "Not Interested", icon: "thumbs-down", color: "#222", action: handleNotInterested },
        { label: `Block ${username}`, icon: "ban", color: "#e53935", action: handleBlock },
        ...(myCollabEntry
          ? [{ label: "Remove myself as collaborator", icon: "ban", color: "#e53935", action: () => handleRemoveCollab(myCollabEntry.user) }]
          : []),
      ];

  if (removedFromView) return null;

  return (
    <>
      <View onLayout={onLayout} style={[styles.postWrap, { borderTopWidth: isFirst ? 0 : 1 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <CoAuthorHeader
              author={post?.author}
              acceptedCollaborators={acceptedCollaborators}
              onNavigate={goToProfile}
              onOpenCollabList={() => setShowCollabList(true)}
            />
            <Text style={styles.timeText}>{timeAgo(post?.createdAt)}</Text>
          </View>

          <TouchableOpacity ref={menu.anchorRef} onPress={menu.open} style={styles.menuTrigger}>
            <Icon name="ellipsis-h" size={15} color="#666" />
          </TouchableOpacity>
          <AnchoredMenu visible={menu.visible} coords={menu.coords} onClose={menu.close}>
            {menuOptions.map((opt, i) => (
              <TouchableOpacity
                key={i}
                disabled={opt.disabled}
                onPress={opt.action}
                style={[styles.menuItem, i === menuOptions.length - 1 && { borderBottomWidth: 0 }]}
              >
                <Icon name={opt.icon} size={13} color={opt.color} />
                <Text style={{ fontSize: 14, fontWeight: "500", color: opt.color }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </AnchoredMenu>
        </View>

        <TouchableOpacity activeOpacity={1} onPress={handleBodyTap} style={{ width: "100%", marginTop: 10, position: "relative" }}>
          {(post?.text || post?.caption) && <ExpandableText text={post?.text || post?.caption} />}

          {post?.media?.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              {post.media.map((m, i) => (
                <View
                  key={i}
                  style={{
                    marginRight: 8,
                    width: post.media.length === 1 ? 280 : 240,
                    borderRadius: 14,
                    overflow: "hidden",
                    backgroundColor: "#f0f0f0",
                  }}
                >
                  <Image source={{ uri: m.url }} style={{ width: "100%", height: 240 }} resizeMode="cover" />
                </View>
              ))}
            </ScrollView>
          )}

          {showLikeBurst && (
            <View style={styles.burstOverlay} pointerEvents="none">
              <Animated.View style={{ transform: [{ scale: burstScale }], opacity: burstOpacity }}>
                <Icon name="thumbs-up" solid size={70} color="#f5a623" />
              </Animated.View>
            </View>
          )}

          <TagsRow tags={tags} postId={post._id} isOwner={isOwner} onTagsUpdate={setTags} />
          <CollabRow collaborators={collaborators} postId={post._id} isOwner={isOwner} onCollabUpdate={setCollaborators} />

          <LikesSummary
            likedByUsers={likedByUsers}
            likeCount={likeCount}
            hideLikeCount={hideLikeCount}
            isOwner={isOwner}
            onOpen={() => setShowLikers(true)}
          />

          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={handleLike} style={styles.actionBtn}>
              <Icon name="heart" solid={liked} size={20} color={liked ? "#e53935" : "#555"} />
              {(!hideLikeCount || isOwner) && (
                <Text onPress={() => setShowLikers(true)} style={{ fontSize: 14, color: liked ? "#e53935" : "#555", fontWeight: "600" }}>
                  {formatCount(likeCount)}
                </Text>
              )}
            </TouchableOpacity>

            {canComment && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => setShowComments(true)}>
                <Icon name="comment" size={19} color="#555" />
                {(!hideCommentCount || isOwner) && comments.length > 0 && (
                  <Text style={styles.countText}>{formatCount(comments.length)}</Text>
                )}
              </TouchableOpacity>
            )}

<TouchableOpacity style={styles.actionBtn} onPress={() => { menu.close(); setShowShare(true); }}>
  <Icon name="paper-plane" size={18} color="#555" />
  <Text style={styles.countText}>{formatCount(sharesCount)}</Text>
</TouchableOpacity>

            <TouchableOpacity
              onPress={toggleSave}
              style={[styles.actionBtn, { flex: 0, width: 48, backgroundColor: saved ? "#fff8e1" : "#efefef" }]}
            >
              <Icon name="bookmark" solid={saved} size={18} color={saved ? "#f5a623" : "#555"} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>

      {showLikers && <LikersSheet likedByUsers={likedByUsers} onClose={() => setShowLikers(false)} onNavigate={goToProfile} />}

      {/* COLLABORATORS SHEET — NEW, mirrors LikersSheet above. */}
      {showCollabList && (
        <CollabListSheet people={allCollabPeople} onClose={() => setShowCollabList(false)} onNavigate={goToProfile} />
      )}

      {showComments && canComment && (
        <CommentsSheet
          postId={post._id}
          postAuthorId={post.author?._id || post.author}
          username={username}
          currentUser={currentUser}
          comments={comments}
          setComments={setComments}
          onClose={() => { setShowComments(false); setHighlightCommentId(null); setHighlightReplyId(null); }}
          highlightCommentId={highlightCommentId}
          highlightReplyId={highlightReplyId}
        />
      )}

      {showShare && <ShareSheet postId={post._id} post={post} onClose={() => setShowShare(false)} />}
    </>
  );
}

/* ─────────────────────────── TextPostView (screen) ─────────────────────────── */
function TextPostView() {
  const route = useRoute();
  const navigation = useNavigation();
  const { id, post: statePost, allPosts: stateAllPosts, sheet, commentId, replyId } = route.params || {};
  const stateInitialPosts = stateAllPosts || (statePost ? [statePost] : []);
  // ← NEW — see Post.js's Post() for the same pattern.
  const pendingSheet = sheet ? { targetId: id, sheet, commentId: commentId || null, replyId: replyId || null } : null;

  const idOf = (v) => (v?._id ?? v ?? "").toString();

const [postsList, setPostsList] = useState(stateInitialPosts);
const [loading, setLoading] = useState(!!id && stateInitialPosts.length === 0);
const [notFound, setNotFound] = useState(false);
const hadPostsRef = useRef(stateInitialPosts.length > 0);
const clickedId = idOf(statePost) || id;
const didInitialScrollRef = useRef(false);

  const scrollRef = useRef(null);
  const postYOffsets = useRef({}); // postId -> y offset, captured via onLayout

  useEffect(() => {
    if (!id && stateInitialPosts.length === 0) return;
    if (stateInitialPosts.length > 0) {
      // Keep the original order — don't move the clicked post to the top.
      setPostsList(stateInitialPosts);
      setNotFound(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setPostsList([]);
    apiFetch(`${API}/auth/get-post/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success && data.post) {
          setPostsList([data.post]);
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
  }, [id]);


  useEffect(() => {
    if (postsList.length > 0) hadPostsRef.current = true;
  }, [postsList]);

  const handlePostDeleted = (deletedId) => {
    setPostsList((prev) => prev.filter((p) => idOf(p) !== deletedId));
  };

useEffect(() => {
  if (!hadPostsRef.current) return;
  if (postsList.length === 0) {
    const ownerId =
      postsList[0]?.author?._id || postsList[0]?.author || stateInitialPosts[0]?.author?._id || stateInitialPosts[0]?.author;
    if (!ownerId) {
      navigation.goBack();
      return;
    }
    const oid = ownerId.toString();
    getCachedUser().then((currentUser) => {
      const currentUserId = (currentUser?._id || currentUser?.id)?.toString();
      if (currentUserId && oid === currentUserId) {
        navigation.navigate("Profile");
      } else {
        navigation.navigate("UserProfile", { userId: oid });
      }
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [postsList.length]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: "#999" }}>Loading post...</Text>
      </View>
    );
  }

  if (postsList.length === 0 || notFound) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: "#999" }}>Post not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <FeatherIcon name="arrow-left" size={22} color="#222" />
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: "700" }}>TEXTPOSTS</Text>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView ref={scrollRef}>
        {postsList.map((post, index) => (
          <PostCard
            key={post._id || index}
            post={post}
            isFirst={index === 0}
            onDeleted={handlePostDeleted}
            pendingSheet={pendingSheet}
            onLayout={(e) => {
              const y = e.nativeEvent.layout.y;
              postYOffsets.current[idOf(post)] = y;
              if (!didInitialScrollRef.current && idOf(post) === clickedId) {
                didInitialScrollRef.current = true;
                scrollRef.current?.scrollTo({ y, animated: false });
              }
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export default TextPostView;

/* ─────────────────────────── Styles ─────────────────────────── */
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff", maxWidth: 600, width: "100%", alignSelf: "center" },
  topBar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#efefef",
    backgroundColor: "#fff",
  },
  backBtn: { padding: 6 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  postWrap: { paddingTop: 16, borderTopColor: "#efefef" },
  username: { fontWeight: "700", fontSize: 15, color: "#111" },
  timeText: { color: "#999", fontSize: 13 },
  postText: { fontSize: 15, lineHeight: 23, color: "#111" },
  moreBtn: { color: "#8e8e8e", fontWeight: "700" },
  likesSummary: { fontSize: 13, color: "#333", marginTop: 6 },

  menuTrigger: { padding: 8, borderRadius: 8 },
  dropdown: {
    backgroundColor: "#fff",
    borderRadius: 14,
    minWidth: 205,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#eee",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f0f0f0",
  },

  burstOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff3e0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  tagInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, width: 80 },
  addTagBtn: { backgroundColor: "#f5f5f5", borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },

  collabSearchWrap: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: "#ddd", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  collabResults: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee", borderRadius: 10, marginTop: 4, overflow: "hidden" },
  collabResultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#f5f5f5" },

  actionsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, paddingBottom: 14 },
  actionBtn: { flex: 1, height: 40, borderRadius: 10, backgroundColor: "#c8c8c8", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  countText: { fontSize: 14, color: "#555", fontWeight: "600" },

  // FIX ("mini update" — sheets opening on too small an area of the
  // screen, and the confirmed root cause of the invisible-Modal bug):
  // `sheet` previously only declared `maxHeight`. In React Native, an
  // `Animated.View` carrying a `transform` needs a determinate `height`
  // on this app's Fabric setup — with only `maxHeight`, it either
  // shrinks to fit content or, combined with the native-driver mismatch
  // fixed in BottomSheet above, fails to paint at all. It now has an
  // explicit `height`, fixing both the sizing complaint and the root
  // visibility bug together.
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)", justifyContent: "flex-end" },
  sheet: { width: "100%", height: SCREEN_HEIGHT * 0.7, maxHeight: "85%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHandle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 12, marginBottom: 8 },
  sheetHeader: { alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  sheetCloseIcon: { position: "absolute", right: 16, top: 0 },

  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 32, fontSize: 15 },
  likerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },

  commentInputBar: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#f0f0f0", paddingVertical: 10, paddingHorizontal: 12, gap: 8 },
});