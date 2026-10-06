import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Switch,
  Alert,
  StyleSheet,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import FeatherIcon from "react-native-vector-icons/Feather";
import Video from "react-native-video";
import { apiFetch, getCachedUser } from "../../api/authToken"; 
import Config from "react-native-config";
const API = Config.API_URL;

// Client-side size guard — this flow uploads through our own backend's
// /auth/upload-media route (which uploads to Cloudinary server-side), so
// this check is purely for UX — real enforcement happens server-side in
// uploadPostMedia (media.controllers.js).
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20MB



function ToggleRow({ icon, label, hint, checked, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", flex: 1 }}>
        {icon}
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleLabel}>{label}</Text>
          {!!hint && <Text style={styles.toggleHint}>{hint}</Text>}
        </View>
      </View>
      <Switch value={checked} onValueChange={onChange} trackColor={{ false: "#ddd", true: "rgb(234,182,118)" }} />
    </View>
  );
}

// ── Avatar that shows a real profile picture when available, and falls
// back to the colored-initial circle otherwise. If your /auth/search
// response uses a different field name than these, add/adjust it below —
// e.g. `user?.profilePicture` or `user?.dp`.
function MiniAvatar({ user }) {
  const uri = user?.profilePic || user?.avatar || user?.image || user?.photoUrl;
  if (uri) {
    return <Image source={{ uri }} style={styles.miniAvatarImg} />;
  }
  return (
    <View style={styles.miniAvatar}>
      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
        {user?.username?.[0]?.toUpperCase()}
      </Text>
    </View>
  );
}

function CreateVideoPost() {
  const route = useRoute();
  const navigation = useNavigation();
  const state = route.params || {};

  const [captionText, setCaptionText] = useState("");
  const [loading, setLoading] = useState(false);

  // ── tags ──────────────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);

  // ── collaborators ─────────────────────────────────────────────────────
  const [collabSearch, setCollabSearch] = useState("");
  const [collabResults, setCollabResults] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [searchingCollab, setSearchingCollab] = useState(false);
  const searchTimer = useRef(null);

  // ── visibility / interaction settings — same four flags as
  // CreateImagePost, stored on the Post document by AddMediaPost (this
  // flow already posts through that same endpoint via `url`+postType, see
  // handlePost below, so no backend changes were needed for video).
  const [hideLikeCount, setHideLikeCount] = useState(false);
  const [hideCommentCount, setHideCommentCount] = useState(false);
  const [disableDownload, setDisableDownload] = useState(false);
  const [disableComments, setDisableComments] = useState(false);

  // if no video selected
  if (!state?.file) {
    return (
      <View style={styles.errorContainer}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>No video selected</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate("MainTabs", { screen: "Profile" })}>
          <Text style={{ color: "#fff" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // state.file is expected to be the asset object handed off by the picker
  // screen: { uri, type, fileName, fileSize } — same shape used by
  // launchImageLibrary elsewhere in this app (see CreateTextPost.js).
  const video = state.file;

  // ── tag handlers ───────────────────────────────────────────────────────
  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "_");
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
  };
  const removeTag = (t) => setTags((prev) => prev.filter((x) => x !== t));

  // ── collab search ──────────────────────────────────────────────────────
  const handleCollabSearch = (val) => {
    setCollabSearch(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) {
      setCollabResults([]);
      return;
    }
    setSearchingCollab(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/auth/search?q=${val}`);
        const data = await res.json();
        const results = Array.isArray(data) ? data : data.users || [];
        const me = await getCachedUser();
        setCollabResults(results.filter((u) => u._id !== me._id && !collaborators.some((c) => c._id === u._id)));
      } catch (err) {
        console.log("COLLAB SEARCH ERROR:", err);
      }
      setSearchingCollab(false);
    }, 400);
  };

  const addCollab = (user) => {
    setCollaborators((prev) => [...prev, user]);
    setCollabResults([]);
    setCollabSearch("");
  };
  const removeCollab = (id) => setCollaborators((prev) => prev.filter((u) => u._id !== id));

  // upload video through our own backend (which uploads to Cloudinary
  // server-side), same pattern as the working CreateImagePost flow.
  const uploadToBackend = async () => {
    const formData = new FormData();
    // RN's fetch/FormData wants { uri, type, name } for file parts, not a
    // raw File/Blob like the browser version.
    formData.append("file", {
      uri: video.uri,
      type: video.type || "video/mp4",
      name: video.fileName || `video-${Date.now()}.mp4`,
    });

    const response = await apiFetch(`${API}/auth/upload-media`, {
      method: "POST",
      body: formData, // apiFetch detects FormData and skips forcing Content-Type — boundary still set correctly
    });
    if (!response.ok) throw new Error("Upload failed");
    const data = await response.json();
    return data.url || data.secure_url;
  };

  // create post
  const handlePost = async () => {
    try {
      const size = video.fileSize || video.size || 0;
      if (size > MAX_VIDEO_BYTES) {
        Alert.alert("", "Video must be under 20MB. Please choose a smaller file.");
        return;
      }

      setLoading(true);

      const videoUrl = await uploadToBackend();
      console.log("VIDEO URL:", videoUrl);

      const response = await apiFetch(`${API}/auth/add-media-post`, {
        method: "POST",
        body: JSON.stringify({
          url: videoUrl,
          postType: "video",
          caption: captionText,
          tags,
          collaborators: collaborators.map((c) => c._id),
          // Visibility settings, read by AddMediaPost (media.controllers.js)
          // and stored on the Post document.
          hideLikeCount,
          hideCommentCount,
          disableDownload,
          disableComments,
        }),
      });

      const data = await response.json();
      console.log("POST RESPONSE:", data);

      if (data.success) navigation.reset({ index: 0, routes: [{ name: "MainTabs", params: { screen: "Profile" } }] });
    } catch (error) {
      console.log("POST ERROR:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.wrapper} contentContainerStyle={{ alignItems: "center", padding: 15 }}>
      <View style={styles.card}>
        {/* VIDEO PREVIEW */}
        <Video source={{ uri: video.uri }} style={styles.preview} controls resizeMode="cover" />

        {/* CAPTION */}
        <TextInput
          placeholder="Write a caption..."
          placeholderTextColor="#999"
          value={captionText}
          onChangeText={setCaptionText}
          style={styles.textarea}
          multiline
          textAlignVertical="top"
        />

        {/* ── TAGS ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <FeatherIcon name="tag" size={15} color="#f5a623" />
            <Text style={styles.sectionTitle}>Tags</Text>
          </View>
          <View style={styles.tagInputRow}>
            <TextInput
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={addTag}
              placeholder="Add a tag..."
              style={styles.smallInput}
            />
            <TouchableOpacity onPress={addTag} style={styles.addBtn}>
              <Text style={{ fontSize: 13, fontWeight: "700" }}>Add</Text>
            </TouchableOpacity>
          </View>
          {tags.length > 0 && (
            <View style={styles.tagWrap}>
              {tags.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={{ color: "#f5a623", fontSize: 12, fontWeight: "600" }}>#{t}</Text>
                  <TouchableOpacity onPress={() => removeTag(t)} style={{ marginLeft: 4 }}>
                    <FeatherIcon name="x" size={12} color="#f5a623" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── COLLABORATORS ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <FeatherIcon name="users" size={15} color="#f5a623" />
            <Text style={styles.sectionTitle}>Collaborators</Text>
          </View>
          <View style={styles.searchWrap}>
            <FeatherIcon name="search" size={13} color="#aaa" />
            <TextInput
              value={collabSearch}
              onChangeText={handleCollabSearch}
              placeholder="Search people..."
              style={styles.smallInputNoBorder}
            />
          </View>

          {collabResults.length > 0 && (
            <View style={styles.searchResults}>
              {collabResults.map((u) => (
                <TouchableOpacity key={u._id} style={styles.searchResultItem} onPress={() => addCollab(u)}>
                  <MiniAvatar user={u} />
                  <Text style={{ fontSize: 13, fontWeight: "600" }}>{u.username}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {searchingCollab && <Text style={{ fontSize: 12, color: "#aaa", marginVertical: 6 }}>Searching...</Text>}

          {/* selected collaborators — these are INVITES, not immediate
              additions. The post shows on your own profile right away
              regardless; it only shows on THEIR profile once they accept
              the invite via the Activity page. */}
          {collaborators.length > 0 && (
            <View style={styles.collabWrap}>
              {collaborators.map((u) => (
                <View key={u._id} style={styles.collabChip}>
                  <MiniAvatar user={u} />
                  <Text style={{ fontSize: 12, fontWeight: "600" }}>{u.username}</Text>
                  <TouchableOpacity onPress={() => removeCollab(u._id)} style={{ marginLeft: 4 }}>
                    <FeatherIcon name="x" size={12} color="#333" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          {collaborators.length > 0 && (
            <Text style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>
              They'll need to accept before this shows on their profile.
            </Text>
          )}
        </View>

        {/* ── ADVANCED SETTINGS: visibility toggles ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <FeatherIcon name="eye-off" size={15} color="#f5a623" />
            <Text style={styles.sectionTitle}>Advanced settings</Text>
          </View>

          <ToggleRow
            icon={<FeatherIcon name="eye-off" size={15} color="#888" style={{ marginTop: 2 }} />}
            label="Hide like count"
            hint="Only you will see the total number of likes."
            checked={hideLikeCount}
            onChange={setHideLikeCount}
          />
          <ToggleRow
            icon={<FeatherIcon name="eye-off" size={15} color="#888" style={{ marginTop: 2 }} />}
            label="Hide comment count"
            hint="Only you will see the total number of comments."
            checked={hideCommentCount}
            onChange={setHideCommentCount}
          />
          <ToggleRow
            icon={<FeatherIcon name="download-cloud" size={15} color="#888" style={{ marginTop: 2 }} />}
            label="Disable download"
            hint="Other people won't be able to download this video."
            checked={disableDownload}
            onChange={setDisableDownload}
          />
          <ToggleRow
            icon={<FeatherIcon name="eye-off" size={15} color="#888" style={{ marginTop: 2 }} />}
            label="Disable comments"
            hint="Turns commenting off completely — not just the count. Only you can comment."
            checked={disableComments}
            onChange={setDisableComments}
          />
        </View>

        {/* SHARE BUTTON */}
        <TouchableOpacity onPress={handlePost} style={[styles.postBtn, loading && { opacity: 0.7 }]} disabled={loading}>
          <Text style={{ fontWeight: "700", fontSize: 15 }}>{loading ? "Uploading..." : "Share"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default CreateVideoPost;

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#f4f4f4" },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#fff", borderRadius: 16, padding: 15 },
  preview: { width: "100%", height: 350, borderRadius: 12, backgroundColor: "#000" },
  textarea: {
    width: "100%",
    minHeight: 100,
    marginTop: 15,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    fontSize: 14,
  },
  section: { marginTop: 14, padding: 12, backgroundColor: "#fafafa", borderRadius: 12, borderWidth: 1, borderColor: "#f0f0f0" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#333" },
  tagInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  smallInput: { flex: 1, borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  smallInputNoBorder: { flex: 1, fontSize: 13, paddingHorizontal: 6, paddingVertical: 4 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addBtn: { backgroundColor: "rgb(234,182,118)", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff3e0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  collabWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  collabChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#e8f5e9", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  searchResults: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#eee", marginTop: 6, overflow: "hidden" },
  searchResultItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: "#f5f5f5" },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },
  miniAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  postBtn: { marginTop: 15, width: "100%", padding: 12, backgroundColor: "rgb(234,182,118)", borderRadius: 10, alignItems: "center" },
  errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 15 },
  backBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: "#000" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: "#333" },
  toggleHint: { fontSize: 11, color: "#999", marginTop: 2 },
});