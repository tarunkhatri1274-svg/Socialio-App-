import React, { useState, useRef, useEffect, useCallback } from "react";
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
import { apiFetch, getCachedUser, getAuthToken } from "../../api/authToken"; // adjust relative path — count folders to src/api/authToken.js
import Config from "react-native-config";
import ReactNativeBlobUtil from "react-native-blob-util";
// TODO: cropimage.js used <canvas> to bake the crop rectangle + CSS
// filter into a single flattened image, returning a web Blob — there's no
// canvas/Blob in RN. You'll need a native equivalent (e.g.
// react-native-image-manipulator or @bam.tech/react-native-image-resizer
// for the crop/rotate, plus a GL-based filter pass such as
// react-native-image-filter-kit if you want the same filter presets).
// Keeping the same call contract here — pass in the source uri + this
// item's crop rect + filter name, get back { uri, type, name } ready to
// drop straight into FormData below.
import getEditedImage, { inspectImageFile, isUsableImage, parseCssFilterToMatrix } from "./CropImage";
import { renderEditedImage, SKIA_AVAILABLE } from "./EditRender";
import { useImageAspect, clampRatio } from "./PostImage";

const API = Config.API_URL;
// Client-side size guard — this upload path enforces MAX_IMAGE_BYTES using
// the original picked file's reported size, same as the web version's
// pre-Cloudinary check.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Render answers 502/503/504 while a sleeping instance wakes up — worth another try.
const RETRY_STATUS = [502, 503, 504];



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
   const [captions, setCaptions] = useState([]); // one description per image
  const setCaptionAt = (i, val) =>
    setCaptions((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // ── tags ──────────────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);
  const [tagResults, setTagResults] = useState([]);
  const [searchingTag, setSearchingTag] = useState(false);
  const tagTimer = useRef(null);

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

  // ← Edited photos are drawn from EditPost's numbers (crop/zoom/rotate/flip/filter)
  // by EditRender.js — view screenshots come back blank on this device. Rendering
  // starts as soon as this screen opens, so it's usually finished by the time the
  // user taps Post; handlePost just awaits the same job.
  const renderSpecs = state?.renderSpecs || [];
  const [renderedUris, setRenderedUris] = useState({});
  // per image: { state: "busy" | "done" | "failed" | "trivial", msg } — shown as a pill on the preview
  const [renderStatus, setRenderStatus] = useState({});
  const renderErrors = useRef({});
  const renderJobs = useRef({});
  const getRendered = useCallback((i) => {
    const spec = renderSpecs[i];
    if (!spec) return Promise.resolve(null);
    if (!renderJobs.current[i]) {
      renderJobs.current[i] = (async () => {
        try {
          // Nothing to bake (original framing, no filter): use the working copy as-is.
          if (spec.trivial) {
            const same = { uri: spec.uri, type: "image/jpeg", name: `edited-${i}.jpg` };
            setRenderedUris((p) => ({ ...p, [i]: same.uri }));
            setRenderStatus((p) => ({ ...p, [i]: { state: "trivial" } }));
            return same;
          }
          setRenderStatus((p) => ({ ...p, [i]: { state: "busy" } }));
          const matrix = parseCssFilterToMatrix(spec.filter);
          console.log(
            `[RENDER] #${i} start filter="${spec.filter}" matrix=${matrix ? "yes" : "NONE"} ` +
              `frame=${Math.round(spec.frameW)}x${Math.round(spec.frameH)} zoom=${spec.zoom} rot=${spec.rotation} flip=${spec.flip} ` +
              `pan=${Math.round(spec.tx)},${Math.round(spec.ty)}`
          );
          const file = await renderEditedImage(spec, matrix);
          setRenderedUris((p) => ({ ...p, [i]: file.uri }));
          setRenderStatus((p) => ({ ...p, [i]: { state: "done", msg: `${file.width}x${file.height} · ${file.engine} ${((file.ms || 0) / 1000).toFixed(1)}s` } }));
          return file;
        } catch (e) {
          const msg = e?.message || String(e);
          console.log(`[RENDER] #${i} failed:`, msg);
          renderErrors.current[i] = msg;
          setRenderStatus((p) => ({ ...p, [i]: { state: "failed", msg } }));
          return null; // handlePost asks before falling back to the older crop path
        }
      })();
    }
    return renderJobs.current[i];
  }, []);
  useEffect(() => {
    (async () => {
      for (let i = 0; i < renderSpecs.length; i++) await getRendered(i);
    })();
  }, []);

  // Preview box follows the photo's real shape so the WHOLE image is visible
  // (it used to be a fixed 350px box that cropped anything not that shape).
  const previewUri = renderedUris[previewIndex] || capturedUris[previewIndex] || images[previewIndex];
  const previewRatio = useImageAspect(previewUri);

 

  if (!images.length) {
    navigation.navigate("MainTabs", { screen: "Profile" });
    return null;
  }

  // ── tag handlers ───────────────────────────────────────────────────────
  const addTag = (override) => {
    // `override` is a username picked from the suggestion list; otherwise
    // we use whatever is typed in the box (plain tags still work).
    const raw = typeof override === "string" ? override : tagInput;
    const t = raw.trim().replace(/^[@#]/, "").toLowerCase().replace(/\s+/g, "_");
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
    setTagResults([]);
  };

  // ── tag suggestions: search users while typing (same endpoint as collab) ──
  const handleTagInput = (val) => {
    setTagInput(val);
    clearTimeout(tagTimer.current);
    const q = val.trim().replace(/^[@#]/, "");
    if (!q) {
      setTagResults([]);
      setSearchingTag(false);
      return;
    }
    setSearchingTag(true);
    tagTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/auth/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.users || [];
        setTagResults(
          list.filter((u) => u.username && !tags.includes(u.username.toLowerCase())).slice(0, 6)
        );
      } catch {}
      setSearchingTag(false);
    }, 300);
  };
  const pickTagUser = (user) => addTag(user.username);
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
    // Android can hand back a bare path with no scheme; RN needs one.
    let uri = editedFile.uri;
    if (uri && !/^(file|content|http|https):\/\//.test(uri)) uri = `file://${uri}`;
    const name = editedFile.name || `image_${index}.jpg`;
    const type = editedFile.type || "image/jpeg";

    // Pre-flight: make sure the edited image really exists and isn't empty, so a
    // missing/0-byte capture gives a clear message instead of a vague network error.
    let path = null; // raw filesystem path (only for file:// uris), used by blob-util
    if (uri && uri.startsWith("file://")) {
      path = decodeURIComponent(uri.replace("file://", ""));
      const status = await inspectImageFile(uri);
      console.log(`[UPLOAD] #${index} ${uri} size=${status.size} decodes=${status.decodes}`);
      if (!isUsableImage(status)) {
        throw new Error("The edited image file is missing or empty. Please go back, edit the photo again, and retry.");
      }
      if (status.size && status.size > MAX_IMAGE_BYTES) {
        throw new Error("This image is over the 10MB limit. Please choose a smaller one.");
      }
    }

    // ── Method A: react-native-blob-util. Streams the file straight from disk with
    // its own HTTP client and, unlike RN's fetch (which turns every native failure
    // into the same "Network request failed"), rejects with the REAL native error
    // (timeout, connection reset, host unreachable...). That message is logged below.
    const viaBlobUtil = async () => {
      const send = async (token) => {
        const resp = await ReactNativeBlobUtil.config({ timeout: 60000 }).fetch(
          "POST",
          `${API}/auth/upload-media`,
          {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "multipart/form-data",
          },
          [{ name: "file", filename: name, type, data: ReactNativeBlobUtil.wrap(path) }]
        );
        return { status: resp.info().status, text: resp.text() };
      };
      let r = await send(await getAuthToken());
      if (r.status === 401) {
        // Token expired: any apiFetch call runs the app's own refresh-token logic.
        await apiFetch(`${API}/auth/profile`);
        r = await send(await getAuthToken());
      }
      return r;
    };

    // ── Method B: the app's normal apiFetch + FormData (also handles 401 refresh).
    const viaFetch = async () => {
      // Rebuilt for every send: RN reads the file once per request.
      const formData = new FormData();
      formData.append("file", { uri, type, name });
      const res = await apiFetch(`${API}/auth/upload-media`, { method: "POST", body: formData });
      return { status: res.status, text: await res.text() };
    };

    const methods = [];
    if (path) methods.push(["blob-util", viaBlobUtil]);
    methods.push(["fetch", viaFetch]);

    const MAX_TRIES = 2;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      for (const [label, send] of methods) {
        try {
          const { status, text } = await send();
          console.log(`[UPLOAD] #${index} attempt ${attempt} via ${label} -> ${status}`, String(text).slice(0, 160));
          let data = {};
          try { data = JSON.parse(text); } catch {}

          if (status >= 200 && status < 300) {
            const url = data.url || data.secure_url;
            if (url) return url;
          }
          const err = new Error(data.message || `Upload failed (${status})`);
          err.http = true; // the server DID answer
          err.status = status;
          throw err;
        } catch (e) {
          lastErr = e;
          console.log(`[UPLOAD] #${index} attempt ${attempt} via ${label} failed:`, e?.message);
          // A real server answer (400, 413, 500 + its message...) is the answer: show it, don't mask it.
          if (e.http && !RETRY_STATUS.includes(e.status)) throw e;
          // Otherwise (connection-level failure, or 502/503/504): try the next method / attempt.
        }
      }
      if (attempt < MAX_TRIES) await sleep(1500); // let a sleeping Render instance / dropped connection recover
    }

    // Still failing at connection level: find out whether the server is reachable at all.
    let reachable = false;
    try {
      const ping = await apiFetch(`${API}/auth/profile`);
      reachable = ping.status < 500;
    } catch {}
    console.log(`[UPLOAD] server reachable after failure: ${reachable} | last error: ${lastErr?.message}`);
    const friendly = reachable
      ? "The connection dropped while sending the image. Please try again."
      : "Can't reach the server. Check your internet connection and try again.";
    throw new Error(__DEV__ ? `${friendly}\n\n(${lastErr?.message})` : friendly);
  };

  const handlePost = async () => {
    if (loading) return; // ignore extra taps while an upload is running
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
      // Make sure every edit was actually drawn. If one wasn't, say so BEFORE
      // uploading instead of silently posting an unedited photo.
      const results = await Promise.all(images.map((_, i) => getRendered(i)));
      const failedIdx = images.map((_, i) => i).filter((i) => renderSpecs[i] && !results[i]);
      if (failedIdx.length) {
        const reason = renderErrors.current[failedIdx[0]] || "unknown error";
        const proceed = await new Promise((resolve) =>
          Alert.alert(
            "Couldn't apply your edits",
            `${reason}\n\nPost anyway with the basic version of the photo?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Post anyway", onPress: () => resolve(true) },
            ]
          )
        );
        if (!proceed) {
          setLoading(false);
          return;
        }
      }
      const uploadedUrls = [];
      for (let i = 0; i < images.length; i++) {
        // If EditPost.js captured this frame directly (the normal case
        // now), it already IS the cropped + filtered image — upload it
        // as-is. Only fall back to getEditedImage() (crop the raw
        // source using a guessed rect) for an image with no capture,
        // e.g. if the frame capture failed for some reason.
        let edited = await getRendered(i); // drawn from the edit values (no screenshot)
        if (!edited && capturedUris[i]) {
          const status = await inspectImageFile(capturedUris[i]);
          console.log(`[UPLOAD] #${i} capture ${capturedUris[i]} size=${status.size} decodes=${status.decodes}`);
          if (isUsableImage(status)) {
            edited = { uri: capturedUris[i], type: "image/jpeg", name: `edited-${i}.jpg` };
          } else {
            // The screenshot file is empty/missing — rebuild this image from the source.
            console.log(`[UPLOAD] #${i} captured file is unusable, rebuilding from source`);
          }
        }
        if (!edited) edited = await getEditedImage(images[i], crops[i], filters[i]);
        const url = await uploadToBackend(edited, i);
        uploadedUrls.push(url);
      }

       const mediaPayload = uploadedUrls.map((url, i) => ({
        url,
        type: "image",
        caption: (captions[i] || "").trim(),
      }));
      const res = await apiFetch(`${API}/auth/add-media-post`, {
        method: "POST",
        body: JSON.stringify({
          media: mediaPayload,
          caption: (captions[0] || "").trim(), // legacy post-level caption
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
      else Alert.alert("Couldn't post", data.message || "Something went wrong. Please try again.");
    } catch (error) {
      console.log("POST ERROR:", error);
      Alert.alert("Couldn't post", error?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs", { screen: "Profile" });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#f4f4f4" }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <FeatherIcon name="arrow-left" size={22} color="#111" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>New Post</Text>
        <View style={{ width: 22 }} />
      </View>
    <ScrollView style={styles.wrapper} contentContainerStyle={{ alignItems: "center", padding: 15 }}>
      <View style={styles.card}>
        {/* IMAGE PREVIEW CAROUSEL */}
        <View style={{ position: "relative" }}>
          <Image
            source={{ uri: previewUri }}
            style={[
              styles.preview,
              { height: undefined, aspectRatio: previewRatio ? clampRatio(previewRatio) : 1, backgroundColor: "#111" },
            ]}
            resizeMode="contain"
          />
          {(() => {
            const st = renderStatus[previewIndex];
            const hasFilter = !!(filters && filters[previewIndex] && String(filters[previewIndex]).trim());
            let text = null, bad = false;
            if (!renderSpecs[previewIndex]) {
              if (hasFilter && __DEV__) { text = "⚠ Edit recipe not received — fallback in use"; bad = true; }
            } else if (st?.state === "busy" || !st) {
              text = SKIA_AVAILABLE ? "Applying your edits…" : "Applying your edits… (slow without Skia — can take about a minute)";
            } else if (st.state === "failed") {
              text = `⚠ Edits failed: ${st.msg}`; bad = true;
            } else if (st.state === "done" && __DEV__) {
              text = `✓ Edits applied (${st.msg})`;
            }
            return text ? (
              <View pointerEvents="none" style={[styles.statusPill, bad && styles.statusPillBad]}>
                <Text style={styles.statusText} numberOfLines={3}>{text}</Text>
              </View>
            ) : null;
          })()}
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

        
        {/* CAPTION — one per image */}
        <Text style={{ fontSize: 12, color: "#999", marginTop: 12 }}>
          {images.length > 1
            ? `Description for image ${previewIndex + 1} of ${images.length}`
            : "Description"}
        </Text>
        <TextInput
          placeholder={
            images.length > 1
              ? `Write a caption for image ${previewIndex + 1}...`
              : "Write a caption..."
          }
          placeholderTextColor="#999"
          value={captions[previewIndex] || ""}
          onChangeText={(v) => setCaptionAt(previewIndex, v)}
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
              onChangeText={handleTagInput}
              onSubmitEditing={addTag}
              placeholder="Tag people or add a tag..."
              style={styles.smallInput}
            />
            <TouchableOpacity onPress={addTag} style={styles.addBtn}>
              <Text style={{ fontSize: 13, fontWeight: "700" }}>Add</Text>
            </TouchableOpacity>
          </View>
          {tagResults.length > 0 && (
            <View style={styles.searchResults}>
              {tagResults.map((u) => (
                <TouchableOpacity key={u._id} style={styles.searchResultItem} onPress={() => pickTagUser(u)}>
                  <MiniAvatar user={u} />
                  <Text style={{ fontSize: 13, fontWeight: "600" }}>{u.username}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {searchingTag && <Text style={{ fontSize: 12, color: "#aaa", marginVertical: 6 }}>Searching...</Text>}
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
    </View>
  );
}

export default CreateImagePost;

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#f4f4f4" },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 15, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#eee" },
  topBarTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#fff", borderRadius: 16, padding: 15 },
  preview: { width: "100%", height: 350, borderRadius: 12 },
  statusPill: { position: "absolute", top: 8, left: 8, right: 8, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  statusPillBad: { backgroundColor: "rgba(200,30,30,0.9)" },
  statusText: { color: "#fff", fontSize: 12 },
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