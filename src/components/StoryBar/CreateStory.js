import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Animated,
  Alert,
  Linking,
  Dimensions,
  StyleSheet,
  NativeModules,
  requireNativeComponent,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import FeatherIcon from "react-native-vector-icons/Feather";
import Icon from "react-native-vector-icons/FontAwesome5";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { launchImageLibrary } from "react-native-image-picker";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
  mediaDevices,
} from "react-native-webrtc";
import ViewShot from "react-native-view-shot";
import { ColorMatrix } from "react-native-color-matrix-image-filters";
import { apiFetch, getCachedUser } from "../../api/authToken"; // adjust relative path
import Config from "react-native-config";
import socket from "../../sockets/Sockets";

const API = Config.API_URL;
const GOLDEN = "rgb(234,182,118)";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const LIVE_REACTIONS = ["❤️", "😂", "😮", "🔥", "👏"];
const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;

// Native <TextureView>-backed live preview fed directly by
// VideoRecorderModule's own Camera2 session during recording — see
// VideoRecorderPreviewView.kt / VideoRecorderPreviewViewManager.kt.
// Only rendered while isRecording is true; VisionCamera's <Camera>
// handles every other case (idle preview, photo capture, filters).
const VideoRecorderPreview = requireNativeComponent("VideoRecorderPreview");



/**
 * ── vision-camera version note ──────────────────────────────────────
 * This app runs react-native-vision-camera v5.x (RN 0.86 compatible).
 * Video recording is temporarily removed due to a media3/CameraX
 * dependency conflict with react-native-video. Photo capture,
 * post-capture filters, gallery upload, and live streaming remain
 * fully functional.
 *
 * ── live filter preview note ──────────────────────────────────────
 * True per-pixel live filtering (Skia onFrame) isn't supported on this
 * device's camera hardware (HardwareBuffer failure — see project notes).
 * Instead, a translucent tint overlay is drawn on top of the live
 * preview to APPROXIMATE each filter's mood while framing a shot.
 * The final captured photo still gets the exact, pixel-accurate
 * ColorMatrix filter applied via applyFilterToPhoto() below — the
 * overlay is a preview cue only, not what gets saved.
 */

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const GRAYSCALE_MATRIX = [
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0, 0, 0, 1, 0,
];
const SEPIA_MATRIX = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];
const INVERT_MATRIX = [-1, 0, 0, 0, 255, 0, -1, 0, 0, 255, 0, 0, -1, 0, 255, 0, 0, 0, 1, 0];
const VINTAGE_MATRIX = [
  1.06, 0.16, 0.03, 0, -18,
  0.09, 1.0, 0.04, 0, -18,
  0.07, 0.12, 0.85, 0, -18,
  0, 0, 0, 1, 0,
];
const WARM_MATRIX = [
  1.2, -0.05, 0.02, 0, 8,
  0.02, 1.1, -0.02, 0, 2,
  -0.05, -0.05, 0.95, 0, -4,
  0, 0, 0, 1, 0,
];
const COOL_MATRIX = [
  0.98, -0.02, 0.06, 0, -4,
  -0.02, 1.05, 0.02, 0, 0,
  0.02, 0.02, 1.15, 0, 6,
  0, 0, 0, 1, 0,
];
const NOIR_MATRIX = [
  0.253, 0.850, 0.086, 0, -35,
  0.253, 0.850, 0.086, 0, -35,
  0.253, 0.850, 0.086, 0, -35,
  0, 0, 0, 1, 0,
];

const FILTER_MATRICES = {
  none: IDENTITY_MATRIX,
  grayscale: GRAYSCALE_MATRIX,
  sepia: SEPIA_MATRIX,
  vintage: VINTAGE_MATRIX,
  warm: WARM_MATRIX,
  cool: COOL_MATRIX,
  invert: INVERT_MATRIX,
  noir: NOIR_MATRIX,
};

// Approximate live-preview tint for each filter. Not pixel-accurate —
// just a visual cue layered over the plain camera feed. `blendMode`
// falls back silently on platforms/RN versions that ignore it (the
// overlay still shows as a plain tint either way).
const FILTER_PREVIEW_TINTS = {
  none: null,
  grayscale: { color: "#808080", opacity: 0.14 },
  sepia: { color: "#704214", opacity: 0.16 },
  vintage: { color: "#4a3520", opacity: 0.13 },
  warm: { color: "#ff9d3f", opacity: 0.12 },
  cool: { color: "#3f9dff", opacity: 0.12 },
  invert: { color: "#ffffff", opacity: 0.22 },
  noir: { color: "#000000", opacity: 0.24 },
};

const FILTERS = [
  { id: "none", label: "Normal", emoji: "✨" },
  { id: "grayscale", label: "B&W", emoji: "⚫" },
  { id: "sepia", label: "Sepia", emoji: "🟤" },
  { id: "vintage", label: "Vintage", emoji: "📼" },
  { id: "warm", label: "Warm", emoji: "🌅" },
  { id: "cool", label: "Cool", emoji: "❄️" },
  { id: "invert", label: "Invert", emoji: "🔄" },
  { id: "noir", label: "Noir", emoji: "🎬" },
];

function MiniAvatar({ src, username, size = 18 }) {
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
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.55 }}>{letter}</Text>
    </View>
  );
}

function formatCount(num) {
  const n = Number(num) || 0;
  if (n < 1000) return `${n}`;
  const format = (value, suffix) => {
    const rounded = Math.floor(value * 10) / 10;
    const str = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
    return `${str}${suffix}`;
  };
  if (n < 1_000_000) return format(n / 1000, "k");
  if (n < 1_000_000_000) return format(n / 1_000_000, "m");
  return format(n / 1_000_000_000, "b");
}

// ── Owns liveComments + floatingEmojis entirely by itself. The host
// screen used to hold this state directly, so every chat comment AND
// every "X joined/left the live" system message (fired from deep
// inside the WebRTC signaling code in startLive) re-rendered the
// WHOLE screen — camera preview, RTCView, everything. Those signaling
// handlers can't just move into a child component (they close over
// peerConnections/localStreamRef), so instead the parent keeps doing
// the real work and calls these imperative methods via ref instead of
// setState — only this small subtree re-renders per event now.
const LiveCommentsFeed = React.memo(
  forwardRef(function LiveCommentsFeed({ showComments }, ref) {
    const [liveComments, setLiveComments] = useState([]);
    const [floatingEmojis, setFloatingEmojis] = useState([]);
    const scrollRef = useRef(null);

    useImperativeHandle(ref, () => ({
      pushComment: (payload) => {
        setLiveComments((prev) => [...prev.slice(-49), payload]);
      },
      pushReaction: (emojiChar) => {
        const id = Date.now() + Math.random();
        setFloatingEmojis((prev) => [...prev.slice(-6), { id, emoji: emojiChar }]);
        setTimeout(() => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)), 2200);
      },
      reset: () => {
        setLiveComments([]);
        setFloatingEmojis([]);
      },
    }), []);

    return (
      <>
        <View style={S.floatZone} pointerEvents="none">
          {floatingEmojis.map((e) => (
            <FloatingEmoji key={e.id} emoji={e.emoji} />
          ))}
        </View>
        {showComments && liveComments.length > 0 && (
          <ScrollView ref={scrollRef} style={S.commentsFeed} pointerEvents="none">
            {liveComments.map((c, i) =>
              c.system ? (
                <View key={i} style={S.systemBubble}>
                  <MiniAvatar src={c.profilePic} username={c.username} size={16} />
                  <Text style={S.systemText}>
                    {c.username} {c.text}
                  </Text>
                </View>
              ) : (
                <View key={i} style={S.commentBubble}>
                  <Text style={S.commentUser}>{c.username}</Text>
                  <Text style={S.commentText}>{c.text}</Text>
                </View>
              )
            )}
          </ScrollView>
        )}
      </>
    );
  })
);

function CreateStory() {
  const navigation = useNavigation();

  const { hasPermission: hasCamPermission, requestPermission: requestCamPermission } = useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } = useMicrophonePermission();

  const [facingMode, setFacingMode] = useState("back");
  const device = useCameraDevice(facingMode);
  const photoOutput = usePhotoOutput();

  const recordTimerRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const formatTimer = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const startRecording = async () => {
    if (isRecording) return;
    const { VideoRecorderModule } = NativeModules;
    setIsRecording(true); // drops isActive on <Camera> below, freeing camera0 for Camera2
    setRecordSeconds(0);
    await new Promise((r) => setTimeout(r, 250)); // let VisionCamera's session actually close first
    try {
      const filePath = await VideoRecorderModule.startRecording(0, facingMode === "back");
      console.log("Recording started, will save to:", filePath);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e) {
      console.error("Start recording failed:", e);
      setError("Couldn't start recording.");
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    const { VideoRecorderModule } = NativeModules;
    clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    try {
      const finishedPath = await VideoRecorderModule.stopRecording();
      console.log("Recording finished:", finishedPath);
      setIsRecording(false);
      setRecordSeconds(0);
      stopCamera();
      navigation.navigate("StoryPreview", {
        file: { uri: `file://${finishedPath}`, type: "video/mp4", name: "story-video.mp4" },
        filter: activeFilter,
      });
    } catch (e) {
      console.error("Stop recording failed:", e);
      setError("Failed to save recording.");
      setIsRecording(false);
      setRecordSeconds(0);
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const cameraRef = useRef(null);
  const peerConnections = useRef({});
  const iceBuffersRef = useRef({});
  const liveStoryIdRef = useRef(null);
  const viewerIdsRef = useRef(new Set());
  const localStreamRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState("");
  const [isLive, setIsLive] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [liveViewers, setLiveViewers] = useState(0);
  const [liveLikes, setLiveLikes] = useState(0);
  const [liveRoomId, setLiveRoomId] = useState(null);
  const commentsFeedRef = useRef(null);
  const [comment, setComment] = useState("");
  const [showComments, setShowComments] = useState(true);
  const [liveStreamURL, setLiveStreamURL] = useState(null);

  const [activeFilter, setActiveFilter] = useState("none");
  const [segmenterReady, setSegmenterReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (!hasCamPermission) await requestCamPermission();
      if (!hasMicPermission) await requestMicPermission();
    })();
  }, []);

  const handleSelectFilter = (id) => {
    setActiveFilter(id);
  };

  const startCamera = async () => {
    setError("");
    if (!hasCamPermission) {
      const granted = await requestCamPermission();
      if (!granted) {
        Alert.alert(
          "Camera access needed",
          "Please enable camera permission in Settings to record a story.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        setError("Camera access denied. Please allow camera permission.");
        return;
      }
    }
    setCameraActive(true);
  };

  const stopCamera = () => {
    setCameraActive(false);
  };

  const flipCamera = () => {
    setFacingMode((prev) => (prev === "back" ? "front" : "back"));
  };

  const checkSizeOrReject = (sizeBytes, type) => {
    const limit = type === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (sizeBytes > limit) {
      setError(`That ${type} is too large. Max size is ${type === "video" ? "20MB" : "10MB"}.`);
      return false;
    }
    return true;
  };

  const filterShotRef = useRef(null);
  const [filterJob, setFilterJob] = useState(null);

  const applyFilterToPhoto = (uri, filterId, width, height) => {
    const matrix = FILTER_MATRICES[filterId];
    if (!matrix || matrix === IDENTITY_MATRIX) return Promise.resolve(uri);
    return new Promise((resolve) => {
      setFilterJob({ uri, matrix, width, height, resolve });
    });
  };

  const handleFilterJobImageReady = async () => {
    if (!filterJob || !filterShotRef.current) return;
    try {
      const capturedUri = await filterShotRef.current.capture();
      filterJob.resolve(capturedUri);
    } catch (e) {
      console.error("Filter capture failed:", e);
      filterJob.resolve(filterJob.uri);
    } finally {
      setFilterJob(null);
    }
  };

  const capturePhoto = async () => {
    if (!photoOutput) return;
    try {
      const { filePath } = await photoOutput.capturePhotoToFile({}, {});
      const rawUri = `file://${filePath}`;
      let finalUri = rawUri;
            if (activeFilter !== "none") {
        const { width, height } = await new Promise((resolve) => {
          Image.getSize(
            rawUri,
            (w, h) => resolve({ width: w, height: h }),
            () => resolve({ width: 1080, height: 1920 })
          );
        });
        finalUri = await applyFilterToPhoto(rawUri, activeFilter, width, height);
      }
      stopCamera();
      navigation.navigate("StoryPreview", {
        file: { uri: finalUri, type: "image/jpeg", name: "story-photo.jpg" },
        filter: activeFilter,
      });
    } catch (e) {
      console.error("Photo capture error:", e);
      setError("Failed to capture photo.");
    }
  };

  useEffect(() => {
    if (!isLive || !liveStoryIdRef.current) return;
    const storyId = liveStoryIdRef.current;
    const onComment = (payload) => {
      commentsFeedRef.current?.pushComment(payload);
      if (LIVE_REACTIONS.includes(payload.text)) {
        commentsFeedRef.current?.pushReaction(payload.text);
      }
    };
    const onLikes = ({ likesCount }) => {
      if (typeof likesCount === "number") setLiveLikes(likesCount);
    };
    socket.on(`story:${storyId}:comment`, onComment);
    socket.on(`story:${storyId}:likes`, onLikes);
    return () => {
      socket.off(`story:${storyId}:comment`, onComment);
      socket.off(`story:${storyId}:likes`, onLikes);
    };
  }, [isLive]);

  useEffect(() => {
    (async () => {
      const user = await getCachedUser();
      const userId = user?._id || user?.id;
      if (userId) socket.emit("register", userId);
    })();
  }, []);

  const startLive = async () => {
    setError("");
    setIsGoingLive(true); // drops isActive on <Camera> below immediately, ahead of the getUserMedia() open
    await new Promise((r) => setTimeout(r, 250)); // let VisionCamera's session actually close first
    try {
      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: facingMode === "front" ? "user" : "environment" },
        audio: true,
      });
      localStreamRef.current = stream;
      setLiveStreamURL(stream.toURL());
    } catch {
      setError("Camera/mic access denied for live.");
      setIsGoingLive(false);
      return;
    }
    const user = await getCachedUser();
    const roomId = `live_${user._id || user.id}`;

    try {
      const res = await apiFetch(`${API}/stories/live/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Could not start live story");
      liveStoryIdRef.current = data.story._id;
    } catch (err) {
      setError("Couldn't start live story: " + err.message);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLiveStreamURL(null);
      setIsGoingLive(false);
      return;
    }

    setLiveRoomId(roomId);
    setIsLive(true);
    setIsGoingLive(false);
    commentsFeedRef.current?.reset();
    setLiveLikes(0);
    viewerIdsRef.current = new Set();
    setLiveViewers(0);

    try {
      const vres = await apiFetch(`${API}/stories/viewers/${liveStoryIdRef.current}`);
      const vdata = await vres.json();
      if (vdata.success) setLiveLikes(vdata.likesCount ?? 0);
    } catch {}

    socket.emit("startLive", {
      roomId,
      hostId: user._id || user.id,
      username: user.username,
      storyId: liveStoryIdRef.current,
    });

    socket.on("viewerJoined", async ({ viewerId, username, profilePic }) => {
      if (viewerIdsRef.current.has(viewerId)) return;
      viewerIdsRef.current.add(viewerId);
      setLiveViewers(viewerIdsRef.current.size);
      commentsFeedRef.current?.pushComment({ system: true, username: username || "Someone", profilePic, text: "joined the live" });
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      peerConnections.current[viewerId] = pc;
      localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("iceCandidate", { to: viewerId, candidate });
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("liveOffer", { to: viewerId, offer });
    });

    socket.on("liveAnswer", async ({ from, answer }) => {
      const pc = peerConnections.current[from];
      if (pc && pc.signalingState === "have-local-offer") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          const buffered = iceBuffersRef.current[from] || [];
          for (const c of buffered) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
              console.error("Host buffered ICE error:", e);
            }
          }
          iceBuffersRef.current[from] = [];
        } catch (e) {
          console.error("Host setRemoteDesc error:", e);
        }
      }
    });

    socket.on("iceCandidate", async ({ from, candidate }) => {
      const pc = peerConnections.current[from];
      if (!pc || !candidate) return;
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Host ICE error:", e);
        }
      } else {
        iceBuffersRef.current[from] = [...(iceBuffersRef.current[from] || []), candidate];
      }
    });

    socket.on("viewerLeft", ({ viewerId, username, profilePic }) => {
      peerConnections.current[viewerId]?.close();
      delete peerConnections.current[viewerId];
      delete iceBuffersRef.current[viewerId];
      viewerIdsRef.current.delete(viewerId);
      setLiveViewers(viewerIdsRef.current.size);
      commentsFeedRef.current?.pushComment({ system: true, username: username || "Someone", profilePic, text: "left the live" });
    });
  };

  const stopLive = async () => {
    socket.emit("endLive", { roomId: liveRoomId });
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
    iceBuffersRef.current = {};
    viewerIdsRef.current = new Set();
    socket.off("viewerJoined");
    socket.off("liveAnswer");
    socket.off("iceCandidate");
    socket.off("viewerLeft");
    if (liveStoryIdRef.current) {
      socket.off(`story:${liveStoryIdRef.current}:comment`);
      socket.off(`story:${liveStoryIdRef.current}:likes`);
      try {
        await apiFetch(`${API}/stories/live/${liveStoryIdRef.current}/end`, {
          method: "DELETE",
        });
      } catch (err) {
        console.error("Failed to clean up live story:", err);
      }
      liveStoryIdRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLiveStreamURL(null);
    setIsLive(false);
    setLiveViewers(0);
    setLiveLikes(0);
    setLiveRoomId(null);
    commentsFeedRef.current?.reset();
    stopCamera();
  };

  const sendComment = async () => {
    if (!comment.trim() || !liveStoryIdRef.current) return;
    const user = await getCachedUser();
    socket.emit("storyComment", {
      storyId: liveStoryIdRef.current,
      userId: user._id || user.id,
      username: user.username,
      text: comment,
    });
    setComment("");
  };

  const handleGalleryPick = async () => {
    // ← CHANGED — selectionLimit 1 → 0 (react-native-image-picker treats 0
    // as "no limit") so a user can multi-select any mix of images and
    // videos from the gallery in one go, matching the web version's
    // <input multiple>. Each asset is validated against its own size
    // limit; a rejected asset is skipped rather than blocking the rest.
    const result = await launchImageLibrary({ mediaType: "mixed", selectionLimit: 0, quality: 0.9 });
    if (result.didCancel || !result.assets?.length) return;

    const files = [];
    for (const asset of result.assets) {
      const type = (asset.type || "").startsWith("video") ? "video" : "image";
      if (!checkSizeOrReject(asset.fileSize || 0, type)) continue;
      files.push({ uri: asset.uri, type: asset.type, name: asset.fileName || `story.${type === "video" ? "mp4" : "jpg"}` });
    }
    if (files.length === 0) return;

    stopCamera();
    navigation.navigate("StoryPreview", { files, filter: "none" });
  };

  const isLiveRef = useRef(false);
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (isLiveRef.current) stopLive();
      clearInterval(recordTimerRef.current);
    };
  }, []);

  const handleShutter = () => {
    if (!cameraActive) {
      startCamera();
      return;
    }
    if (isRecording) return; // recording has its own button now
    capturePhoto();
  };

  const previewTint = FILTER_PREVIEW_TINTS[activeFilter];

  return (
    <View style={S.wrapper}>
      <View style={S.topBar}>
        <TouchableOpacity
          style={S.roundBtn}
          onPress={() => {
            if (isLive) stopLive();
            stopCamera();
            navigation.goBack();
          }}
        >
          <FeatherIcon name="x" size={18} color="#fff" />
        </TouchableOpacity>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          {isLive ? (
            <>
              <View style={S.livePulse} />
              <Text style={S.topTitle}>LIVE · {formatCount(liveViewers)} watching</Text>
            </>
          ) : (
            <Text style={S.topTitle}>Your Story</Text>
          )}
        </View>

        {isLive ? (
          <TouchableOpacity style={S.roundBtn} onPress={() => setShowComments((v) => !v)}>
            <FeatherIcon name={showComments ? "message-circle" : "volume-x"} size={16} color="#fff" />
          </TouchableOpacity>
        ) : cameraActive ? (
          <TouchableOpacity style={S.roundBtn} onPress={flipCamera}>
            <FeatherIcon name="refresh-cw" size={16} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <View style={S.cameraArea}>
        {isLive && liveStreamURL ? (
          <RTCView streamURL={liveStreamURL} style={S.video} objectFit="cover" />
        ) : isRecording ? (
          // Fed by VideoRecorderModule's own Camera2 session (see
          // VideoRecorderPreviewView.kt) — genuinely live, and safe
          // because VisionCamera is inactive below while this is shown,
          // so only one client ever holds the camera device at a time.
          <VideoRecorderPreview style={S.video} />
        ) : cameraActive && device ? (
          <>
            <Camera
              ref={cameraRef}
              style={S.video}
              device={device}
              isActive={cameraActive && !isLive && !isGoingLive && !isRecording}
              outputs={[photoOutput]}
            />
            {!!previewTint && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: previewTint.color,
                    opacity: previewTint.opacity,
                  },
                ]}
              />
            )}
          </>
        ) : null}

        {isRecording && (
          <View style={S.recIndicator}>
            <View style={S.recDot} />
            <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "700" }}>
              REC {formatTimer(recordSeconds)}
            </Text>
          </View>
        )}

        {!cameraActive && !isLive && (
          <View style={S.placeholder}>
            {error ? (
              <>
                <View style={S.placeholderIconWrap}>
                  <FeatherIcon name="x" size={26} color="#ff3b30" />
                </View>
                <Text style={S.errorText}>{error}</Text>
              </>
            ) : (
              <>
                <View style={S.placeholderIconWrap}>
                  <Icon name="camera" size={26} color={GOLDEN} />
                </View>
                <Text style={S.placeholderText}>Tap the shutter to start your camera</Text>
              </>
            )}
          </View>
        )}

        {cameraActive && !isLive && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.filterStrip}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.id}
                onPress={() => handleSelectFilter(f.id)}
                style={[S.filterChip, activeFilter === f.id && S.filterChipActive]}
              >
                <Text style={{ fontSize: 20 }}>{f.emoji}</Text>
                <Text style={S.filterLabel}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {isLive && (
          <>
            <View style={S.viewersBadge}>
              <FeatherIcon name="eye" size={13} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "600" }}>{formatCount(liveViewers)} watching</Text>
            </View>
            <View style={S.likesBadge}>
              <Icon name="heart" solid size={13} color="#ff5f6d" />
              <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "600" }}>{formatCount(liveLikes)}</Text>
            </View>
            <LiveCommentsFeed ref={commentsFeedRef} showComments={showComments} />
          </>
        )}

        {!!error && cameraActive && (
          <View style={S.errorBanner}>
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center" }}>{error}</Text>
          </View>
        )}

        {filterJob && (
          <View style={S.offscreen} pointerEvents="none">
            <ViewShot
              ref={filterShotRef}
              options={{ format: "jpg", quality: 0.92, width: filterJob.width, height: filterJob.height }}
              style={{ width: filterJob.width, height: filterJob.height }}
            >
              <ColorMatrix matrix={filterJob.matrix}>
                <Image
                  source={{ uri: filterJob.uri }}
                  style={{ width: filterJob.width, height: filterJob.height }}
                  resizeMode="cover"
                  onLoadEnd={handleFilterJobImageReady}
                />
              </ColorMatrix>
            </ViewShot>
          </View>
        )}
      </View>

      {isLive ? (
        <View style={S.liveBottom}>
          <TextInput
            value={comment}
            onChangeText={setComment}
            onSubmitEditing={sendComment}
            placeholder="Say something to viewers…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={S.liveInput}
          />
          <TouchableOpacity onPress={sendComment} disabled={!comment.trim()} style={[S.sendBtn, { opacity: comment.trim() ? 1 : 0.4 }]}>
            <FeatherIcon name="send" size={16} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={stopLive} style={S.endLiveButton}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>End Live</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={S.bottomPanel}>
          <TouchableOpacity style={S.actionItem} onPress={handleGalleryPick}>
            <View style={S.iconBtn}>
              <FeatherIcon name="image" size={20} color="#fff" />
            </View>
            <Text style={S.actionLabel}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.actionItem} onPress={handleShutter}>
            <View style={S.shutterRing}>
              <View
                style={[
                  S.shutterInner,
                  { backgroundColor: cameraActive ? "#fff" : "rgba(255,255,255,0.35)" },
                ]}
              />
            </View>
            <Text style={S.actionLabel}>{cameraActive ? "Capture" : "Camera"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.actionItem} onPress={startLive}>
            <View style={[S.iconBtn, S.liveBtnStyle]}>
              <View style={S.liveDot} />
            </View>
            <Text style={S.actionLabel}>Go Live</Text>
          </TouchableOpacity>

          {cameraActive && (
            <TouchableOpacity style={S.actionItem} onPress={toggleRecording}>
              <View
                style={[
                  S.iconBtn,
                  {
                    borderWidth: 1.5,
                    borderColor: "#ff3b30",
                    backgroundColor: isRecording ? "rgba(255,59,48,0.28)" : "rgba(255,59,48,0.12)",
                  },
                ]}
              >
                <Icon name="circle" solid size={14} color="#ff3b30" />
              </View>
              <Text style={S.actionLabel}>{isRecording ? "Stop" : "Record Video"}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function FloatingEmoji({ emoji }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -140, duration: 2000, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.Text style={{ fontSize: 26, transform: [{ translateY }], opacity }}>{emoji}</Animated.Text>
  );
}

export default CreateStory;

const S = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#000" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, paddingHorizontal: 18, zIndex: 10 },
  topTitle: { color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  roundBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  cameraArea: { flex: 1, backgroundColor: "#050505", position: "relative", overflow: "hidden" },
  video: { width: "100%", height: "100%" },
  placeholder: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 14 },
  placeholderIconWrap: { width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  placeholderText: { color: "rgba(255,255,255,0.45)", fontSize: 13.5, textAlign: "center", paddingHorizontal: 40 },
  errorText: { color: "#ff6259", fontSize: 13.5, textAlign: "center", paddingHorizontal: 30, fontWeight: "600" },
  errorBanner: { position: "absolute", bottom: 16, left: 16, right: 16, backgroundColor: "rgba(255,59,48,0.92)", padding: 12, borderRadius: 12, zIndex: 10 },
  viewersBadge: { position: "absolute", top: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, zIndex: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  likesBadge: { position: "absolute", top: 58, right: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, zIndex: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  floatZone: { position: "absolute", bottom: 80, right: 16, zIndex: 12, flexDirection: "column-reverse", gap: 6 },
  commentsFeed: { position: "absolute", bottom: 80, left: 12, right: 70, zIndex: 9, maxHeight: 200 },
  commentBubble: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", gap: 6, alignItems: "baseline", maxWidth: "88%", alignSelf: "flex-start", marginBottom: 6 },
  commentUser: { color: GOLDEN, fontSize: 11.5, fontWeight: "700" },
  commentText: { color: "#fff", fontSize: 13 },
  systemBubble: { backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "center", maxWidth: "88%", flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  systemText: { color: "rgba(255,255,255,0.65)", fontSize: 11.5, fontStyle: "italic" },
  liveBottom: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32, backgroundColor: "rgba(10,10,10,0.9)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  liveInput: { flex: 1, backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: 24, paddingHorizontal: 16, paddingVertical: 11, color: "#fff", fontSize: 14 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: GOLDEN, alignItems: "center", justifyContent: "center" },
  endLiveButton: { backgroundColor: "#ff3b30", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11 },
  bottomPanel: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingBottom: 36, paddingTop: 22 },
  actionItem: { alignItems: "center", gap: 9 },
  iconBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  liveBtnStyle: { backgroundColor: "rgba(255,59,48,0.16)", borderWidth: 1.5, borderColor: "#ff3b30" },
  liveDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#ff3b30" },
  shutterRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: GOLDEN, alignItems: "center", justifyContent: "center" },
  shutterRingRec: { borderColor: "#ff3b30" },
  shutterInner: { width: 58, height: 58, borderRadius: 29 },
  actionLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11.5, fontWeight: "600" },
  recIndicator: { position: "absolute", top: 16, left: 16, backgroundColor: "#ff3b30", paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 6, zIndex: 10 },
  recDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#fff" },
  livePulse: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#ff3b30" },
  filterStrip: { position: "absolute", bottom: 12, left: 0, right: 0, flexGrow: 0, paddingHorizontal: 16, zIndex: 9 },
  filterChip: { alignItems: "center", gap: 3, minWidth: 56, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(0,0,0,0.45)", marginRight: 10 },
  filterChipActive: { borderWidth: 1.5, borderColor: GOLDEN, backgroundColor: "rgba(234,182,118,0.22)" },
  filterLabel: { color: "#fff", fontSize: 10.5, fontWeight: "600" },
  offscreen: { position: "absolute", top: -10000, left: -10000 },
});