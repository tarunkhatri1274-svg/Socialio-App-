import React, { useState, useEffect, useRef, useCallback } from "react";
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
  StyleSheet,
} from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import Icon from "react-native-vector-icons/FontAwesome5";
import Video from "react-native-video";
import Clipboard from "@react-native-clipboard/clipboard";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path — count folders to src/api/authToken.js

const API = Config.API_URL;

function GroupIcon({ size = 20, color = "#999" }) {
  return <Icon name="user-friends" size={size} color={color} />;
}

function Avatar({ src, username, size = 42 }) {
  const letter = username?.[0]?.toUpperCase() || "?";
  if (src) {
    return <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#1877f2",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.38 }}>{letter}</Text>
    </View>
  );
}

export default function ShareSheet({ postId, post, onClose }) {
  console.log('[SHARESHEET] component is rendering, postId =', postId);
  const [users, setUsers] = useState([]);
  const [recent, setRecent] = useState([]);

  const [groups, setGroups] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const searchTimer = useRef(null);

  // ── drag-to-dismiss, same PanResponder pattern used across the other
  // converted bottom sheets ──
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

  // ── Fetch following/recent/groups on mount ──────────────────────────────
  // ── Fetch following/recent/groups on mount ──────────────────────────────
  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `${API}/auth/share/users`;
        const res = await apiFetch(url);
        const data = await res.json();

        if (data.success) {
          setUsers(data.users);
          setFiltered(data.users);
          setRecent(data.recent || []);
          setGroups(data.groups || []);
        } else {
          setError(data.message || "Failed to load users");
        }
      } catch (e) {
        console.error("[ShareSheet] fetch error:", e);
        setError("Network error — check console");
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!search.trim()) {
      setFiltered(users);
      return;
    }

    searchTimer.current = setTimeout(async () => {
      try {
               const url = `${API}/auth/share/users?q=${encodeURIComponent(search)}`;
        const res = await apiFetch(url);
        const data = await res.json();
        if (data.success) setFiltered(data.users);
      } catch {
        setFiltered(users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase())));
      }
    }, 350);

    return () => clearTimeout(searchTimer.current);
  }, [search, users]);

  const toggleSelect = useCallback((userId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }, []);

  const toggleSelectGroup = useCallback((chatId) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      next.has(chatId) ? next.delete(chatId) : next.add(chatId);
      return next;
    });
  }, []);

  const totalSelected = selected.size + selectedGroups.size;

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (totalSelected === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/auth/share`, {
        method: "POST",
      
        body: JSON.stringify({
          postId,
          toUserIds: [...selected],
          toGroupChatIds: [...selectedGroups],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        setTimeout(onClose, 900);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = () => {
    // window.location.href has no RN equivalent — falls back to the
    // post's own media url. Swap in a real deep-link URL here (e.g.
    // https://yourapp.com/post/{postId}) if you have universal/app links
    // set up, since a raw Cloudinary media URL isn't really "the post".
    const url = post?.media?.[0]?.url || "";
    if (!url) return;
    Clipboard.setString(url);
    Alert.alert("", "Link copied!");
  };

  const thumb = post?.media?.[0];
  const showRecent = !search && recent.length > 0;
  const showGroups = !search && groups.length > 0;
  const hasFollowingSplit = !!search && filtered.some((u) => u.isFollowing) && filtered.some((u) => !u.isFollowing);


  
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View {...panResponder.panHandlers} style={[styles.sheet, { transform: [{ translateY }] }]}>
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <Text style={{ fontSize: 15, fontWeight: "700" }}>Share</Text>
              <TouchableOpacity onPress={onClose} style={styles.headerCloseIcon}>
                <FeatherIcon name="x" size={20} color="#111" />
              </TouchableOpacity>
            </View>

            {/* Post preview */}
            <View style={styles.previewStrip}>
              {thumb ? (
                thumb.type === "video" ? (
                  <Video source={{ uri: thumb.url }} style={styles.previewThumb} muted paused resizeMode="cover" />
                ) : (
                  <Image source={{ uri: thumb.url }} style={styles.previewThumb} />
                )
              ) : (
                <View style={[styles.previewThumb, styles.previewThumbFallback]}>
                  <Text style={{ fontSize: 20 }}>📝</Text>
                </View>
              )}
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: "#111" }}>
                  {post?.author?.username || "Post"}
                </Text>
                <Text style={{ fontSize: 12, color: "#888", marginTop: 2 }} numberOfLines={1}>
                  {post?.caption || post?.text || "View post"}
                </Text>
              </View>
            </View>

            {/* Copy link */}
            <TouchableOpacity style={styles.copyLinkBtn} onPress={handleCopyLink}>
              <View style={styles.copyLinkIcon}>
                <Icon name="link" size={16} color="#555" />
              </View>
              <Text style={{ fontSize: 12, color: "#333", fontWeight: "500" }}>Copy link</Text>
            </TouchableOpacity>

            {/* Search */}
            <View style={styles.searchWrap}>
              <FeatherIcon name="search" size={14} color="#aaa" />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search people..." style={styles.searchInput} />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <FeatherIcon name="x" size={14} color="#aaa" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={styles.userList} keyboardShouldPersistTaps="handled">
              {loading && <Text style={styles.emptyText}>Loading...</Text>}
              {!loading && error && <Text style={[styles.emptyText, { color: "#e53935" }]}>{error}</Text>}

              {/* Recent — most recently messaged people */}
              {!loading && !error && showRecent && (
                <>
                  <Text style={styles.sectionLabel}>RECENT</Text>
                  {recent.map((u) => (
                    <UserRow key={`recent-${u._id}`} u={u} isSelected={selected.has(u._id)} onToggle={toggleSelect} />
                  ))}
                </>
              )}

              {/* Groups — share straight into a group chat */}
              {!loading && !error && showGroups && (
                <>
                  <Text style={styles.sectionLabel}>YOUR GROUPS</Text>
                  {groups.map((g) => (
                    <GroupRow key={g.chatId} g={g} isSelected={selectedGroups.has(g.chatId)} onToggle={toggleSelectGroup} />
                  ))}
                </>
              )}

              {!loading && !error && !search && filtered.length > 0 && (
                <Text style={styles.sectionLabel}>FOLLOWING</Text>
              )}
              {!loading && !error && search && !hasFollowingSplit && (
                <Text style={styles.sectionLabel}>
                  {filtered.some((u) => u.isFollowing) ? "FOLLOWING · " : ""}
                  {filtered.some((u) => !u.isFollowing) ? "OTHER USERS" : ""}
                </Text>
              )}

              {!loading && !error && filtered.length === 0 && !showRecent && !showGroups && (
                <Text style={styles.emptyText}>{search ? "No users found" : "Follow someone to share posts with them"}</Text>
              )}

              {!loading && !error && hasFollowingSplit ? (
                <>
                  <Text style={styles.groupLabel}>FOLLOWING</Text>
                  {filtered
                    .filter((u) => u.isFollowing)
                    .map((u) => (
                      <UserRow key={u._id} u={u} isSelected={selected.has(u._id)} onToggle={toggleSelect} />
                    ))}
                  <Text style={styles.groupLabel}>OTHER USERS</Text>
                  {filtered
                    .filter((u) => !u.isFollowing)
                    .map((u) => (
                      <UserRow key={u._id} u={u} isSelected={selected.has(u._id)} onToggle={toggleSelect} />
                    ))}
                </>
              ) : (
                !loading &&
                !error &&
                filtered.map((u) => <UserRow key={u._id} u={u} isSelected={selected.has(u._id)} onToggle={toggleSelect} />)
              )}
            </ScrollView>

            {/* Send button */}
            {totalSelected > 0 && (
              <View style={styles.sendBar}>
                <TouchableOpacity
                  style={[styles.sendBtn, { opacity: sending ? 0.7 : 1, backgroundColor: sent ? "#4caf50" : "#f5a623" }]}
                  onPress={handleSend}
                  disabled={sending}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                    {sent ? "✓ Sent!" : sending ? "Sending..." : `Send (${totalSelected})`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

function UserRow({ u, isSelected, onToggle }) {
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: isSelected ? "#fff8ee" : "transparent" }]}
      onPress={() => onToggle(u._id)}
    >
      <View style={{ position: "relative" }}>
        <Avatar src={u.profilePic} username={u.username} size={46} />
        {isSelected && (
          <View style={styles.selectedBadge}>
            <FeatherIcon name="check" size={10} color="#fff" />
          </View>
        )}
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ fontWeight: "600", fontSize: 14, color: "#111" }}>{u.username}</Text>
        {u.isPrivate && <Text style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>🔒 Private</Text>}
        {!u.isFollowing && <Text style={{ fontSize: 11, color: "#3897f0", marginTop: 1 }}>Public account</Text>}
      </View>
      <View style={[styles.checkCircle, isSelected && { backgroundColor: "#f5a623", borderWidth: 0 }]}>
        {isSelected && <FeatherIcon name="check" size={12} color="#fff" />}
      </View>
    </TouchableOpacity>
  );
}

function GroupRow({ g, isSelected, onToggle }) {
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: isSelected ? "#fff8ee" : "transparent" }]}
      onPress={() => onToggle(g.chatId)}
    >
      <View style={{ position: "relative" }}>
        <View style={styles.groupAvatar}>
          {g.avatar ? <Image source={{ uri: g.avatar }} style={{ width: "100%", height: "100%", borderRadius: 23 }} /> : <GroupIcon />}
        </View>
        {isSelected && (
          <View style={styles.selectedBadge}>
            <FeatherIcon name="check" size={10} color="#fff" />
          </View>
        )}
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ fontWeight: "600", fontSize: 14, color: "#111" }}>{g.name}</Text>
        <Text style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>{g.memberCount} members</Text>
      </View>
      <View style={[styles.checkCircle, isSelected && { backgroundColor: "#f5a623", borderWidth: 0 }]}>
        {isSelected && <FeatherIcon name="check" size={12} color="#fff" />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { width: "100%",height:"75%", maxHeight: "85%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { width: 40, height: 4, backgroundColor: "#ddd", borderRadius: 10, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  header: { alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  headerCloseIcon: { position: "absolute", right: 16, top: 10 },
  previewStrip: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f5f5f5" },
  previewThumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: "#f0f0f0" },
  previewThumbFallback: { alignItems: "center", justifyContent: "center" },
  copyLinkBtn: { alignItems: "center", gap: 5, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f5f5f5" },
  copyLinkIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginTop: 10, marginBottom: 4, backgroundColor: "#f2f2f2", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#111" },
  sectionLabel: { fontSize: 11, fontWeight: "600", color: "#aaa", letterSpacing: 0.6, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  groupLabel: { fontSize: 11, fontWeight: "600", color: "#aaa", letterSpacing: 0.6, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2 },
  userList: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 },
  emptyText: { textAlign: "center", color: "#aaa", paddingVertical: 24, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12 },
  selectedBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f5a623",
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  groupAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#ececec", alignItems: "center", justifyContent: "center" },
  checkCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  sendBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  sendBtn: { width: "100%", paddingVertical: 13, borderRadius: 14, alignItems: "center" },
});