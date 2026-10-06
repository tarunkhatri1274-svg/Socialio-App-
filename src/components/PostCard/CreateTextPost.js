import React, { useState, useRef, useEffect } from "react";
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
import { useNavigation } from "@react-navigation/native";
import Icon from "react-native-vector-icons/FontAwesome5";
import FeatherIcon from "react-native-vector-icons/Feather";
import { launchImageLibrary } from "react-native-image-picker";
import { apiFetch, getCachedUser } from "../../api/authToken";
import Config from "react-native-config";
import ShareSheet from "./ShareSheet";

const API = Config.API_URL;
// Client-side size guard — text posts only ever carry images (no video),
// so only the 10MB image limit applies here. This is a pre-check for
// UX only; the real enforcement happens server-side in uploadPostMedia
// (media.controllers.js), since uploads now go through our own backend.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB



// ── Small reusable toggle switch — same component/shape as
// CreateImagePost.jsx / CreateVideoPost.jsx's ToggleRow.
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
// back to the colored-initial circle otherwise. Matches the profilePic
// field used for the current user below (currentUser?.profilePic) — if
// your /auth/search response uses a different field name, adjust the
// list in the `uri` line below.
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

function CreateTextPost({ onPost }) {
  const navigation = useNavigation();
  const [currentUser, setCurrentUser] = useState({});
  useEffect(() => {
    getCachedUser().then(setCurrentUser);
  }, []);
  const displayUsername = currentUser?.username || "user";
  const profilePic = currentUser?.profilePic;
  const [text, setText] = useState("");
  const [images, setImages] = useState([]); // [{ uri, type, fileName, size }]
  const [description, setDescription] = useState("");

  // ── tags ──────────────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);

  // ── collaborators ────────────────────────────────────────────────────
  const [collabSearch, setCollabSearch] = useState("");
  const [collabResults, setCollabResults] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [searchingCollab, setSearchingCollab] = useState(false);
  const searchTimer = useRef(null);

  // ── Advanced settings — hide like/comment counts, disable download,
  // disable comments entirely. Stored on the Post document by
  // AddTextPost (media.controllers.js already accepts these fields).
  const [hideLikeCount, setHideLikeCount] = useState(false);
  const [hideCommentCount, setHideCommentCount] = useState(false);
  const [disableDownload, setDisableDownload] = useState(false);
  const [disableComments, setDisableComments] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);


  const handleImageUpload = async () => {
    const result = await launchImageLibrary({ mediaType: "photo", selectionLimit: 0, quality: 0.9 });
    if (result.didCancel || !result.assets?.length) return;
    const mapped = result.assets.map((a) => ({
      uri: a.uri,
      type: a.type || "image/jpeg",
      fileName: a.fileName || `image-${Date.now()}.jpg`,
      size: a.fileSize || 0,
    }));
    setImages((prev) => [...prev, ...mapped]);
  };

  function removeImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

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
        console.log("COLLAB SEARCH RESULT SAMPLE:", JSON.stringify(results[0]));
        const me = await getCachedUser();
        setCollabResults(results.filter((u) => u._id !== me._id && !collaborators.some((c) => c._id === u._id)));
      } catch {}
      setSearchingCollab(false);
    }, 400);
  };

  const addCollab = (user) => {
    setCollaborators((prev) => [...prev, user]);
    setCollabResults([]);
    setCollabSearch("");
  };
  const removeCollab = (id) => setCollaborators((prev) => prev.filter((u) => u._id !== id));

  const uploadtextpost = async () => {
    try {
      const oversized = images.filter((img) => img.size && img.size > MAX_IMAGE_BYTES);
      if (oversized.length > 0) {
        Alert.alert(
          "",
          `${oversized.length === 1 ? "One image" : `${oversized.length} images`} exceed the 10MB limit. Please choose smaller files.`
        );
        return;
      }

      setLoading(true);

      const uploadedImages = await Promise.all(
        images.map(async (img) => {
          const formData = new FormData();
          // RN's fetch/FormData wants { uri, type, name } for file parts,
          // not a raw File/Blob like the browser version.
          formData.append("file", { uri: img.uri, type: img.type, name: img.fileName });

          const response = await apiFetch(`${API}/auth/upload-media`, {
            method: "POST",
            body: formData, // apiFetch detects FormData and skips forcing Content-Type
          });
          if (!response.ok) throw new Error("Upload failed");
          const data = await response.json();
          return { url: data.url || data.secure_url, type: "image" };
        })
      );

      console.log("All uploaded images:", uploadedImages);

      const response = await apiFetch(`${API}/auth/add-text-post`, {
        method: "POST",
        body: JSON.stringify({
          postType: "text",
          text,
          media: uploadedImages,
          tags,
          collaborators: collaborators.map((c) => c._id),
          // Visibility settings, read by AddTextPost (media.controllers.js)
          // and stored on the Post document.
          hideLikeCount,
          hideCommentCount,
          disableDownload,
          disableComments,
        }),
      });

      const data = await response.json();
      console.log("Post response:", data);

      if (data.success) navigation.navigate("MainTabs", { screen: "Profile" });
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.page}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <FeatherIcon name="arrow-left" size={22} color="#111" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>New Post</Text>
        <TouchableOpacity
          style={[styles.postBtn, { opacity: text.trim() || images.length > 0 ? 1 : 0.4 }]}
          onPress={uploadtextpost}
          disabled={!text.trim() && images.length === 0}
        >
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>Post</Text>
        </TouchableOpacity>
      </View>

      {/* User Row */}
      <View style={styles.userRow}>
        <View style={styles.avatar}>
          {profilePic ? (
            <Image source={{ uri: profilePic }} style={styles.avatarImg} />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 18 }}>
              {displayUsername[0]?.toUpperCase()}
            </Text>
          )}
        </View>
        <View>
          <Text style={styles.username}>{displayUsername}</Text>
          <Text style={styles.audience}>Everyone</Text>
        </View>
      </View>

      {/* Text Input */}
      <TextInput
        style={styles.textarea}
        placeholder="What's on your mind?"
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
        autoFocus
      />

      {/* Image Previews */}
      {images.length > 0 && (
        <View style={styles.imageRow}>
          {images.map((img, i) => (
            <View key={i} style={styles.imageWrapper}>
              <Image source={{ uri: img.uri }} style={styles.previewImg} />
              <TouchableOpacity style={styles.removeImg} onPress={() => removeImage(i)}>
                <Icon name="times" size={10} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.divider} />

      {/* Options */}
      <View style={styles.optionsList}>
        {/* Add Image */}
        <TouchableOpacity style={styles.optionRow} onPress={handleImageUpload}>
          <View style={styles.optionLeft}>
            <View style={[styles.optionIcon, { backgroundColor: "#e8f4fd" }]}>
              <Icon name="image" solid color="#1877f2" size={16} />
            </View>
            <Text style={styles.optionLabel}>Add Image</Text>
          </View>
          <Icon name="chevron-right" size={12} color="#bbb" />
        </TouchableOpacity>

        {/* Tags */}
        <TouchableOpacity style={styles.optionRow} onPress={() => setShowAdvanced((v) => !v)}>
          <View style={styles.optionLeft}>
            <View style={[styles.optionIcon, { backgroundColor: "#fef3e8" }]}>
              <Icon name="tag" color="#f5a623" size={16} />
            </View>
            <Text style={styles.optionLabel}>Tags</Text>
          </View>
          <View style={styles.optionRight}>
            {tags.length > 0 && (
              <Text style={styles.optionValue} numberOfLines={1}>
                {tags.map((t) => `#${t}`).join(", ")}
              </Text>
            )}
            <Icon name="chevron-right" size={12} color="#bbb" />
          </View>
        </TouchableOpacity>

        {/* Collabs */}
        <TouchableOpacity style={styles.optionRow} onPress={() => setShowAdvanced((v) => !v)}>
          <View style={styles.optionLeft}>
            <View style={[styles.optionIcon, { backgroundColor: "#edf7ed" }]}>
              <Icon name="user-friends" color="#2ecc71" size={16} />
            </View>
            <Text style={styles.optionLabel}>Collab</Text>
          </View>
          <View style={styles.optionRight}>
            {collaborators.length > 0 && (
              <Text style={styles.optionValue} numberOfLines={1}>
                {collaborators.map((c) => c.username).join(", ")}
              </Text>
            )}
            <Icon name="chevron-right" size={12} color="#bbb" />
          </View>
        </TouchableOpacity>

        {/* Advanced settings row */}
        <TouchableOpacity style={styles.optionRow} onPress={() => setShowAdvanced((v) => !v)}>
          <View style={styles.optionLeft}>
            <View style={[styles.optionIcon, { backgroundColor: "#f3eefc" }]}>
              <FeatherIcon name="eye-off" color="#8e44ad" size={16} />
            </View>
            <Text style={styles.optionLabel}>Advanced settings</Text>
          </View>
          <Icon name="chevron-right" size={12} color="#bbb" />
        </TouchableOpacity>
      </View>

      {/* Advanced Panel */}
      {showAdvanced && (
        <View style={styles.advancedPanel}>
          <Text style={styles.fieldLabel}>Tags</Text>
          <View style={styles.tagInputRow}>
            <TextInput
              style={[styles.fieldInput, { flex: 1 }]}
              placeholder="Add a tag..."
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={addTag}
            />
            <TouchableOpacity onPress={addTag} style={styles.addBtn}>
              <Text style={{ fontSize: 13, fontWeight: "700" }}>Add</Text>
            </TouchableOpacity>
          </View>
          {tags.length > 0 && (
            <View style={styles.tagWrap}>
              {tags.map((t) => (
                <View key={t} style={styles.tagChip}>
                  <Text style={{ color: "#f5a623", fontSize: 12, fontWeight: "600" }}>#{t}</Text>
                  <TouchableOpacity onPress={() => removeTag(t)} style={{ marginLeft: 4 }}>
                    <FeatherIcon name="x" size={12} color="#f5a623" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Description</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Add a description..."
            value={description}
            onChangeText={setDescription}
          />

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Invite Collaborators</Text>
          <View style={styles.searchWrap}>
            <FeatherIcon name="search" size={13} color="#aaa" />
            <TextInput
              style={styles.smallInputNoBorder}
              placeholder="Search people..."
              value={collabSearch}
              onChangeText={handleCollabSearch}
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

          {/* ── Advanced settings toggles ── */}
          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Post visibility</Text>
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
            hint="Other people won't be able to download this post's images."
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
      )}

      {/* Preview Section */}
      {(text || images.length > 0) && (
        <>
          <View style={styles.divider} />
          <Text style={styles.previewLabel}>PREVIEW</Text>
          <View style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <View style={styles.previewAvatar}>
                {profilePic ? (
                  <Image source={{ uri: profilePic }} style={styles.avatarImg} />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                    {displayUsername[0]?.toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={styles.previewUsername}>{displayUsername}</Text>
            </View>
            {!!text && <Text style={styles.previewText}>{text}</Text>}
            {images.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewImgStrip}>
                {images.map((img, i) => (
                  <View
                    key={i}
                    style={[
                      styles.previewImgWrapper,
                      { width: images.length === 1 ? 280 : 240 },
                    ]}
                  >
                    <Image source={{ uri: img.uri }} style={styles.previewGridImg} />
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.previewActions}>
              <TouchableOpacity style={styles.previewBtn}>
                <Icon name="thumbs-up" color="#aaa" size={16} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.previewBtn}>
                <Icon name="comment" color="#aaa" size={16} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.previewBtn}>
                <Icon name="share" color="#aaa" size={16} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.previewBtn, { marginLeft: "auto" }]}>
                <Icon name="bookmark" color="#aaa" size={16} />
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

export default CreateTextPost;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  iconBtn: { padding: 4 },
  topTitle: { fontWeight: "700", fontSize: 16 },
  postBtn: { backgroundColor: "rgb(234,182,118)", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 7 },

  userRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15, paddingTop: 14, paddingBottom: 6 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  username: { fontWeight: "600", fontSize: 14 },
  audience: { fontSize: 11, color: "#888", marginTop: 2 },

  textarea: { width: "100%", minHeight: 80, maxHeight: 250, paddingHorizontal: 15, paddingVertical: 10, fontSize: 15 },

  imageRow: { flexDirection: "row", gap: 8, paddingHorizontal: 15, paddingBottom: 10, flexWrap: "wrap" },
  imageWrapper: { position: "relative", width: 80, height: 80 },
  previewImg: { width: "100%", height: "100%", borderRadius: 8 },
  removeImg: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  divider: { height: 1, backgroundColor: "#f0f0f0", marginVertical: 6 },

  optionsList: { paddingVertical: 4 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  optionLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  optionIcon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  optionLabel: { fontSize: 15, fontWeight: "500" },
  optionRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionValue: { fontSize: 12, color: "#888", maxWidth: 120 },

  advancedPanel: { paddingHorizontal: 15, paddingVertical: 10, backgroundColor: "#fafafa", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#eee" },
  fieldLabel: { fontSize: 12, color: "#888", marginBottom: 4, marginTop: 10 },
  fieldInput: { width: "100%", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: "#ddd", fontSize: 14 },
  tagInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addBtn: { backgroundColor: "rgb(234,182,118)", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff3e0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4 },
  smallInputNoBorder: { flex: 1, fontSize: 13, paddingHorizontal: 6, paddingVertical: 4 },
  searchResults: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#eee", marginTop: 6, overflow: "hidden" },
  searchResultItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: "#f5f5f5" },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },
  miniAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  collabWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  collabChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#e8f5e9", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },

  previewLabel: { fontSize: 12, color: "#aaa", paddingHorizontal: 15, paddingTop: 8, paddingBottom: 4, fontWeight: "600", letterSpacing: 0.5 },
  previewCard: { marginHorizontal: 15, borderWidth: 1, borderColor: "#eee", borderRadius: 12, overflow: "hidden" },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  previewAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  previewUsername: { fontWeight: "600", fontSize: 13 },
  previewText: { paddingHorizontal: 12, paddingBottom: 10, fontSize: 14, lineHeight: 21, color: "#222" },
  previewImgStrip: { paddingHorizontal: 12, paddingBottom: 10 },
  previewImgWrapper: { marginRight: 8, borderRadius: 14, overflow: "hidden", backgroundColor: "#f0f0f0" },
  previewGridImg: { width: "100%", height: 240 },
  previewActions: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  previewBtn: { padding: 4 },

  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#eee" },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: "#333" },
  toggleHint: { fontSize: 11, color: "#999", marginTop: 2 },
});