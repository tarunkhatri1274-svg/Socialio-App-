import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import Config from "react-native-config";
import Svg, { Polyline, Path, Line, Circle, Rect } from "react-native-svg";
import {
  GestureHandlerRootView,
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import ViewShot from "react-native-view-shot";
import {
  ColorMatrix,
  concatColorMatrices,
  contrast as contrastMatrix,
  saturate as saturateMatrix,
  sepia as sepiaMatrix,
  hueRotate as hueRotateMatrix,
} from "react-native-color-matrix-image-filters";

const API = Config.API_URL;
import { apiFetch } from "../../api/authToken"; // adjust relative path to this file's location
const { width: SCREEN_W } = Dimensions.get("window");

/* ────────────────────────────────────────────────────────────────────
   SHARED ICONS — react-native-svg instead of inline JSX <svg>.
   ──────────────────────────────────────────────────────────────────── */
const Icon = {
  Back: ({ color = "#111", size = 20 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="15 18 9 12 15 6" />
    </Svg>
  ),
  Edit: ({ size = 14 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
      <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Svg>
  ),
  Close: ({ color = "#111", size = 18 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  ),
  RotateLeft: ({ color = "#F2F2F0", size = 17 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="1 4 1 10 7 10" /><Path d="M3.51 15a9 9 0 1 0 .49-9.36L1 10" />
    </Svg>
  ),
  RotateRight: ({ color = "#F2F2F0", size = 17 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" /><Path d="M20.49 15a9 9 0 1 1-.49-9.36L23 10" />
    </Svg>
  ),
  Flip: ({ color = "#F2F2F0", size = 17 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3v18" /><Path d="M16 7l4 5-4 5" /><Path d="M8 7l-4 5 4 5" />
    </Svg>
  ),
  Check: ({ color = "#1a1200", size = 16 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="20 6 9 17 4 12" />
    </Svg>
  ),
  ImagePlaceholder: ({ color = "#bbb", size = 28 }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Circle cx="8.5" cy="8.5" r="1.5" />
      <Polyline points="21 15 16 10 5 21" />
    </Svg>
  ),
};

/* ────────────────────────────────────────────────────────────────────
   PHOTO EDITOR
   Approximation note: RN has no Canvas2D. Instead of drawing to an
   off-screen canvas with ctx.filter, we render the live pan/zoom/
   rotate/flip/filter transform directly with Animated + ColorMatrix,
   then use react-native-view-shot to rasterize exactly what's on
   screen into a real image file — "what you see is what gets
   uploaded" is preserved, just via screenshot instead of canvas draw.

   Gesture handling note: react-native-reanimated v4 removed
   useAnimatedGestureHandler entirely. Pan/pinch are now built with
   the react-native-gesture-handler v2/v3 "Gesture" API
   (Gesture.Pan() / Gesture.Pinch() + a single <GestureDetector>)
   instead of the old <PanGestureHandler onGestureEvent={...}> style.

   FIX — full-image pan (matches web's crop behaviour): this used to
   render the Image at the FRAME's exact pixel size with
   resizeMode="cover", which means RN itself picked which slice of the
   source photo to show *before* any gesture ever ran — dragging just
   moved that already-cropped slice around inside empty space, so the
   rest of the photo was never reachable. The web version instead loads
   the image at its real natural width/height (naturalWidth/
   naturalHeight) and scales/pans *that*, so every pixel of the source
   photo is reachable. Image.getSize() below gets those same natural
   dimensions on RN, baseScale replicates the same "cover" math web
   uses (scale the smaller dimension up until it just covers the frame,
   times a small PAN_BUFFER so there's always a little slack to drag on
   both axes), and the pan/pinch handlers clamp translateX/Y to the
   image's real bounds at the current zoom — exactly like web's
   clampOffset.
   ──────────────────────────────────────────────────────────────────── */
const FILTER_PRESETS = [
  { name: "Original", v: { exposure: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0 } },
  { name: "Vivid",   v: { exposure: 5,  contrast: 18, saturation: 32, warmth: 6,   fade: 0 } },
  { name: "Mono",    v: { exposure: 0,  contrast: 10, saturation: -100, warmth: 0, fade: 0 } },
  { name: "Warm",    v: { exposure: 6,  contrast: 4,  saturation: 14, warmth: 42,  fade: 4 } },
  { name: "Cool",    v: { exposure: 0,  contrast: 8,  saturation: 6,  warmth: -32, fade: 0 } },
  { name: "Fade",    v: { exposure: 6,  contrast: -18, saturation: -8, warmth: 6,  fade: 40 } },
];

// Builds a single combined color-matrix from the same adjust values the
// web version turns into a CSS filter string.
function buildColorMatrix(e) {
  const contrast = 1 + e.contrast / 150 - e.fade / 250 + e.exposure / 200;
  const saturate = Math.max(0, 1 + e.saturation / 100);
  const warmSepia = e.warmth > 0 ? Math.min(0.5, e.warmth / 160) : 0;
  const coolHue = e.warmth < 0 ? Math.min(40, (-e.warmth / 100) * 40) : 0;

  const matrices = [contrastMatrix(contrast), saturateMatrix(saturate)];
  if (warmSepia) matrices.push(sepiaMatrix(warmSepia));
  if (coolHue) matrices.push(hueRotateMatrix(180 + coolHue));
  return concatColorMatrices(...matrices);
}

const defaultAdjust = () => ({ exposure: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, filterName: "Original" });

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
// Same "always leave a little pan room on both axes" buffer the web
// version uses on top of strict cover-fit — see the big comment above.
const PAN_BUFFER = 1.15;

function PhotoEditorModal({ src, shape, aspect, onCancel, onConfirm }) {
  const FRAME_W = Math.min(300, SCREEN_W - 40);
  const FRAME_H = Math.round(FRAME_W / aspect);

  const [tab, setTab] = useState("crop");
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState(false);
  const [adjust, setAdjust] = useState(defaultAdjust());
  const [busy, setBusy] = useState(false);

  // NEW — the source photo's real pixel dimensions, so we can pan/zoom
  // across the WHOLE image instead of a pre-cropped frame-sized slice.
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  const [imgReady, setImgReady] = useState(false);

  const viewShotRef = useRef(null);

  // Pan/zoom driven by reanimated shared values instead of raw
  // clientX/clientY math — gesture-handler feeds these directly.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const [zoomDisplay, setZoomDisplay] = useState(1); // mirrors `scale` for the slider UI

  // Load the real natural size of whatever photo was picked/re-opened.
  // Runs again whenever a different photo is loaded into the editor.
  useEffect(() => {
    let cancelled = false;
    setImgReady(false);
    setNatSize({ w: 0, h: 0 });
    Image.getSize(
      src,
      (w, h) => {
        if (cancelled) return;
        setNatSize({ w, h });
        setImgReady(true);
      },
      (err) => {
        console.log("Failed to read image size:", err);
        if (!cancelled) setImgReady(true);
      }
    );
    return () => { cancelled = true; };
  }, [src]);

  // "Cover" scale — the image fills the entire frame at zoom = 1 (no
  // letterboxing), same math as the web version's baseScale.
  const baseScale =
    natSize.w && natSize.h
      ? Math.max(FRAME_W / natSize.w, FRAME_H / natSize.h) * PAN_BUFFER
      : 1;

  // Keeps translateX/Y clamped to the image's real bounds at whatever
  // zoom level is passed in — mirrors the web version's clampOffset.
  const clampTranslate = (currentScale) => {
    "worklet";
    const w = natSize.w * baseScale * currentScale;
    const h = natSize.h * baseScale * currentScale;
    const maxX = Math.max(0, (w - FRAME_W) / 2);
    const maxY = Math.max(0, (h - FRAME_H) / 2);
    translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
    translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
  };

  // New Gesture API (replaces useAnimatedGestureHandler, removed in Reanimated v4)
  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      const w = natSize.w * baseScale * scale.value;
      const h = natSize.h * baseScale * scale.value;
      const maxX = Math.max(0, (w - FRAME_W) / 2);
      const maxY = Math.max(0, (h - FRAME_H) / 2);
      const nx = savedTranslateX.value + e.translationX;
      const ny = savedTranslateY.value + e.translationY;
      translateX.value = Math.min(maxX, Math.max(-maxX, nx));
      translateY.value = Math.min(maxY, Math.max(-maxY, ny));
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, savedScale.value * e.scale));
      scale.value = next;
      runOnJS(setZoomDisplay)(next);
      clampTranslate(next);
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: baseScale * scale.value },
      { rotate: `${rotation}deg` },
      { scaleX: flip ? -1 : 1 },
    ],
  }));

  const onSliderZoom = (v) => {
    scale.value = withTiming(v, { duration: 80 });
    setZoomDisplay(v);
    const w = natSize.w * baseScale * v;
    const h = natSize.h * baseScale * v;
    const maxX = Math.max(0, (w - FRAME_W) / 2);
    const maxY = Math.max(0, (h - FRAME_H) / 2);
    translateX.value = withTiming(Math.min(maxX, Math.max(-maxX, translateX.value)), { duration: 80 });
    translateY.value = withTiming(Math.min(maxY, Math.max(-maxY, translateY.value)), { duration: 80 });
  };

  const setField = (k, v) => setAdjust((p) => ({ ...p, [k]: v }));

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const uri = await viewShotRef.current.capture();
      onConfirm(uri);
    } catch (err) {
      console.log("Crop capture failed:", err);
      Alert.alert("Something went wrong saving the edit.");
    } finally {
      setBusy(false);
    }
  };

  const filterMatrix = buildColorMatrix(adjust);

  return (
    <View style={editorStyles.overlay}>
      <View style={editorStyles.card}>
        <View style={editorStyles.topBar}>
          <TouchableOpacity style={editorStyles.iconBtn} onPress={onCancel}><Icon.Close color="#F2F2F0" /></TouchableOpacity>
          <Text style={editorStyles.title}>{shape === "circle" ? "Edit profile photo" : "Edit cover photo"}</Text>
          <TouchableOpacity style={[editorStyles.applyBtn, (busy || !imgReady) && { opacity: 0.6 }]} onPress={handleConfirm} disabled={busy || !imgReady}>
            <Icon.Check /><Text style={editorStyles.applyBtnText}>{busy ? "..." : "Done"}</Text>
          </TouchableOpacity>
        </View>

        <View style={editorStyles.canvasWrap}>
          <ViewShot ref={viewShotRef} options={{ format: "jpg", quality: 0.92 }}>
            <View style={[editorStyles.frame, { width: FRAME_W, height: FRAME_H, borderRadius: shape === "circle" ? FRAME_W / 2 : 4 }]}>
              <GestureDetector gesture={composedGesture}>
                <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                  {imgReady && natSize.w > 0 && (
                    <Animated.View style={imageStyle}>
                      <ColorMatrix matrix={filterMatrix}>
                        <Image
                          source={{ uri: src }}
                          style={{ width: natSize.w, height: natSize.h }}
                        />
                      </ColorMatrix>
                    </Animated.View>
                  )}
                </Animated.View>
              </GestureDetector>
            </View>
          </ViewShot>
        </View>

        <View style={editorStyles.controlsArea}>
          {tab === "crop" && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <TouchableOpacity style={editorStyles.ghostBtn} onPress={() => setRotation((r) => (r - 90 + 360) % 360)}><Icon.RotateLeft /></TouchableOpacity>
              <TouchableOpacity style={editorStyles.ghostBtn} onPress={() => setRotation((r) => (r + 90) % 360)}><Icon.RotateRight /></TouchableOpacity>
              <TouchableOpacity style={editorStyles.ghostBtn} onPress={() => setFlip((f) => !f)}><Icon.Flip /></TouchableOpacity>
              {/* Slider: swap in @react-native-community/slider for a real thumb-drag control */}
              <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
                {[1, 1.5, 2, 2.5, 3].map((z) => (
                  <TouchableOpacity key={z} onPress={() => onSliderZoom(z)} style={[editorStyles.zoomStep, zoomDisplay >= z - 0.01 && zoomDisplay <= z + 0.01 && editorStyles.zoomStepActive]}>
                    <Text style={{ color: "#fff", fontSize: 10 }}>{z}x</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {tab === "adjust" && (
            <View>
              <AdjustRow label="Exposure" val={adjust.exposure} onChange={(v) => setField("exposure", v)} />
              <AdjustRow label="Contrast" val={adjust.contrast} onChange={(v) => setField("contrast", v)} />
              <AdjustRow label="Saturation" val={adjust.saturation} onChange={(v) => setField("saturation", v)} />
              <AdjustRow label="Warmth" val={adjust.warmth} onChange={(v) => setField("warmth", v)} />
              <AdjustRow label="Fade" val={adjust.fade} onChange={(v) => setField("fade", v)} min={0} max={100} />
            </View>
          )}

          {tab === "filters" && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={editorStyles.filterRow}>
              {FILTER_PRESETS.map((p) => (
                <TouchableOpacity key={p.name} style={{ alignItems: "center", marginRight: 9 }} onPress={() => setAdjust({ ...p.v, filterName: p.name })}>
                  <View style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: adjust.filterName === p.name ? ACCENT : "transparent" }}>
                    <ColorMatrix matrix={buildColorMatrix(p.v)}>
                      <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    </ColorMatrix>
                  </View>
                  <Text style={{ fontSize: 10, marginTop: 4, color: adjust.filterName === p.name ? ACCENT_DARK : "#999", fontWeight: "600" }}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={editorStyles.tabs}>
          {["crop", "adjust", "filters"].map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)}>
              <Text style={t === tab ? editorStyles.tabActive : editorStyles.tabInactive}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

function AdjustRow({ label, val, onChange, min = -100, max = 100 }) {
  const steps = [min, min / 2, 0, max / 2, max];
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
        <Text style={{ color: "#555", fontWeight: "600", fontSize: 11.5 }}>{label}</Text>
        <Text style={{ color: ACCENT_DARK, fontWeight: "700", fontSize: 11.5 }}>{val > 0 ? "+" : ""}{val}</Text>
      </View>
      {/* Swap in @react-native-community/slider for a real drag slider */}
      <View style={{ flexDirection: "row", gap: 4 }}>
        {steps.map((v, i) => (
          <TouchableOpacity key={i} onPress={() => onChange(v)} style={[editorStyles.zoomStep, val === v && editorStyles.zoomStepActive]}>
            <Text style={{ color: "#fff", fontSize: 9 }}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

export default function EditProfile() {
  const navigation = useNavigation();

  const [profilePic, setProfilePic] = useState(null);
  const [bgImage, setBgImage] = useState(null);
  const [profilePicFile, setProfilePicFile] = useState(null); // { uri, name, type }
  const [bgImageFile, setBgImageFile] = useState(null);
  const [username, setUsername] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const [editorTarget, setEditorTarget] = useState(null); // "avatar" | "cover" | null
  const [editorSrc, setEditorSrc] = useState(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await apiFetch(`${API}/auth/profile`);
        const data = await response.json();
        if (data.success) {
          setUsername(data.user.username || "");
          setDescription(data.user.bio || "");
          setProfilePic(data.user.profilePic || "");
          setBgImage(data.user.coverPic || "");
        }
      } catch (error) {
        console.log(error);
      }
    };
    fetchProfile();
  }, []);

  const pickImage = async (target) => {
    const result = await launchImageLibrary({ mediaType: "photo" });
    if (result.didCancel || !result.assets?.length) return;
    setEditorSrc(result.assets[0].uri);
    setEditorTarget(target);
  };

  const reEdit = (target) => {
    const src = target === "avatar" ? profilePic : bgImage;
    if (!src) return;
    setEditorSrc(src);
    setEditorTarget(target);
  };

  const closeEditor = () => { setEditorTarget(null); setEditorSrc(null); };

  const handleEditorConfirm = (uri) => {
    const fileEntry = { uri, name: uri.split("/").pop() || "photo.jpg", type: "image/jpeg" };
    if (editorTarget === "avatar") {
      setProfilePic(uri);
      setProfilePicFile(fileEntry);
    } else if (editorTarget === "cover") {
      setBgImage(uri);
      setBgImageFile(fileEntry);
    }
    closeEditor();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("username", username);
      formData.append("bio", description);

      if (profilePicFile) formData.append("profilePic", profilePicFile);
      if (bgImageFile) formData.append("coverPic", bgImageFile);

      const response = await apiFetch(`${API}/auth/update-profile`, {
        method: "PUT",
        body: formData, // apiFetch detects FormData and skips forcing Content-Type — boundary still set correctly
      });
      const data = await response.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => navigation.replace("MainTabs", { screen: "Profile" }), 1200);
      } else {
        Alert.alert(data.message);
      }
    } catch (error) {
      console.log(error);
      Alert.alert("Profile update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={s.page}>
        <ScrollView style={s.card} contentContainerStyle={{ paddingBottom: 40 }}>

          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity style={s.backBtn} onPress={() => navigation.navigate("MainTabs", { screen: "Profile" })}>
              <Icon.Back />
            </TouchableOpacity>
            <Text style={s.title}>Edit Profile</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saved || saving}
              style={[s.saveTopBtn, saved && s.saveTopBtnSaved, saving && { opacity: 0.7 }]}
            >
              <Text style={s.saveTopBtnText}>{saved ? "✓" : saving ? "..." : "Save"}</Text>
            </TouchableOpacity>
          </View>

          {/* Cover Photo */}
          <View style={s.coverWrapper}>
            <View style={[s.coverArea, !bgImage && { backgroundColor: "#f0f0f0" }]}>
              {bgImage ? (
                <Image source={{ uri: bgImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={s.coverPlaceholder}>
                  <Icon.ImagePlaceholder />
                  <Text style={s.coverPlaceholderText}>Add Cover Photo</Text>
                </View>
              )}

              <View style={s.coverBtnLeft}>
                {bgImage && (
                  <TouchableOpacity style={s.coverAdjustBtn} onPress={() => reEdit("cover")}>
                    <Text style={s.coverBtnText}>Adjust</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={s.coverBtnRight}>
                <TouchableOpacity style={s.coverEditBtn} onPress={() => pickImage("cover")}>
                  <Icon.Edit />
                  <Text style={s.coverBtnText}>{bgImage ? "Replace" : "Add"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Avatar overlapping cover */}
            <View style={s.avatarWrapper}>
              <View style={s.avatarRing}>
                {profilePic ? (
                  <Image source={{ uri: profilePic }} style={s.avatarImg} />
                ) : (
                  <View style={s.avatarFallback}>
                    <Text style={s.avatarFallbackText}>{username.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity style={s.avatarEditBtn} onPress={() => pickImage("avatar")}>
                <Icon.Edit />
              </TouchableOpacity>
            </View>
          </View>

          {/* Change Photo / Adjust links */}
          <View style={{ alignItems: "center", marginTop: 10, marginBottom: 28, flexDirection: "row", justifyContent: "center", gap: 16 }}>
            <TouchableOpacity onPress={() => pickImage("avatar")}>
              <Text style={s.changePhotoLink}>Change profile photo</Text>
            </TouchableOpacity>
            {profilePic && (
              <TouchableOpacity onPress={() => reEdit("avatar")}>
                <Text style={[s.changePhotoLink, { color: "#999" }]}>Adjust</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Fields */}
          <View style={s.fields}>
            <View style={s.fieldGroup}>
              <Text style={s.label}>Username</Text>
              <View style={[s.inputWrapper, focusedField === "username" && s.inputWrapperFocused]}>
                <Text style={s.inputPrefix}>@</Text>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  onFocus={() => setFocusedField("username")}
                  onBlur={() => setFocusedField(null)}
                  style={s.input}
                  placeholder="username"
                  placeholderTextColor="#aaa"
                />
              </View>
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.label}>Bio</Text>
              <View style={[s.textareaWrapper, focusedField === "bio" && s.inputWrapperFocused]}>
                <TextInput
                  value={description}
                  onChangeText={(t) => setDescription(t.slice(0, 150))}
                  onFocus={() => setFocusedField("bio")}
                  onBlur={() => setFocusedField(null)}
                  style={s.textarea}
                  placeholder="Tell people about yourself..."
                  placeholderTextColor="#aaa"
                  multiline
                  numberOfLines={4}
                />
                <Text style={s.charCount}>{description.length}/150</Text>
              </View>
            </View>
          </View>

          {/* Save Button (bottom) */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saved || saving}
            style={[s.saveBtn, saved && s.saveBtnSaved, saving && { opacity: 0.75 }]}
          >
            <Text style={s.saveBtnText}>{saved ? "✓  Profile Saved!" : saving ? "Saving..." : "Save Changes"}</Text>
          </TouchableOpacity>
        </ScrollView>

        {editorTarget && (
          <PhotoEditorModal
            src={editorSrc}
            shape={editorTarget === "avatar" ? "circle" : "rect"}
            aspect={editorTarget === "avatar" ? 1 : 2.35}
            onCancel={closeEditor}
            onConfirm={handleEditorConfirm}
          />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const ACCENT = "rgb(234,182,118)";
const ACCENT_LIGHT = "rgba(234,182,118,0.15)";
const ACCENT_DARK = "rgb(196,140,72)";
const BORDER = "#ececec";
const TEXT_PRIMARY = "#111";
const TEXT_SECONDARY = "#666";

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fdf8f2" },
  card: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER, width: 34, height: 34,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "700", color: TEXT_PRIMARY },
  saveTopBtn: { backgroundColor: ACCENT, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  saveTopBtnSaved: { backgroundColor: "#2ecc71" },
  saveTopBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  coverWrapper: { position: "relative", marginBottom: 60 },
  coverArea: {
    width: "100%", height: 180, backgroundColor: ACCENT, position: "relative", overflow: "hidden",
    borderBottomLeftRadius: 26, borderBottomRightRadius: 26,
  },
  coverPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  coverPlaceholderText: { fontSize: 13, fontWeight: "500", color: "rgba(255,255,255,0.85)" },
  coverBtnLeft: { position: "absolute", left: 14, bottom: 14 },
  coverBtnRight: { position: "absolute", right: 14, bottom: 14 },
  coverAdjustBtn: { backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
  coverEditBtn: { backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  coverBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  avatarWrapper: { position: "absolute", left: "50%", marginLeft: -52.5, bottom: -52 },
  avatarRing: { width: 105, height: 105, borderRadius: 52.5, padding: 4, backgroundColor: ACCENT },
  avatarImg: { width: "100%", height: "100%", borderRadius: 52.5, borderWidth: 4, borderColor: "#fff" },
  avatarFallback: { width: "100%", height: "100%", borderRadius: 52.5, backgroundColor: "#f1f1f1", borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { fontSize: 34, fontWeight: "700", color: ACCENT_DARK },
  avatarEditBtn: { position: "absolute", bottom: 6, right: 4, width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: "#fff", backgroundColor: ACCENT_DARK, alignItems: "center", justifyContent: "center" },
  changePhotoLink: { color: ACCENT_DARK, fontSize: 13, fontWeight: "700" },
  fields: { paddingHorizontal: 18, gap: 24 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginLeft: 4 },
  inputWrapper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: BORDER, borderRadius: 16, backgroundColor: "#fafafa" },
  inputWrapperFocused: { borderColor: ACCENT_DARK, backgroundColor: "#fff" },
  inputPrefix: { paddingLeft: 14, fontSize: 15, color: ACCENT_DARK, fontWeight: "600" },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 12, fontSize: 15, color: TEXT_PRIMARY },
  textareaWrapper: { borderWidth: 1, borderColor: BORDER, borderRadius: 16, backgroundColor: "#fafafa" },
  textarea: { padding: 14, fontSize: 15, color: TEXT_PRIMARY, textAlignVertical: "top", minHeight: 90 },
  charCount: { textAlign: "right", paddingHorizontal: 14, paddingBottom: 12, fontSize: 11, color: "#aaa" },
  saveBtn: { marginHorizontal: 18, marginTop: 34, paddingVertical: 15, borderRadius: 18, backgroundColor: ACCENT, alignItems: "center" },
  saveBtnSaved: { backgroundColor: "#2ecc71" },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});

const editorStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,10,11,0.92)", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 2000 },
  card: { width: "100%", maxWidth: 320, backgroundColor: "#111214", borderRadius: 18, overflow: "hidden" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  iconBtn: { padding: 4 },
  title: { fontSize: 12.5, fontWeight: "700", color: "#F2F2F0" },
  applyBtn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 4 },
  applyBtnText: { color: "#1a1200", fontSize: 12, fontWeight: "700" },
  canvasWrap: { alignItems: "center", padding: 14, backgroundColor: "#0A0A0B" },
  frame: { overflow: "hidden", backgroundColor: "#1a1a1c" },
  controlsArea: { padding: 14, minHeight: 92 },
  ghostBtn: { backgroundColor: "#1F2124", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, padding: 6, alignItems: "center", justifyContent: "center" },
  zoomStep: { backgroundColor: "#1F2124", borderRadius: 6, paddingVertical: 4, paddingHorizontal: 6, alignItems: "center" },
  zoomStepActive: { backgroundColor: ACCENT_DARK },
  filterRow: { flexDirection: "row" },
  tabs: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", paddingVertical: 10 },
  tabActive: { fontSize: 12, fontWeight: "700", color: ACCENT },
  tabInactive: { fontSize: 12, fontWeight: "600", color: "#8A8D93" },
});