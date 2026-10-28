import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Image,
  Animated,
  Platform,
  TextInput,
  ScrollView,
  StyleSheet,
  Dimensions,
  PanResponder,
  TouchableOpacity,
  ActivityIndicator,
  InteractionManager,
  KeyboardAvoidingView,
} from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import { REACTIONS, REACTION_MAP } from "./Reactions";

const SCREEN_HEIGHT = Dimensions.get("window").height;

/* ════════════════════════════════════════════════════════════════════════
   BottomSheet — ONE shared sheet used by every post card for the Likes,
   Comments, Viewers, Collaborators … sheets (the Share sheet keeps its own
   ShareSheet.js, which already wraps its own <Modal>).

   Props
     title          header text
     onClose        called on backdrop tap / X / swipe-down / Android back
     children       sheet body
     inputBar       optional node pinned under the body (comment input)
     scrollViewRef  optional ref for the inner ScrollView (scrollable=true)
     scrollable     true (default)  → body is wrapped in a ScrollView
                    false           → body gets a plain flex:1 View (use when
                                      the body has its own list / scroller)
     animationType  Modal animation, default "fade"
   ════════════════════════════════════════════════════════════════════════ */
export function BottomSheet({
  title,
  onClose,
  children,
  inputBar,
  scrollViewRef,
  scrollable = true,
  animationType = "fade",
}) {
  // Render the heavy body only after the open animation, so the sheet itself
  // paints instantly instead of stalling on a big comments / likers list.
  const [ready, setReady] = useState(false);
  // runAfterInteractions can stay pending forever when any other animation /
  // timer on the screen keeps an "interaction" open (and it's deprecated in
  // newer React Native), which left the sheet stuck on its spinner. The
  // timeout guarantees the body shows within ~0.3s no matter what.
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    const task = InteractionManager.runAfterInteractions(finish);
    const timer = setTimeout(finish, 300);
    return () => {
      done = true;
      task.cancel?.();
      clearTimeout(timer);
    };
  }, []);

  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Drag-to-close works ONLY from the handle + header
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 2 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.6) {
          Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: false }).start(() =>
            onCloseRef.current()
          );
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
      },
    })
  ).current;

  const body = ready ? children : <ActivityIndicator style={{ marginTop: 30 }} color="#999" />;

  return (
    <Modal visible transparent animationType={animationType} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[s.sheet, { transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} style={{ paddingBottom: 4 }}>
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={s.title}>{title}</Text>
              <TouchableOpacity
                onPress={onClose}
                style={s.closeIcon}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <FeatherIcon name="x" size={20} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          {scrollable ? (
            <ScrollView
              ref={scrollViewRef}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {body}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>{body}</View>
          )}
          {inputBar}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── tiny avatar so this file has no dependency on any card's own Avatar ── */
function SheetAvatar({ src, username, size = 40 }) {
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
      <Text style={{ color: "#fff", fontWeight: "600", fontSize: size * 0.4 }}>
        {username?.[0]?.toUpperCase() || "?"}
      </Text>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   countReactions(users) → { all: 12, like: 5, love: 4, haha: 2, ... }
   A liker with no `reaction` (an old like) counts as "like".
   ════════════════════════════════════════════════════════════════════════ */
export function countReactions(users = []) {
  const counts = { all: users.length };
  users.forEach((u) => {
    const k = REACTION_MAP[u?.reaction] ? u.reaction : "like";
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

/* ── compact "👍 5  ❤️ 4  😆 2" count format (used by tabs; exported so a
      card can also show it elsewhere, e.g. under the like button) ── */
export function formatReactionCounts(counts) {
  return REACTIONS.filter((r) => counts?.[r.key] > 0)
    .map((r) => `${r.emoji} ${counts[r.key]}`)
    .join("  ");
}

/* ════════════════════════════════════════════════════════════════════════
   LikesSheet — the shared "Liked by" sheet.

   Top row of tabs:  [ All 12 ] [ 👍 5 ] [ ❤️ 4 ] [ 😆 2 ] …
   (only reactions that actually exist get a tab). Tapping a tab filters
   the list to people who used that reaction. Every row also shows the
   emoji that person picked.

   Props
     users       array of { _id, username, profilePic, bio, reaction }
     onClose     close handler
     onNavigate  (userId) => void   — row tap (sheet closes first)
     loading     optional boolean, shows "Loading..."
   ════════════════════════════════════════════════════════════════════════ */
export function LikesSheet({ users = [], onClose, onNavigate, loading = false }) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");

  const counts = useMemo(() => countReactions(users), [users]);

  // if the active tab empties out (someone changed their reaction live), fall back to All
  useEffect(() => {
    if (tab !== "all" && !counts[tab]) setTab("all");
  }, [counts, tab]);

  const filtered = users.filter((u) => {
    const k = REACTION_MAP[u?.reaction] ? u.reaction : "like";
    if (tab !== "all" && k !== tab) return false;
    return u.username?.toLowerCase().includes(search.toLowerCase());
  });

  const presentReactions = REACTIONS.filter((r) => counts[r.key] > 0);

  return (
    <BottomSheet title="Liked by" onClose={onClose}>
      {/* ── reaction count tabs ── */}
      {users.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.tabsRow}
        >
          <TouchableOpacity
            onPress={() => setTab("all")}
            style={[s.tab, tab === "all" && s.tabActive]}
            activeOpacity={0.8}
          >
            <Text style={[s.tabText, tab === "all" && s.tabTextActive]}>All {counts.all}</Text>
          </TouchableOpacity>
          {presentReactions.map((r) => (
            <TouchableOpacity
              key={r.key}
              onPress={() => setTab(r.key)}
              style={[s.tab, tab === r.key && s.tabActive]}
              activeOpacity={0.8}
            >
              <Text style={s.tabEmoji}>{r.emoji}</Text>
              <Text style={[s.tabText, tab === r.key && s.tabTextActive]}>{counts[r.key]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── search ── */}
      {users.length > 0 && (
        <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6 }}>
          <View style={s.searchWrap}>
            <FeatherIcon name="search" size={14} color="#999" />
            <TextInput value={search} onChangeText={setSearch} placeholder="Search" style={s.searchInput} />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <FeatherIcon name="x" size={14} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── list ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20 }}>
        {loading ? (
          <Text style={s.empty}>Loading...</Text>
        ) : filtered.length === 0 ? (
          <Text style={s.empty}>{search || tab !== "all" ? "No results found" : "No likes yet"}</Text>
        ) : (
          filtered.map((u, i) => {
            const r = REACTION_MAP[u?.reaction] || REACTION_MAP.like;
            return (
              <TouchableOpacity
                key={u._id ?? i}
                style={s.row}
                onPress={() => {
                  onClose();
                  onNavigate?.(u._id);
                }}
              >
                <View>
                  <SheetAvatar src={u.profilePic} username={u.username} size={40} />
                  <View style={s.badge}>
                    <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600" }}>{u.username}</Text>
                  {!!u.bio && (
                    <Text style={{ fontSize: 12, color: "#999" }} numberOfLines={1}>
                      {u.bio}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    width: "100%",
    height: SCREEN_HEIGHT * 0.72,
    maxHeight: SCREEN_HEIGHT * 0.85,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: { width: 48, height: 5, backgroundColor: "#ccc", borderRadius: 10, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  header: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  title: { fontWeight: "700", fontSize: 15 },
  closeIcon: { position: "absolute", right: 16, top: 12, padding: 4 },

  tabsRow: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 8 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: "#f0f0f0",
  },
  tabActive: { backgroundColor: "#e7f0fe" },
  tabEmoji: { fontSize: 16 },
  tabText: { fontSize: 13, fontWeight: "600", color: "#555" },
  tabTextActive: { color: "#1877f2" },

  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  empty: { textAlign: "center", color: "#aaa", paddingVertical: 28, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});

export default BottomSheet;