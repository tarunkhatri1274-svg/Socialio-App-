import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  ActivityIndicator,
  Animated,
  PanResponder,
  Alert,
  Dimensions,
  StyleSheet,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import FeatherIcon from "react-native-vector-icons/Feather";
import Video from "react-native-video";
import LinearGradient from "react-native-linear-gradient";
import { apiFetch, getAuthToken } from "../../api/authToken"; // adjust relative path
import Config from "react-native-config";

const GOLDEN = "rgb(234,182,118)";
const API = Config.API_URL;
const SCREEN_WIDTH = Dimensions.get("window").width;



/* ── Mention search sheet — reuses the same "search users" endpoint the
   DM composer uses (excludes self + blocked, returns username + profilePic) ── */
function MentionSearchSheet({ onClose, onSelect }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef(null);

  const runSearch = useCallback((query) => {
    setLoading(true);
    apiFetch(`${API}/messages/search-users?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((data) => setUsers(data.success ? data.users : []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  // seed with default listing (following list) on open, before typing
  useEffect(() => {
    setLoading(true);
    apiFetch(`${API}/messages/search-users?includeSuggested=true`)
      .then((r) => r.json())
      .then((data) => setUsers(data.success ? data.users || data.following || [] : []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) return;
    timer.current = setTimeout(() => runSearch(q), 300);
    return () => clearTimeout(timer.current);
  }, [q, runSearch]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={mentionStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={mentionStyles.sheet}>
          <View style={mentionStyles.handle} />
          <View style={mentionStyles.searchRow}>
            <FeatherIcon name="search" size={16} color="#999" />
            <TextInput
              autoFocus
              value={q}
              onChangeText={setQ}
              placeholder="Search people to mention…"
              style={mentionStyles.searchInput}
            />
            <TouchableOpacity onPress={onClose} style={mentionStyles.closeBtn}>
              <FeatherIcon name="x" size={18} color="#999" />
            </TouchableOpacity>
          </View>
          <ScrollView style={mentionStyles.list}>
            {loading && <Text style={mentionStyles.empty}>Loading…</Text>}
            {!loading && users.length === 0 && <Text style={mentionStyles.empty}>No users found</Text>}
            {!loading &&
              users.map((u) => (
                <TouchableOpacity key={u._id} style={mentionStyles.row} onPress={() => onSelect(u)}>
                  {u.profilePic ? (
                    <Image source={{ uri: u.profilePic }} style={mentionStyles.avatar} />
                  ) : (
                    <View style={mentionStyles.avatarFallback}>
                      <Text style={{ color: "#fff", fontWeight: "700" }}>{u.username?.[0]?.toUpperCase() || "?"}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={mentionStyles.username}>{u.username}</Text>
                    {!!u.bio && (
                      <Text style={mentionStyles.bio} numberOfLines={1}>
                        {u.bio}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ── Draggable overlay chips — the web version tracked pointer position
   as a % of the container's bounding rect on every pointermove. RN has
   no pointer-capture/getBoundingClientRect, so this uses PanResponder,
   converting the gesture's absolute screen coordinates into the same
   %-of-container math via the container's size (captured once via
   onLayout in the parent and passed down as containerSize). ── */
function TextOverlayEl({ item, containerSize, onChange, onRemove }) {
  const [selfSize, setSelfSize] = useState({ width: 0, height: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gesture) => {
        if (!containerSize.width) return;
        const x = (gesture.moveX / containerSize.width) * 100;
        const y = (gesture.moveY / containerSize.height) * 100;
        onChange(item.id, { x: Math.min(96, Math.max(4, x)), y: Math.min(96, Math.max(4, y)) });
      },
    })
  ).current;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setSelfSize(e.nativeEvent.layout)}
      style={{
        position: "absolute",
        left: `${item.x}%`,
        top: `${item.y}%`,
        marginLeft: -selfSize.width / 2,
        marginTop: -selfSize.height / 2,
        maxWidth: SCREEN_WIDTH * 0.8,
        padding: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Text
        style={{
          color: item.color,
          fontSize: item.fontSize,
          fontWeight: "700",
          textAlign: item.align,
        }}
      >
        {item.text}
      </Text>
      <TouchableOpacity onPress={() => onRemove(item.id)} style={overlayStyles.removeBtn}>
        <Text style={{ color: "#fff", fontSize: 11 }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ── A draggable mention chip ("@username") on the story canvas ── */
function MentionChipEl({ item, containerSize, onChange, onRemove }) {
  const [selfSize, setSelfSize] = useState({ width: 0, height: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gesture) => {
        if (!containerSize.width) return;
        const x = (gesture.moveX / containerSize.width) * 100;
        const y = (gesture.moveY / containerSize.height) * 100;
        onChange(item.id, { x: Math.min(94, Math.max(6, x)), y: Math.min(94, Math.max(6, y)) });
      },
    })
  ).current;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setSelfSize(e.nativeEvent.layout)}
      style={[
        overlayStyles.mentionChip,
        {
          left: `${item.x}%`,
          top: `${item.y}%`,
          marginLeft: -selfSize.width / 2,
          marginTop: -selfSize.height / 2,
        },
      ]}
    >
      <Text style={{ color: "#111", fontSize: 13, fontWeight: "700" }}>@{item.username}</Text>
      <TouchableOpacity onPress={() => onRemove(item.id)} style={overlayStyles.mentionRemoveBtn}>
        <Text style={{ color: "#111", fontSize: 10 }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

function StoryPreview() {
  const navigation = useNavigation();
  const route = useRoute();
  // ← CHANGED — CreateStory.js can now hand off several assets at once
  // from a multi-select gallery pick (route.params.files); a single
  // camera capture still hands off just route.params.file. Normalize
  // both into one array so the rest of this component only deals with
  // "slides".
  const initialFilesRef = useRef(
    route.params?.files?.length ? route.params.files : route.params?.file ? [route.params.file] : []
  );
  const filter = route.params?.filter || "none";
  const [loading, setLoading] = useState(false);
  // ← NEW — while uploading more than one slide, shows "Posting 2 of 3…"
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total } | null

  // ── Each selected asset gets its own independent draft: its own text
  // overlays and mentions, edited one at a time via activeIndex, then
  // all posted as separate stories when the user shares.
  const [slides, setSlides] = useState(() =>
    initialFilesRef.current.map((f, i) => ({ key: `s-${i}-${Date.now()}`, file: f, textOverlays: [], mentions: [] }))
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const [showTextInput, setShowTextInput] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [showMentionSheet, setShowMentionSheet] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });


  if (slides.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconWrap}>
          <FeatherIcon name="x" size={26} color="rgba(255,255,255,0.4)" />
        </View>
        <Text style={styles.emptyTitle}>No file selected</Text>
        <Text style={styles.emptySubtitle}>Go back and capture or choose something to share.</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate("CreateStory")}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const current = slides[activeIndex];
  const file = current.file;
  const textOverlays = current.textOverlays;
  const mentions = current.mentions;
  const storyType = (file.type || "").startsWith("video") ? "video" : "image";

  // ── Every mutation below only ever touches the ACTIVE slide's draft,
  // by index, leaving every other slide's overlays/mentions untouched.
  const patchActiveSlide = (patch) => {
    setSlides((prev) => prev.map((s, i) => (i === activeIndex ? { ...s, ...patch(s) } : s)));
  };

  const addTextOverlay = () => {
    if (!draftText.trim()) {
      setShowTextInput(false);
      return;
    }
    patchActiveSlide((s) => ({
      textOverlays: [
        ...s.textOverlays,
        { id: `t-${Date.now()}`, text: draftText.trim(), x: 50, y: 40 + s.textOverlays.length * 8, color: "#ffffff", fontSize: 26, align: "center" },
      ],
    }));
    setDraftText("");
    setShowTextInput(false);
  };

  const updateTextOverlay = (id, patch) =>
    patchActiveSlide((s) => ({ textOverlays: s.textOverlays.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const removeTextOverlay = (id) =>
    patchActiveSlide((s) => ({ textOverlays: s.textOverlays.filter((t) => t.id !== id) }));

  const addMention = (user) => {
    if (current.mentions.some((m) => m.user === user._id)) {
      setShowMentionSheet(false);
      return;
    }
    patchActiveSlide((s) => ({
      mentions: [...s.mentions, { id: `m-${Date.now()}`, user: user._id, username: user.username, x: 50, y: 60 + s.mentions.length * 10 }],
    }));
    setShowMentionSheet(false);
  };
  const updateMention = (id, patch) =>
    patchActiveSlide((s) => ({ mentions: s.mentions.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const removeMention = (id) =>
    patchActiveSlide((s) => ({ mentions: s.mentions.filter((m) => m.id !== id) }));

  // ── Back button: with more than one asset selected, drop just the
  // current one (Instagram-style) instead of discarding the whole
  // multi-select and leaving the screen. Only navigates back once
  // there's nothing left to post.
  const removeActiveSlide = () => {
    if (slides.length <= 1) {
      navigation.goBack();
      return;
    }
    setSlides((prev) => prev.filter((_, i) => i !== activeIndex));
    setActiveIndex((i) => Math.max(0, Math.min(i, slides.length - 2)));
  };
  const handleUpload = async () => {
    if (!(await getAuthToken())) {
      Alert.alert("Session expired", "Please log in again.");
      return;
    }
    try {
      setLoading(true);
      let lastStory = null;

      // ← CHANGED — one request per slide, in order. The backend endpoint
      // only ever takes a single file per call, so multi-select posts
      // each selected image/video as its own story, one after another.
      for (let i = 0; i < slides.length; i++) {
        setUploadProgress(slides.length > 1 ? { done: i, total: slides.length } : null);
        const s = slides[i];
        const type = (s.file.type || "").startsWith("video") ? "video" : "image";

        const formData = new FormData();
        formData.append("story", { uri: s.file.uri, type: s.file.type, name: s.file.name || `story.${type === "video" ? "mp4" : "jpg"}` });
        formData.append("storyType", type);
        formData.append("filter", filter);
        formData.append(
          "textOverlays",
          JSON.stringify(s.textOverlays.map(({ text, x, y, color, fontSize, align }) => ({ text, x, y, color, fontSize, align })))
        );
        formData.append("mentions", JSON.stringify(s.mentions.map(({ user, x, y }) => ({ user, x, y }))));

        const response = await apiFetch(`${API}/stories/add-story`, {
          method: "POST",
          body: formData, // apiFetch detects FormData and skips forcing Content-Type
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || `Upload failed (${i + 1} of ${slides.length})`);
        lastStory = data.story;
      }

      setUploadProgress(slides.length > 1 ? { done: slides.length, total: slides.length } : null);
      navigation.navigate("MainTabs", { screen: "Home", params: { newStory: lastStory } });
    } catch (error) {
      console.log(error);
      Alert.alert("", error.message);
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.previewContainer} onLayout={(e) => setContainerSize(e.nativeEvent.layout)}>
        {storyType === "image" ? (
          <Image key={current.key} source={{ uri: file.uri }} style={styles.media} resizeMode="contain" />
        ) : (
          <Video key={current.key} source={{ uri: file.uri }} style={styles.media} resizeMode="contain" controls repeat />
        )}

        {/* overlays live on top of the media, positioned by % */}
        {textOverlays.map((t) => (
          <TextOverlayEl key={t.id} item={t} containerSize={containerSize} onChange={updateTextOverlay} onRemove={removeTextOverlay} />
        ))}
        {mentions.map((m) => (
          <MentionChipEl key={m.id} item={m} containerSize={containerSize} onChange={updateMention} onRemove={removeMention} />
        ))}
      </View>

      <LinearGradient colors={["rgba(0,0,0,0.65)", "transparent"]} style={styles.topGradient} pointerEvents="none" />
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={styles.bottomGradient} pointerEvents="none" />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.cancelBtn} onPress={removeActiveSlide}>
          <FeatherIcon name="x" size={18} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.titleText}>
          {slides.length > 1 ? `Story Preview · ${activeIndex + 1}/${slides.length}` : "Story Preview"}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setShowTextInput(true)}>
            <FeatherIcon name="type" size={17} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setShowMentionSheet(true)}>
            <FeatherIcon name="at-sign" size={17} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Inline text composer */}
      <Modal visible={showTextInput} transparent animationType="fade" onRequestClose={() => setShowTextInput(false)}>
        <TouchableOpacity style={styles.textComposerOverlay} activeOpacity={1} onPress={() => setShowTextInput(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.textComposerBox}>
            <TextInput
              autoFocus
              value={draftText}
              onChangeText={setDraftText}
              placeholder="Type something…"
              placeholderTextColor="rgba(255,255,255,0.5)"
              maxLength={200}
              multiline
              style={styles.textComposerInput}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: "rgba(255,255,255,0.15)" }]}
                onPress={() => {
                  setShowTextInput(false);
                  setDraftText("");
                }}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={addTextOverlay}>
                <Text style={styles.buttonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {showMentionSheet && <MentionSearchSheet onClose={() => setShowMentionSheet(false)} onSelect={addMention} />}

      {/* ── NEW: thumbnail strip — only shown once more than one asset was
          selected, so the single-asset flow looks exactly as before. Tap
          a thumbnail to edit that slide's overlays/mentions before
          sharing; the small × drops it from the batch. */}
      {slides.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {slides.map((s, i) => (
            <TouchableOpacity
              key={s.key}
              style={[styles.thumb, i === activeIndex ? styles.thumbActive : null]}
              onPress={() => setActiveIndex(i)}
            >
              <Image source={{ uri: s.file.uri }} style={styles.thumbMedia} />
              <TouchableOpacity
                style={styles.thumbRemove}
                onPress={() => {
                  setSlides((prev) => prev.filter((_, j) => j !== i));
                  setActiveIndex((prevIdx) => Math.max(0, Math.min(prevIdx, slides.length - 2)));
                }}
              >
                <Text style={{ color: "#fff", fontSize: 10 }}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.bottomBar}>
        <View style={styles.typeBadge}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
            {uploadProgress ? `Posting ${uploadProgress.done + 1} of ${uploadProgress.total}…` : storyType === "image" ? "Photo" : "Video"}
          </Text>
        </View>
        <TouchableOpacity style={[styles.shareButton, { opacity: loading ? 0.7 : 1 }]} onPress={handleUpload} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                {slides.length > 1 ? `Share ${slides.length} to Story` : "Share to Story"}
              </Text>
              <FeatherIcon name="send" size={15} color="#fff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default StoryPreview;

/* ================= STYLES ================= */
const overlayStyles = StyleSheet.create({
  removeBtn: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  mentionChip: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  mentionRemoveBtn: {
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", position: "relative" },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 140, zIndex: 2 },
  bottomGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 160, zIndex: 2 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 6,
    height: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  cancelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: { color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  typeBadge: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: GOLDEN,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  previewContainer: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" },
  media: { width: "100%", height: "100%" },
  // ── NEW: multi-select thumbnail strip
  thumbStrip: { position: "absolute", bottom: 92, left: 0, right: 0, zIndex: 5, flexGrow: 0 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },
  thumbActive: { borderColor: GOLDEN },
  thumbMedia: { width: "100%", height: "100%" },
  thumbRemove: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#000",
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  emptySubtitle: { color: "rgba(255,255,255,0.5)", fontSize: 13.5, textAlign: "center", marginBottom: 6 },
  button: {
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: GOLDEN,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  textComposerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  textComposerBox: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "rgba(20,20,20,0.95)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  textComposerInput: {
    width: "100%",
    minHeight: 90,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    fontSize: 15,
    textAlignVertical: "top",
  },
});

const mentionStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    backgroundColor: "#fff",
    width: "100%",
    maxWidth: 480,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: "65%",
  },
  handle: { width: 36, height: 4, backgroundColor: "#ddd", borderRadius: 4, alignSelf: "center", marginBottom: 12 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f2f2f2",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111" },
  closeBtn: {},
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#f5f5f5" },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },
  username: { fontSize: 14, fontWeight: "600", color: "#111" },
  bio: { fontSize: 12, color: "#999", marginTop: 2 },
  empty: { textAlign: "center", color: "#aaa", paddingVertical: 20, fontSize: 14 },
});