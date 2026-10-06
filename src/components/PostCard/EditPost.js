import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  PanResponder,
  ActivityIndicator,
} from "react-native";
import ImageResizer from "@bam.tech/react-native-image-resizer";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Crop as CropIcon,
  SlidersHorizontal,
  Wand2,
  Sparkles,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  Eye,
  Sun,
  Contrast,
  Droplets,
  Thermometer,
  CloudFog,
  Focus,
  CircleDot,
  Wind,
} from "lucide-react-native";
import Slider from "@react-native-community/slider";
import Svg, { Defs, RadialGradient, Stop, Rect, Circle } from "react-native-svg";
import { ColorMatrix } from "react-native-color-matrix-image-filters";
import ViewShot from "react-native-view-shot";
import { useNavigation, useRoute } from "@react-navigation/native";
import { parseCssFilterToMatrix } from "./CropImage";

const SCREEN_WIDTH = Dimensions.get("window").width;

/* @react-navigation's useNavigation()/useRoute() throw if there's no
   NavigationContainer above this screen (e.g. when previewed standalone
   in a component playground). Guarding them means this file still works
   dropped straight into your navigator AND renders in isolation, same
   reasoning as the web version's useSafeRouter guarding react-router. */
function useSafeRouter() {
  let navigation = null;
  let route = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    navigation = useNavigation();
  } catch (e) {
    navigation = null;
  }
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    route = useRoute();
  } catch (e) {
    route = null;
  }
  return { navigation, route };
}

/* ────────────────────────────────────────────────────────────────────
   DEMO IMAGES — swap these for your own `images` / `files` from
   navigation params. The rest of the component is written to drop
   straight back into your project: same multi-image contract, same
   handleNext shape.
   ──────────────────────────────────────────────────────────────────── */
const DEMO_IMAGES = [
  "https://picsum.photos/id/1018/1400/1750",
  "https://picsum.photos/id/1015/1400/1750",
  "https://picsum.photos/id/1039/1400/1750",
];

const ASPECTS = [
  { key: "orig", label: "Original", ratio: null },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:5", label: "4:5", ratio: 4 / 5 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "9:16", label: "9:16", ratio: 9 / 16 },
];

const FILTER_PRESETS = [
  { name: "Original", v: { exposure: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0 } },
  { name: "Mono", v: { exposure: 0, contrast: 8, saturation: -100, warmth: 0, fade: 0 } },
  { name: "Noir", v: { exposure: -8, contrast: 32, saturation: -100, warmth: -8, fade: 0 } },
  { name: "Vivid", v: { exposure: 5, contrast: 20, saturation: 38, warmth: 6, fade: 0 } },
  { name: "Cinema", v: { exposure: -5, contrast: 15, saturation: -15, warmth: 15, fade: 10 } },
  { name: "Golden", v: { exposure: 8, contrast: 5, saturation: 18, warmth: 45, fade: 5 } },
  { name: "Cool", v: { exposure: 0, contrast: 10, saturation: 6, warmth: -35, fade: 0 } },
  { name: "Fade", v: { exposure: 6, contrast: -20, saturation: -10, warmth: 6, fade: 45 } },
];

const defaultEdit = () => ({
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
  rotation: 0,
  flip: false,
  aspect: "orig",
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  sharpen: 0,
  filterName: "Original",
});
// True only when every filter-affecting field is still at its default —
// used to skip the GPU ColorMatrix pass entirely when there's nothing to filter.
function isIdentityEdit(e) {
  return (
    e.exposure === 0 &&
    e.contrast === 0 &&
    e.saturation === 0 &&
    e.warmth === 0 &&
    e.fade === 0 &&
    e.sharpen === 0
  );
}
// Same math as the web version — produces a CSS-filter-function string.
// This is exactly what cropImageNative.js's getEditedImage() parses when
// baking the final export, so the string format has to stay identical.
function buildFilter(e) {
  const brightness = 1 + e.exposure / 200 + e.sharpen / 600;
  const contrast = 1 + e.contrast / 150 + e.sharpen / 300 - e.fade / 250;
  const saturate = Math.max(0, 1 + e.saturation / 100);
  const warmSepia = e.warmth > 0 ? Math.min(0.5, e.warmth / 160) : 0;
  const coolHue = e.warmth < 0 ? Math.min(40, (-e.warmth / 100) * 40) : 0;
  return [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturate.toFixed(3)})`,
    warmSepia ? `sepia(${warmSepia.toFixed(3)})` : "",
    coolHue ? `hue-rotate(${(180 + coolHue).toFixed(1)}deg) saturate(${saturate.toFixed(3)})` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// Live on-screen preview needs an actual color matrix (RN has no CSS
// `filter` on Image) rather than a string — reuses the same
// parseCssFilterToMatrix() the final export bakes with, so what you see
// while editing matches what gets uploaded.
function buildFilterMatrix(e) {
  return parseCssFilterToMatrix(buildFilter(e));
}

/* ── Vignette overlay — the web version used a CSS radial-gradient div;
   RN has no radial-gradient in core styling, so this uses react-native-
   svg's <RadialGradient> instead. Preview-only, same as on web: vignette
   was never part of buildFilter()'s exported string, so it was never
   actually baked into the uploaded image on web either — only visible
   while editing. That behavior carries over unchanged. ── */
function VignetteOverlay({ amount, width, height }) {
  if (amount <= 0) return null;
  const opacity = Math.min(1, amount / 140);
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="vig" cx="50%" cy="50%" r="70%">
          <Stop offset="35%" stopColor="#000" stopOpacity="0" />
          <Stop offset="100%" stopColor="#000" stopOpacity={opacity} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#vig)" />
    </Svg>
  );
}

/* ── Grain overlay — the web version used an SVG feTurbulence noise
   texture with mixBlendMode: overlay. RN's <svg filter>/feTurbulence
   isn't implemented by react-native-svg, and mixBlendMode support is
   inconsistent across RN versions/platforms, so this approximates film
   grain with a fixed set of small randomly-placed, randomly-opaque dots
   instead of true procedural noise. Also preview-only, matching the web
   version (grain was never part of buildFilter()'s exported string). ── */
const GRAIN_DOTS = Array.from({ length: 160 }, () => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  r: Math.random() * 0.6 + 0.2,
  o: Math.random() * 0.5 + 0.1,
}));

function GrainOverlay({ amount, width, height }) {
  if (amount <= 0) return null;
  const baseOpacity = amount / 160;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {GRAIN_DOTS.map((d, i) => (
        <Circle
          key={i}
          cx={`${d.x}%`}
          cy={`${d.y}%`}
          r={d.r}
          fill="#fff"
          opacity={d.o * baseOpacity}
        />
      ))}
    </Svg>
  );
}

export default function EditImagePage({ images: propImages, files: propFiles, onBack, onNext }) {
  const { navigation, route } = useSafeRouter();
  const params = route?.params;

  // Priority: explicit props > navigation params (single or multi image) > demo fallback.
  const paramImages = params?.images || (params?.image ? [params.image] : null);
  const images = (propImages && propImages.length ? propImages : paramImages) || DEMO_IMAGES;
  const files =
    (propFiles && propFiles.length ? propFiles : params?.files) || (params?.file ? [params.file] : []);
  const usingRealImages = Boolean((propImages && propImages.length) || paramImages);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeTool, setActiveTool] = useState("crop");
  const [edits, setEdits] = useState(images.map(() => defaultEdit()));
  const [history, setHistory] = useState([images.map(() => defaultEdit())]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [hud, setHud] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [naturalRatios, setNaturalRatios] = useState(images.map(() => 3 / 4));
  // ← NEW: track each image's REAL natural pixel size (not just its
  // ratio), so handleNext's crop rect never exceeds the source image's
  // actual bounds. The previous version guessed a fixed 1080px width for
  // every image — when a real photo was narrower than that, cropImage()
  // was asked for a region larger than the source, and padded the extra
  // space with solid black instead of erroring. That's what produced
  // the black bar on one side of uploaded posts.
  const [naturalSizes, setNaturalSizes] = useState(images.map(() => null));
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  // ← NEW: instead of trying to reverse-engineer offsetX/offsetY/zoom/
  // aspect (preview-pixel space) back into a crop rect in the source
  // image's natural-pixel space — fragile, and the exact reason the
  // previous crops calculation below could only ever crop the full
  // image — capture EXACTLY what's on screen in the crop frame,
  // pan/zoom/aspect/filter and all, as a flat jpg. This is the same
  // "screenshot what's rendered" technique CropImage.js's
  // FilterCaptureHost already uses for filters; here it's applied to
  // the crop frame itself, so crop+filter both come out correct
  // together with no coordinate math at all.
  const [capturedUris, setCapturedUris] = useState(images.map(() => null));
  const frameShotRef = useRef(null);

  // ← NEW: `images` now arrives as the picker's raw, full-camera-
  // resolution URIs (ProfilePage.js no longer resizes before
  // navigating here, so the "Next" tap that opens this screen is
  // instant instead of blocking on every selected photo's downscale).
  // Do that downscale HERE instead, per image, in the background, and
  // track each one's lighter working copy separately so the heavy
  // decode/ColorMatrix/ViewShot work below always runs against a small
  // (1440px) image rather than the original — which is what keeps
  // panning/filtering smooth once you're actually on this screen.
  const [workingUris, setWorkingUris] = useState(images.map(() => null));
  const [resizeFailed, setResizeFailed] = useState(images.map(() => false));
useEffect(() => {
  if (!images.length) return;
  let cancelled = false;

  const resizeOne = async (i) => {
    try {
      const t0 = Date.now();
      const { uri } = await ImageResizer.createResizedImage(
        images[i], 1440, 1440, "JPEG", 85, 0, undefined, false,
        { mode: "contain", onlyScaleDown: true }
      );
      console.log(`EditPost: resized #${i} in ${Date.now() - t0}ms`);
      if (cancelled) return;
      setWorkingUris((prev) => {
        const next = [...prev];
        next[i] = uri;
        return next;
      });
    } catch (e) {
      console.warn("EditPost: resize failed for index", i, e);
      if (!cancelled) {
        setResizeFailed((prev) => {
          const next = [...prev];
          next[i] = true;
          return next;
        });
      }
    }
  };

  (async () => {
    await resizeOne(0); // first image runs alone so nothing competes with it
    let next = 1;
    const worker = async () => {
      while (!cancelled && next < images.length) {
        const i = next++;
        await resizeOne(i);
      }
    };
    await Promise.all([worker(), worker()]);
  })();

  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [images.length]);

  // What the canvas/filmstrip/export should actually use: the resized
  // copy once it's ready, or the raw original if that one image's
  // resize failed (better a slightly slower edit than a blocked one).
  const displayUris = images.map((src, i) => workingUris[i] || (resizeFailed[i] ? src : null));

  const editsRef = useRef(edits);
  editsRef.current = edits;
  const hudTimer = useRef(null);
  const dragStartOffset = useRef({ x: 0, y: 0 });

  // In production, wire this up to bounce back when there's really
  // nothing to edit (no prop images, no nav params). Left off here so
  // this still renders something when previewed on its own — same as
  // the web version's commented-out useEffect.
  // useEffect(() => {
  //   if (!usingRealImages && navigation) navigation.navigate("Profile");
  // }, []);

  // Screenshots the crop frame for `index` exactly as currently
  // displayed (pan, zoom, aspect crop, and any ColorMatrix filter
  // preview all baked in together) and stashes the result. Safe to call
  // repeatedly — re-capturing an index just overwrites its entry.
  const captureCurrentFrame = useCallback(async (index) => {
    if (!frameShotRef.current) return null;
    try {
      const uri = await frameShotRef.current.capture();
      setCapturedUris((prev) => {
        const next = [...prev];
        next[index] = uri;
        return next;
      });
      return uri;
    } catch (e) {
      // Non-fatal: AddImagePost.js falls back to files[i]/images[i] +
      // getEditedImage() for any index with no captured uri, same as
      // before this change existed.
      console.warn("EditPost: frame capture failed for index", index, e);
      return null;
    }
  }, []);

  const handleBack = () => {
    if (onBack) return onBack();
    if (navigation) return navigation.goBack();
  };

  const handleNext = async () => {
    const filterStrings = edits.map(buildFilter);

    // Capture whatever's currently on screen before navigating away —
    // this covers the image the user was actively looking at when they
    // tapped Next (the only one that might not already be in
    // capturedUris from a filmstrip switch).
    const finalCaptures = [...capturedUris];
    const uri = await captureCurrentFrame(currentIndex);
    if (uri) finalCaptures[currentIndex] = uri;

    // Kept as a fallback for any image whose capture failed (e.g. the
    // frame never actually laid out) — AddImagePost.js already knows
    // how to use this the same way it did before.
    const crops = images.map((_, i) => {
      const size = naturalSizes[i];
      if (!size) return undefined;
      return { x: 0, y: 0, width: size.width, height: size.height };
    });

    const payload = {
      // ← Prefer each image's resized working copy over the raw
      // original here — AddImagePost.js only falls back to this array
      // (via getEditedImage) when a capturedUris[i] entry is missing,
      // but when it does, it's better that fallback crop runs against
      // the lighter 1440px copy than the full camera-resolution file.
      images: images.map((src, i) => workingUris[i] || src),
      files,
      edits,
      filters: filterStrings,
      crops,
      capturedUris: finalCaptures,
    };
    if (onNext) return onNext(payload);
    if (navigation) return navigation.navigate("CreateImagePost", payload);
  };

  const cur = edits[currentIndex];

  const setField = (field, value) => {
    setEdits((prev) => {
      const n = [...prev];
      n[currentIndex] = { ...n[currentIndex], [field]: value };
      return n;
    });
  };

  const showHud = (label, value, unit = "") => {
    setHud({ label, value, unit });
    clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHud(null), 900);
  };

  const commit = useCallback(() => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, editsRef.current];
    });
    setHistoryIndex((i) => i + 1);
  }, [historyIndex]);

  const undo = () => {
    if (historyIndex === 0) return;
    const idx = historyIndex - 1;
    setHistoryIndex(idx);
    setEdits(history[idx]);
  };
  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const idx = historyIndex + 1;
    setHistoryIndex(idx);
    setEdits(history[idx]);
  };

  const resetCurrent = () => {
    setEdits((prev) => {
      const n = [...prev];
      n[currentIndex] = defaultEdit();
      return n;
    });
    setTimeout(commit, 0);
  };

  const applyPreset = (preset) => {
    setEdits((prev) => {
      const n = [...prev];
      n[currentIndex] = { ...n[currentIndex], ...preset.v, filterName: preset.name };
      return n;
    });
    setTimeout(commit, 0);
  };

  const rotate = (dir) => {
    setField("rotation", (cur.rotation + (dir === "r" ? 90 : -90) + 360) % 360);
    setTimeout(commit, 0);
  };
  const flip = () => {
    setField("flip", !cur.flip);
    setTimeout(commit, 0);
  };

  // ── pan handling — PanResponder replaces the web version's raw
  // mouse/touch move listeners on the frame element. ──
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeTool === "crop",
      onPanResponderGrant: () => {
        dragStartOffset.current = { x: cur.offsetX, y: cur.offsetY };
      },
      onPanResponderMove: (_, g) => {
        setField("offsetX", dragStartOffset.current.x + g.dx);
        setField("offsetY", dragStartOffset.current.y + g.dy);
      },
      onPanResponderRelease: () => commit(),
      onPanResponderTerminate: () => commit(),
    })
  ).current;

  const editedFlags = edits.map((e) => JSON.stringify(e) !== JSON.stringify(defaultEdit()));

  const frameRatio = ASPECTS.find((a) => a.key === cur.aspect)?.ratio || naturalRatios[currentIndex];

  const previewMatrix = comparing || isIdentityEdit(cur) ? null : buildFilterMatrix(cur);

  const imgTransform = [
    { translateX: cur.offsetX },
    { translateY: cur.offsetY },
    { scale: cur.zoom },
    { rotate: `${cur.rotation}deg` },
    { scaleX: cur.flip ? -1 : 1 },
  ];

  const TOOLS = [
    { key: "crop", label: "Crop", Icon: CropIcon },
    { key: "adjust", label: "Adjust", Icon: SlidersHorizontal },
    { key: "filters", label: "Filters", Icon: Wand2 },
    { key: "effects", label: "Effects", Icon: Sparkles },
  ];

  return (
    <View style={styles.page}>
      {/* TOP BAR */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleBack}>
          <ArrowLeft size={19} color="#F2F2F0" />
        </TouchableOpacity>

        <View style={styles.topCenter}>
          <Text style={styles.topTitle}>Edit</Text>
          {images.length > 1 && (
            <Text style={styles.pageCounter}>
              {String(currentIndex + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}
            </Text>
          )}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <TouchableOpacity
            style={[styles.iconBtn, { opacity: historyIndex === 0 ? 0.35 : 1 }]}
            onPress={undo}
            disabled={historyIndex === 0}
          >
            <Undo2 size={18} color="#F2F2F0" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { opacity: historyIndex >= history.length - 1 ? 0.35 : 1 }]}
            onPress={redo}
            disabled={historyIndex >= history.length - 1}
          >
            <Redo2 size={18} color="#F2F2F0" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={{ color: "#0A0A0B", fontSize: 13, fontWeight: "700" }}>Next</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* CANVAS */}
      <View style={styles.canvas}>
        <View
          style={[styles.frame, { aspectRatio: frameRatio || naturalRatios[currentIndex] }]}
          onLayout={(e) => setFrameSize(e.nativeEvent.layout)}
          {...panResponder.panHandlers}
        >
          {/* Only the actual image layers live inside ViewShot — the
              crop grid lines and "ORIGINAL" compare tag below are UI
              chrome, not part of the photo, so they're kept as
              siblings OUTSIDE it and never get baked into the capture. */}
          <ViewShot ref={frameShotRef} options={{ format: "jpg", quality: 0.92 }} style={StyleSheet.absoluteFill}>
          {!displayUris[currentIndex] ? (
            // ← Working copy for this image isn't resized yet — show a
            // spinner instead of mounting the ColorMatrix/Image against
            // the full-res original, which is exactly the decode lag
            // this screen used to get pre-resized (in ProfilePage.js)
            // to avoid. This only blocks the CANVAS, not navigation —
            // you land on this screen instantly either way.
<View style={styles.resizingFrame}>
  <Image
    source={{ uri: images[currentIndex] }}
    style={StyleSheet.absoluteFill}
    resizeMode="cover"
    resizeMethod="resize"
  />
  <ActivityIndicator color="#2FD9C4" size="small" />
</View>
          ) : previewMatrix ? (
            <ColorMatrix matrix={previewMatrix}>
              <Image
                source={{ uri: displayUris[currentIndex] }}
                onLoad={(e) => {
                  const { width: w, height: h } = e.nativeEvent.source;
                  if (w && h) {
                    setNaturalRatios((prev) => {
                      const n = [...prev];
                      n[currentIndex] = w / h;
                      return n;
                    });
                    // ← NEW: also record the real natural pixel size,
                    // used by handleNext to build an accurate crop rect.
                    setNaturalSizes((prev) => {
                      const n = [...prev];
                      n[currentIndex] = { width: w, height: h };
                      return n;
                    });
                  }
                }}
                style={[styles.frameImage, { transform: imgTransform }]}
                resizeMode="cover"
              />
            </ColorMatrix>
          ) : (
            <Image
              source={{ uri: displayUris[currentIndex] }}
              onLoad={(e) => {
                const { width: w, height: h } = e.nativeEvent.source;
                if (w && h) {
                  setNaturalRatios((prev) => {
                    const n = [...prev];
                    n[currentIndex] = w / h;
                    return n;
                  });
                  setNaturalSizes((prev) => {
                    const n = [...prev];
                    n[currentIndex] = { width: w, height: h };
                    return n;
                  });
                }
              }}
              style={styles.frameImage}
              resizeMode="cover"
            />
          )}

          {!comparing && cur.vignette > 0 && frameSize.width > 0 && (
            <VignetteOverlay amount={cur.vignette} width={frameSize.width} height={frameSize.height} />
          )}
          {!comparing && cur.grain > 0 && frameSize.width > 0 && (
            <GrainOverlay amount={cur.grain} width={frameSize.width} height={frameSize.height} />
          )}
          </ViewShot>

          {activeTool === "crop" && !comparing && (
            <View style={styles.grid} pointerEvents="none">
              {[1, 2].map((i) => (
                <View key={"v" + i} style={[styles.gridLineV, { left: `${(i * 100) / 3}%` }]} />
              ))}
              {[1, 2].map((i) => (
                <View key={"h" + i} style={[styles.gridLineH, { top: `${(i * 100) / 3}%` }]} />
              ))}
            </View>
          )}

          {comparing && (
            <View style={styles.compareTagWrap} pointerEvents="none">
              <Text style={styles.compareTag}>ORIGINAL</Text>
            </View>
          )}
        </View>

        {hud && (
          <View style={styles.hud} pointerEvents="none">
            <Text style={styles.hudText}>
              {hud.label} <Text style={{ color: "#2FD9C4" }}>{hud.value > 0 ? "+" : ""}{hud.value}{hud.unit}</Text>
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.compareBtn}
          onPressIn={() => setComparing(true)}
          onPressOut={() => setComparing(false)}
        >
          <Eye size={15} color="#F2F2F0" />
        </TouchableOpacity>
      </View>

      {/* FILMSTRIP */}
      {images.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filmstrip}>
          {images.map((src, i) => (
            <TouchableOpacity
              key={i}
              onPress={async () => {
                if (i === currentIndex) return;
                // Only worth screenshotting the outgoing frame if it
                // actually finished rendering the real image (not the
                // resize spinner) — otherwise there's nothing edited to
                // capture yet, and AddImagePost.js's fallback path
                // handles a missing capturedUris[i] entry fine.
                if (displayUris[currentIndex]) await captureCurrentFrame(currentIndex);
                setCurrentIndex(i);
              }}
              style={[styles.filmThumb, { borderColor: i === currentIndex ? "#2FD9C4" : "transparent" }]}
            >
              {/* Thumbnail is tiny (44x44) so decoding straight from the
                  raw picker uri here is cheap even before its resize
                  finishes — only the big canvas above needs to wait. */}
              <Image source={{ uri: src }} style={{ width: "100%", height: "100%", borderRadius: 7 }} />
              {!displayUris[i] && (
                <View style={styles.filmThumbLoading}>
                  <ActivityIndicator color="#2FD9C4" size="small" />
                </View>
              )}
              {editedFlags[i] && <View style={styles.editedDot} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* TOOL DRAWER */}
      <View style={styles.drawer}>
        {activeTool === "crop" && (
          <View>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {ASPECTS.map((a) => (
                  <TouchableOpacity
                    key={a.key}
                    onPress={() => {
                      setField("aspect", a.key);
                      setTimeout(commit, 0);
                    }}
                    style={[styles.aspectPill, { backgroundColor: cur.aspect === a.key ? "#2FD9C4" : "#1F2124" }]}
                  >
                    <Text style={{ color: cur.aspect === a.key ? "#0A0A0B" : "#C9CBD1", fontSize: 11.5, fontWeight: "700" }}>
                      {a.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 16 }}>
              <TouchableOpacity style={styles.iconBtnGhost} onPress={() => rotate("l")}>
                <RotateCcw size={17} color="#F2F2F0" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtnGhost} onPress={() => rotate("r")}>
                <RotateCw size={17} color="#F2F2F0" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtnGhost} onPress={flip}>
                <FlipHorizontal size={17} color="#F2F2F0" />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Slider
                  minimumValue={1}
                  maximumValue={3}
                  step={0.05}
                  value={cur.zoom}
                  minimumTrackTintColor="#2FD9C4"
                  maximumTrackTintColor="#2A2C30"
                  thumbTintColor="#F2F2F0"
                  onValueChange={(v) => {
                    setField("zoom", v);
                    showHud("ZOOM", v.toFixed(1), "×");
                  }}
                  onSlidingComplete={commit}
                />
              </View>
            </View>
          </View>
        )}

        {activeTool === "adjust" && (
          <View style={styles.sliderGrid}>
            <SliderRow Icon={Sun} label="Exposure" field="exposure" cur={cur} setField={setField} showHud={showHud} commit={commit} />
            <SliderRow Icon={Contrast} label="Contrast" field="contrast" cur={cur} setField={setField} showHud={showHud} commit={commit} />
            <SliderRow Icon={Droplets} label="Saturation" field="saturation" cur={cur} setField={setField} showHud={showHud} commit={commit} />
            <SliderRow Icon={Thermometer} label="Warmth" field="warmth" cur={cur} setField={setField} showHud={showHud} commit={commit} />
            <SliderRow Icon={CloudFog} label="Fade" field="fade" cur={cur} setField={setField} showHud={showHud} commit={commit} min={0} max={100} />
          </View>
        )}

        {activeTool === "effects" && (
          <View style={styles.sliderGrid}>
            <SliderRow Icon={CircleDot} label="Vignette" field="vignette" cur={cur} setField={setField} showHud={showHud} commit={commit} min={0} max={100} />
            <SliderRow Icon={Wind} label="Grain" field="grain" cur={cur} setField={setField} showHud={showHud} commit={commit} min={0} max={100} />
            <SliderRow Icon={Focus} label="Sharpen" field="sharpen" cur={cur} setField={setField} showHud={showHud} commit={commit} min={0} max={100} />
          </View>
        )}

        {activeTool === "filters" && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
{FILTER_PRESETS.map((p) => {
  const presetMatrix = isIdentityEdit(p.v) ? null : buildFilterMatrix({ ...defaultEdit(), ...p.v });
  return (
                <TouchableOpacity key={p.name} onPress={() => applyPreset(p)} style={{ alignItems: "center", marginRight: 14 }}>
                  <View
                    style={[
                      styles.presetThumbWrap,
                      { borderColor: cur.filterName === p.name ? "#2FD9C4" : "transparent" },
                    ]}
                  >
                    {presetMatrix ? (
                      <ColorMatrix matrix={presetMatrix}>
                        <Image source={{ uri: displayUris[currentIndex] || images[currentIndex] }} style={styles.presetThumbImg} resizeMode="cover" />
                      </ColorMatrix>
                    ) : (
                      <Image source={{ uri: displayUris[currentIndex] || images[currentIndex] }} style={styles.presetThumbImg} resizeMode="cover" />
                    )}
                  </View>
                  <Text style={[styles.presetLabel, { color: cur.filterName === p.name ? "#2FD9C4" : "#8A8D93" }]}>
                    {p.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.resetRow}>
          <TouchableOpacity onPress={resetCurrent}>
            <Text style={styles.resetBtn}>RESET IMAGE</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* BOTTOM TOOL DOCK */}
      <View style={styles.dock}>
        {TOOLS.map((t) => {
          const { Icon } = t;
          const active = activeTool === t.key;
          return (
            <TouchableOpacity key={t.key} style={styles.dockBtn} onPress={() => setActiveTool(t.key)}>
              <Icon size={19} color={active ? "#2FD9C4" : "#8A8D93"} />
              <Text style={{ fontSize: 10, marginTop: 4, color: active ? "#2FD9C4" : "#8A8D93", letterSpacing: 0.4 }}>
                {t.label.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SliderRow({ Icon, label, field, cur, setField, showHud, commit, min = -100, max = 100 }) {
  const val = cur[field];
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon size={14} color="#8A8D93" />
        <Text style={{ fontSize: 12.5, color: "#C9CBD1", fontWeight: "600" }}>{label}</Text>
        <Text style={{ fontSize: 11.5, color: "#2FD9C4", marginLeft: "auto" }}>
          {val > 0 ? "+" : ""}
          {val}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={1}
        value={val}
        minimumTrackTintColor="#2FD9C4"
        maximumTrackTintColor="#2A2C30"
        thumbTintColor="#F2F2F0"
        onValueChange={(v) => {
          setField(field, v);
          showHud(label.toUpperCase(), v);
        }}
        onSlidingComplete={commit}
      />
    </View>
  );
}

/* ─────────────────────────── Styles ─────────────────────────── */
const styles = StyleSheet.create({
  page: {
    flex: 1,
    maxWidth: 430,
    width: "100%",
    alignSelf: "center",
    backgroundColor: "#0A0A0B",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "#0A0A0B",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  topCenter: { alignItems: "center" },
  topTitle: { fontSize: 14, fontWeight: "700", color: "#F2F2F0", letterSpacing: 0.3 },
  pageCounter: { fontSize: 10, color: "#8A8D93", marginTop: 1, letterSpacing: 1 },
  iconBtn: { padding: 8, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  iconBtnGhost: {
    backgroundColor: "#17181B",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 9,
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtn: {
    backgroundColor: "#F0A83C",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginLeft: 4,
  },
  canvas: {
    flex: 1,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0A0B",
    overflow: "hidden",
    padding: 14,
  },
  frame: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#111",
  },
  frameImage: { width: "100%", height: "100%" },
  resizingFrame: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#111" },
  grid: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  gridLineV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  gridLineH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  compareTagWrap: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  compareTag: { fontSize: 10, letterSpacing: 1.2, color: "#F2F2F0", fontWeight: "700" },
  hud: {
    position: "absolute",
    top: 24,
    alignSelf: "center",
    backgroundColor: "rgba(10,10,11,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  hudText: { fontSize: 12, letterSpacing: 0.5, fontWeight: "600", color: "#F2F2F0" },
  compareBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(23,24,27,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  filmstrip: { flexGrow: 0, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#0A0A0B" },
  filmThumb: {
    position: "relative",
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 2,
  },
  filmThumbLoading: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,11,0.55)",
  },
  editedDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2FD9C4",
    borderWidth: 2,
    borderColor: "#0A0A0B",
  },
  drawer: {
    backgroundColor: "#111214",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    minHeight: 128,
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  aspectPill: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  sliderGrid: { paddingTop: 2 },
  filterRow: { flexGrow: 0, paddingBottom: 4 },
  presetThumbWrap: { width: 56, height: 56, borderRadius: 10, overflow: "hidden", borderWidth: 2 },
  presetThumbImg: { width: "100%", height: "100%" },
  presetLabel: { fontSize: 10, marginTop: 5 },
  resetRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  resetBtn: { color: "#8A8D93", fontSize: 10.5, letterSpacing: 0.6, paddingVertical: 6, paddingHorizontal: 2 },
  dock: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#0A0A0B",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    paddingTop: 10,
    paddingBottom: 14,
  },
  dockBtn: { alignItems: "center", justifyContent: "center" },
});