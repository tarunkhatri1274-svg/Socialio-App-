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
import { useNavigation, useRoute } from "@react-navigation/native";
import FeatherIcon from "react-native-vector-icons/Feather";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path — count folders to src/api/authToken.js
import Config from "react-native-config";
// TODO: cropimage.js used <canvas> to bake the crop rectangle + CSS
// filter into a single flattened image, returning a web Blob — there's no
// canvas/Blob in RN. You'll need a native equivalent (e.g.
// react-native-image-manipulator or @bam.tech/react-native-image-resizer
// for the crop/rotate, plus a GL-based filter pass such as
// react-native-image-filter-kit if you want the same filter presets).
// Keeping the same call contract here — pass in the source uri + this
// item's crop rect + filter name, get back { uri, type, name } ready to
// drop straight into FormData below.
import getEditedImage from "./CropImage";

const API = Config.API_URL;
// Client-side size guard — this upload path enforces MAX_IMAGE_BYTES using
// the original picked file's reported size, same as the web version's
// pre-Cloudinary check.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB



// ── Small reusable toggle switch used for the new visibility settings ──────
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
      <Switch
        value={checked}
        onValueChange={onChange}
        trackColor={{ false: "#ddd", true: "rgb(234,182,118)" }}
      />
    </View>
  );
}

// ── Avatar that shows a real profile picture when available, and falls ────
// back to the colored-initial circle otherwise. Adjust the field names
// below (profilePic / avatar / image) to match whatever your User schema
// / /auth/search response actually calls this field.
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

function CreateImagePost() {
  const navigation = useNavigation();
  const route = useRoute();
  const state = route.params || {};
  const [captionText, setCaptionText] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // ── tags ──────────────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);

  // ── collaborators ─────────────────────────────────────────────────────
  const [collabSearch, setCollabSearch] = useState("");
  const [collabResults, setCollabResults] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [searchingCollab, setSearchingCollab] = useState(false);
  const searchTimer = useRef(null);

  // ── visibility / interaction settings ──────────────────────────────────
  // hideLikeCount / hideCommentCount: numbers stay hidden from everyone
  // except the post owner (the owner always sees real counts — same as
  // Instagram's "hide like count" behavior).
  // disableDownload: hides the download button for everyone except owner.
  const [hideLikeCount, setHideLikeCount] = useState(false);
  const [hideCommentCount, setHideCommentCount] = useState(false);
  const [disableDownload, setDisableDownload] = useState(false);
  // Fully turns commenting OFF for everyone but you — different from
  // hideCommentCount, which just hides the number while still letting
  // people comment.
  const [disableComments, setDisableComments] = useState(false);

  const images = state?.images || (state?.image ? [state.image] : []);
  const files = state?.files || (state?.file ? [state.file] : []);
  const crops = state?.crops || (state?.crop ? [state.crop] : []);
  const filters = state?.filters || (state?.filter ? [state.filter] : []);
  // ← NEW: EditPost.js now screenshots the crop frame exactly as shown
  // (pan/zoom/aspect crop + filter preview all baked in together) and
  // sends those uris here. When present for an image, this is what we
  // upload directly — no need to re-derive a crop rect or re-apply a
  // filter, since the capture already IS the final edited image.
  const capturedUris = state?.capturedUris || [];

 

  if (!images.length) {
    navigation.navigate("MainTabs", { screen: "Profile" });
    return null;
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

  // ── upload ─────────────────────────────────────────────────────────────
  // Uploads through our own backend's dedicated /auth/upload-media route
  // (which uploads to Cloudinary server-side), same pattern as the
  // working web version of this screen (addimagepost.jsx). This keeps
  // Cloudinary credentials off the client and gets you real server-side
  // size/type enforcement via uploadPostMedia (media.controllers.js),
  // instead of only the client-side MAX_IMAGE_BYTES check below.
  const uploadToBackend = async (editedFile, index) => {
    const formData = new FormData();
    // RN's fetch/FormData wants { uri, type, name } for file parts, not a
    // raw Blob like the browser version — getEditedImage returns that
    // shape directly, and so does the capturedUris path below.
    //
    // Some Android devices/OS versions have
    // @react-native-community/image-editor's cropImage() (and, per the
    // same class of bug, react-native-view-shot's capture()) return a
    // bare filesystem path with no "file://" scheme. RN's fetch/
    // FormData can't read the file into the multipart body without a
    // scheme — it fails silently with a generic "Network request
    // failed" before any actual network call happens. Normalize it here
    // as a guard.
    let uri = editedFile.uri;
    if (uri && !/^(file|content|http|https):\/\//.test(uri)) {
      uri = `file://${uri}`;
    }

    formData.append("file", {
      uri,
      type: editedFile.type || "image/jpeg",
      name: editedFile.name || `image_${index}.jpg`,
    });

    const res = await apiFetch(`${API}/auth/upload-media`, {
      method: "POST",
      body: formData, // apiFetch detects FormData and skips forcing Content-Type
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    if (!data.url && !data.secure_url) throw new Error(data.message || "Upload failed");
    return data.url || data.secure_url;
  };

  const handlePost = async () => {
    try {
      const oversized = files.filter((f) => f && f.size > MAX_IMAGE_BYTES);
      if (oversized.length > 0) {
        Alert.alert(
          "",
          `${oversized.length === 1 ? "One image" : `${oversized.length} images`} exceed the 10MB limit. Please choose smaller files.`
        );
        return;
      }

      setLoading(true);
      const uploadedUrls = [];
      for (let i = 0; i < images.length; i++) {
        // If EditPost.js captured this frame directly (the normal case
        // now), it already IS the cropped + filtered image — upload it
        // as-is. Only fall back to getEditedImage() (crop the raw
        // source using a guessed rect) for an image with no capture,
        // e.g. if the frame capture failed for some reason.
        const edited = capturedUris[i]
          ? { uri: capturedUris[i], type: "image/jpeg", name: `edited-${i}.jpg` }
          : await getEditedImage(images[i], crops[i], filters[i]);
        const url = await uploadToBackend(edited, i);
        uploadedUrls.push(url);
      }

      const mediaPayload = uploadedUrls.map((url) => ({ url, type: "image" }));
      const res = await apiFetch(`${API}/auth/add-media-post`, {
        method: "POST",
        body: JSON.stringify({
          media: mediaPayload,
          caption: captionText,
          postType: uploadedUrls.length > 1 ? "carousel" : "image",
          tags,
          collaborators: collaborators.map((c) => c._id),
          // Visibility settings, read by the backend's AddMediaPost (see
          // media.controllers.js) and stored on the Post document.
          hideLikeCount,
          hideCommentCount,
          disableDownload,
          disableComments,
        }),
      });
      const data = await res.json();
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
        {/* IMAGE PREVIEW CAROUSEL */}
        <View style={{ position: "relative" }}>
          <Image source={{ uri: capturedUris[previewIndex] || images[previewIndex] }} style={styles.preview} />
          {images.length > 1 && (
            <>
              <View style={styles.dotsWrap}>
                {images.map((_, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setPreviewIndex(i)}
                    style={[
                      styles.dot,
                      { width: i === previewIndex ? 18 : 6, backgroundColor: i === previewIndex ? "#333" : "rgba(0,0,0,0.25)" },
                    ]}
                  />
                ))}
              </View>
              {previewIndex > 0 && (
                <TouchableOpacity style={[styles.arrow, { left: 8 }]} onPress={() => setPreviewIndex((i) => i - 1)}>
                  <Text style={{ fontSize: 22 }}>‹</Text>
                </TouchableOpacity>
              )}
              {previewIndex < images.length - 1 && (
                <TouchableOpacity style={[styles.arrow, { right: 8 }]} onPress={() => setPreviewIndex((i) => i + 1)}>
                  <Text style={{ fontSize: 22 }}>›</Text>
                </TouchableOpacity>
              )}
              <View style={styles.counter}>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
                  {previewIndex + 1} / {images.length}
                </Text>
              </View>
            </>
          )}
        </View>

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
            hint="Other people won't be able to download this post's media."
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
          <Text style={{ fontWeight: "700", fontSize: 15 }}>
            {loading ? `Uploading ${previewIndex + 1}/${images.length}...` : "Share"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default CreateImagePost;

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#f4f4f4" },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#fff", borderRadius: 16, padding: 15 },
  preview: { width: "100%", height: 350, borderRadius: 12 },
  textarea: {
    width: "100%",
    minHeight: 80,
    marginTop: 12,
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
  dotsWrap: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center" },
  dot: { height: 6, borderRadius: 3 },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -16,
    backgroundColor: "rgba(255,255,255,0.7)",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  toggleLabel: { fontSize: 13, fontWeight: "600", color: "#333" },
  toggleHint: { fontSize: 11, color: "#999", marginTop: 2 },
});