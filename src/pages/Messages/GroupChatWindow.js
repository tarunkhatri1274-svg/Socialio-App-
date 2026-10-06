import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Image,
  ImageBackground,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Linking,
  FlatList,
  BackHandler,
  Dimensions,
    Platform,
  PermissionsAndroid,
  Switch,
} from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";
import { fetchWallpaper, saveWallpaper, uploadWallpaperPhoto, clearWallpaperOnServer } from "./WallpaperAPI"; // adjust path to where you place the file
import Video from "react-native-video";
import { useNavigation } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import RNFS from "@dr.pogodin/react-native-fs";
import { pick, types, isErrorWithCode, errorCodes } from "@react-native-documents/picker";
import AudioRecorderPlayer from "react-native-nitro-sound"
import Config from "react-native-config";
import { apiFetch as authApiFetch } from "../../api/authToken";
import Svg, { Path, Line, Circle, Polyline, Polygon, Rect, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";
import socket from "../../sockets/Sockets";
import { SharedPostBubble, ForwardModal, getShareCaption } from "./SharePostBubble";
import { ChatBubbleSkeleton } from "../../components/Skeleton/Skeleton";

const API = Config.API_URL;
const GOLDEN = "rgb(234,182,118)";
const CLOUDINARY_URL = Config.CLOUDINARY_URL;
const apiFetch = async (url, options = {}) => {
  // Uses the shared apiFetch from authToken.js so an expired token is
  // refreshed automatically on a 401 instead of just throwing.
  const res = await authApiFetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const isTempMsgId = (id) => typeof id === "string" && id.startsWith("temp-");

/* ─── Icons ─── */
const BackArrow = ({ color = "#333", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M19 12H5M12 5l-7 7 7 7" />
  </Svg>
);
const SendIcon = ({ color = "#fff", size = 18 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Line x1="22" y1="2" x2="11" y2="13" /><Polygon points="22 2 15 22 11 13 2 9 22 2" />
  </Svg>
);
const DotsIcon = ({ color = "#333", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill={color} width={size} height={size}>
    <Circle cx="5" cy="12" r="2" /><Circle cx="12" cy="12" r="2" /><Circle cx="19" cy="12" r="2" />
  </Svg>
);
const CloseIcon = ({ color = "#333", size = 16 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" width={size} height={size}>
    <Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);
const CrownIcon = () => (
  <Svg viewBox="0 0 24 24" fill={GOLDEN} width="13" height="13"><Path d="M2 20h20l-2-9-5 4-3-7-3 7-5-4z" /></Svg>
);
const PlusIcon = ({ color = "#555", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" width={size} height={size}>
    <Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);
const ImageIcon = ({ color = "#3498db", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Rect x="3" y="3" width="18" height="18" rx="2" /><Circle cx="8.5" cy="8.5" r="1.5" /><Polyline points="21 15 16 10 5 21" />
  </Svg>
);
const VideoFileIcon = ({ color = "#e74c3c", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polygon points="23 7 16 12 23 17 23 7" /><Rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </Svg>
);
const FileIcon = ({ color = "#9b59b6", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Polyline points="14 2 14 8 20 8" />
  </Svg>
);
const AudioIcon = ({ color = "#2ecc71", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Rect x="9" y="2" width="6" height="11" rx="3" /><Path d="M19 10a7 7 0 0 1-14 0" /><Line x1="12" y1="19" x2="12" y2="23" /><Line x1="8" y1="23" x2="16" y2="23" />
  </Svg>
);
const StopIcon = ({ color = "#fff", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill={color} width={size} height={size}><Rect x="4" y="4" width="16" height="16" rx="2" /></Svg>
);
const PlayTriangleIcon = ({ color = "#fff", size = 14 }) => (
  <Svg viewBox="0 0 24 24" width={size} height={size}><Polygon points="6,4 20,12 6,20" fill={color} /></Svg>
);
const PauseIcon = ({ color = "#fff", size = 14 }) => (
  <Svg viewBox="0 0 24 24" width={size} height={size}><Rect x="5" y="4" width="5" height="16" fill={color} /><Rect x="14" y="4" width="5" height="16" fill={color} /></Svg>
);
const DownloadIcon = ({ color = "#54656f", size = 16 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><Polyline points="7 10 12 15 17 10" /><Line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);
const EditIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </Svg>
);
const TrashIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polyline points="3 6 5 6 21 6" /><Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><Path d="M10 11v6M14 11v6" /><Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
);
const HeartIcon = ({ filled, color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill={filled ? color : "none"} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </Svg>
);
const ReplyIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polyline points="9 14 4 9 9 4" /><Path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </Svg>
);
const ForwardIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polyline points="15 10 20 15 15 20" /><Path d="M4 4v7a4 4 0 0 0 4 4h12" />
  </Svg>
);
const SearchIcon = ({ color = "#bbb", size = 18 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Circle cx="11" cy="11" r="8" /><Line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);
const UserPlusIcon = ({ color = GOLDEN, size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="8.5" cy="7" r="4" /><Line x1="20" y1="8" x2="20" y2="14" /><Line x1="17" y1="11" x2="23" y2="11" />
  </Svg>
);

const PollIcon = ({ color = "#f39c12", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Line x1="6" y1="20" x2="6" y2="11" /><Line x1="12" y1="20" x2="12" y2="4" /><Line x1="18" y1="20" x2="18" y2="14" />
  </Svg>
);
const CheckIcon = ({ color = "#fff", size = 12 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polyline points="20 6 9 17 4 12" />
  </Svg>
);

const COLORS = ["#e74c3c", "#e67e22", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c", "#e91e63", "#ff5722"];
const getColor = (str) => COLORS[(str?.charCodeAt(0) || 0) % COLORS.length];
const getInitials = (name) => name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";

function Avatar({ user, size = 42 }) {
  const pic = user?.profilePic;
  if (pic) return <Image source={{ uri: pic }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: getColor(user?.username), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontWeight: "700", color: "#fff", fontSize: size * 0.38 }}>{getInitials(user?.username)}</Text>
    </View>
  );
}

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function GroupAvatarStack({ members, size = 42 }) {
  const list = (members || []).map(m => m.user || m).filter(Boolean);
  const count = list.length;

  const tile = (user, style, key) => {
    const pic = user?.profilePic;
    return (
      <View key={key} style={[{ position: "absolute", overflow: "hidden", backgroundColor: getColor(user?.username), alignItems: "center", justifyContent: "center" }, style]}>
        {pic
          ? <Image source={{ uri: pic }} style={{ width: "100%", height: "100%" }} />
          : <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.24 }}>{getInitials(user?.username)}</Text>}
      </View>
    );
  };

  const wrap = { position: "relative", width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: "#ececec" };

  if (count === 0) return <View style={wrap} />;
  if (count === 1) return <View style={wrap}>{tile(list[0], { top: 0, left: 0, width: "100%", height: "100%" }, 0)}</View>;
  if (count === 2) {
    return (
      <View style={wrap}>
        {tile(list[0], { top: 0, left: 0, width: "50%", height: "100%" }, 0)}
        {tile(list[1], { top: 0, left: "50%", width: "50%", height: "100%" }, 1)}
      </View>
    );
  }
  const [top, bl, br] = list;
  return (
    <View style={wrap}>
      {tile(top, { top: 0, left: "25%", width: "50%", height: "52%" }, 0)}
      {tile(bl, { bottom: 0, left: 0, width: "50%", height: "48%" }, 1)}
      {tile(br, { bottom: 0, left: "50%", width: "50%", height: "48%" }, 2)}
    </View>
  );
}

function SystemMessage({ msg }) {
  const fmt = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={{ alignItems: "center", marginVertical: 10 }}>
      <View style={{ backgroundColor: "#ececec", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, color: "#888" }}>{msg.text}</Text>
      </View>
      <Text style={{ fontSize: 10, color: "#bbb", marginTop: 3 }}>{fmt(msg.createdAt)}</Text>
    </View>
  );
}

/* ─── Media bubbles — styled to match the web version ─── */
// The bubble wrapping this content is capped at maxWidth:"78%" of the
// screen (see mStyles.row below) with 14px horizontal padding inside
// it. A hardcoded pixel width here previously exceeded that on
// narrower phones, pushing the pill past the bubble's rounded edge.
// Size it off the real screen width instead so it always fits.
const { width: __SCREEN_W } = Dimensions.get("window");
const MEDIA_CARD_W = Math.max(160, Math.min(200, __SCREEN_W * 0.78 - 60));

const mediaStyles = StyleSheet.create({
  audioPill: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, borderRadius: 12, paddingVertical: 8, paddingLeft: 8, paddingRight: 12, width: MEDIA_CARD_W },
  micBadge: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  audioControls: { flex: 1, minWidth: 0, height: 32, borderRadius: 16, backgroundColor: "#f1f3f4", flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 6, gap: 5 },
  audioTime: { fontSize: 9.5, color: "#5f6368", width: 26, textAlign: "right" },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, borderRadius: 10, padding: 10, width: MEDIA_CARD_W, borderWidth: 1 },
  fileBadgeWrap: { width: 42, height: 48 },
  fileExt: { position: "absolute", left: 4, right: 4, bottom: 8, textAlign: "center", fontSize: 8.5, fontWeight: "800", letterSpacing: 0.2 },
  fileName: { fontSize: 13, fontWeight: "600" },
  fileMeta: { fontSize: 11.5, marginTop: 2 },
  downloadCircle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});

function AudioBubble({ url, fromMe }) {
  const playerRef = useRef(AudioRecorderPlayer).current;
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    return () => {
      try { Promise.resolve(playerRef.stopPlayer()).catch(() => {}); } catch {}
      try { playerRef.removePlayBackListener(); } catch {}
    };
  }, []);

  const fmt = (ms) => {
    const sec = Math.floor((ms || 0) / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  const togglePlay = async () => {
    if (playing) {
      await playerRef.pausePlayer();
      setPlaying(false);
      return;
    }
    if (position === 0 || position >= duration) {
      await playerRef.startPlayer(url);
      playerRef.addPlayBackListener((e) => {
        setPosition(e.currentPosition);
        setDuration(e.duration);
        if (e.currentPosition >= e.duration && e.duration > 0) {
          playerRef.stopPlayer();
          setPlaying(false);
          setPosition(0);
        }
      });
    } else {
      await playerRef.resumePlayer();
    }
    setPlaying(true);
  };

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  return (
    <View style={[mediaStyles.audioPill, { backgroundColor: fromMe ? "rgba(255,255,255,0.15)" : "#f0f2f5" }]}>
      <View style={[mediaStyles.micBadge, { backgroundColor: fromMe ? "rgba(255,255,255,0.25)" : GOLDEN }]}>
        <AudioIcon color="#fff" size={20} />
      </View>
      <View style={mediaStyles.audioControls}>
        <TouchableOpacity onPress={togglePlay} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {playing ? <PauseIcon color="#3c4043" size={12} /> : <PlayTriangleIcon color="#3c4043" size={12} />}
        </TouchableOpacity>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: "#d0d3d6" }}>
          <View style={{ height: 3, borderRadius: 2, width: `${progress * 100}%`, backgroundColor: "#5f6368" }} />
        </View>
        <Text style={mediaStyles.audioTime}>{fmt(playing || position > 0 ? position : duration)}</Text>
      </View>
    </View>
  );
}

function FileBadge({ ext, fromMe }) {
  return (
    <View style={mediaStyles.fileBadgeWrap}>
      <Svg viewBox="0 0 42 48" width={42} height={48}>
        <Path d="M4 2h24l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill={fromMe ? "rgba(255,255,255,0.9)" : "#e5322d"} />
        <Path d="M28 2l10 10H30a2 2 0 0 1-2-2V2z" fill={fromMe ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.35)"} />
      </Svg>
      <Text style={[mediaStyles.fileExt, { color: fromMe ? "#e5322d" : "#fff" }]} numberOfLines={1}>{ext}</Text>
    </View>
  );
}
const MIME_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  rtf: "application/rtf",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  apk: "application/vnd.android.package-archive",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
async function downloadFileToDevice(url, fileName) {
  try {
    // Only Android 9 and below needs the storage permission.
    // Android 10+ saves through MediaStore, which needs no permission.
    if (Platform.OS === "android" && Platform.Version <= 28) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        { title: "Storage permission", message: "Allow access to save this file.", buttonPositive: "Allow" }
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert("Permission needed", "Storage access is required to save this file.");
        return;
      }
    }

    const safeName = (fileName || "download").replace(/[\\/:*?"<>|]/g, "_");
    const ext = (safeName.split(".").pop() || "").toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const { dirs } = ReactNativeBlobUtil.fs;

    // 1) Download into the app's own cache (always writable)
    const tmpPath = `${dirs.CacheDir}/${Date.now()}_${safeName}`;
    const res = await ReactNativeBlobUtil.config({ fileCache: true, path: tmpPath }).fetch("GET", url);
    const status = res.info().status;
    if (status < 200 || status >= 300) throw new Error(`Server returned ${status}`);

    // 2) Copy into the public Downloads folder
    if (Platform.OS === "android") {
      if (ReactNativeBlobUtil.MediaCollection?.copyToMediaStore) {
        await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          { name: safeName, parentFolder: "", mimeType: mime },
          "Download",
          tmpPath
        );
      } else {
        // fallback for older react-native-blob-util versions
        const dest = `${dirs.DownloadDir}/${safeName}`;
        await ReactNativeBlobUtil.fs.cp(tmpPath, dest);
        await ReactNativeBlobUtil.android.addCompleteDownload({
          title: safeName, description: "Downloaded", mime, path: dest, showNotification: true,
        });
      }
      ReactNativeBlobUtil.fs.unlink(tmpPath).catch(() => {});
      Alert.alert("Saved", `${safeName} saved to Downloads.`);
    } else {
      ReactNativeBlobUtil.ios.previewDocument(tmpPath);
    }
  } catch (err) {
    console.log("[download] failed:", err);
    Alert.alert("Download failed", err?.message || "Something went wrong while saving this file.");
  }
}

/* ─── Video bubble (web-style controls + download) ─── */
const VIDEO_W = MEDIA_CARD_W + 20;
const VIDEO_H = Math.round(VIDEO_W * 0.8);
const SPEEDS = [1, 1.5, 2, 0.5];
const fmtVideoTime = (sec) => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const vStyles = StyleSheet.create({
  wrap: { width: VIDEO_W, height: VIDEO_H, marginBottom: 6, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  bigPlay: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", paddingLeft: 3 },
  dlBtn: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, backgroundColor: "rgba(0,0,0,0.5)" },
  time: { color: "#fff", fontSize: 10.5, minWidth: 62 },
  track: { flex: 1, height: 24, justifyContent: "center" },
  trackBg: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)" },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: "#fff" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 8, paddingBottom: 24 },
  menuItem: { paddingHorizontal: 24, paddingVertical: 15 },
  menuText: { fontSize: 15, color: "#111" },
});

function VideoBubble({ media }) {
  const ref = useRef(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [trackW, setTrackW] = useState(1);
  const [downloading, setDownloading] = useState(false);

  // while the message is still uploading, url is a local file:// uri
  const canDownload = /^https?:/i.test(media.url);
  let fileName = media.fileName || media.url?.split("/").pop()?.split("?")[0] || "video";
  if (!/\.[a-z0-9]{2,4}$/i.test(fileName)) fileName += ".mp4";

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    await downloadFileToDevice(media.url, fileName);
    setDownloading(false);
  };

  const seekTo = (x) => {
    if (!duration) return;
    const t = Math.min(Math.max(x / trackW, 0), 1) * duration;
    ref.current?.seek(t);
    setCurrent(t);
  };

  const nextSpeed = () => setRate(r => SPEEDS[(SPEEDS.indexOf(r) + 1) % SPEEDS.length]);
  const progress = duration > 0 ? Math.min(current / duration, 1) : 0;

  return (
    <View style={vStyles.wrap}>
      <Video
        ref={ref}
        source={{ uri: media.url }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        paused={paused}
        muted={muted}
        rate={rate}
        controls={fullscreen}
        fullscreen={fullscreen}
        progressUpdateInterval={250}
        onLoad={(e) => setDuration(e.duration || 0)}
        onProgress={(e) => setCurrent(e.currentTime || 0)}
        onEnd={() => { setPaused(true); ref.current?.seek(0); setCurrent(0); }}
        onFullscreenPlayerWillDismiss={() => setFullscreen(false)}
      />

      {/* tap video = play / pause */}
      <TouchableOpacity activeOpacity={1} style={vStyles.center} onPress={() => setPaused(p => !p)}>
        {paused && <View style={vStyles.bigPlay}><PlayTriangleIcon color="#fff" size={22} /></View>}
      </TouchableOpacity>

      {/* download button, top-right */}
      {canDownload && (
        <TouchableOpacity style={vStyles.dlBtn} onPress={handleDownload} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          {downloading ? <ActivityIndicator size="small" color="#fff" /> : <DownloadIcon color="#fff" size={16} />}
        </TouchableOpacity>
      )}

      {/* bottom control bar */}
      <View style={vStyles.bar}>
        <TouchableOpacity onPress={() => setPaused(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {paused ? <PlayTriangleIcon color="#fff" size={14} /> : <PauseIcon color="#fff" size={14} />}
        </TouchableOpacity>
        <Text style={vStyles.time}>{fmtVideoTime(current)} / {fmtVideoTime(duration)}</Text>
        <TouchableOpacity
          activeOpacity={1}
          style={vStyles.track}
          onLayout={(e) => setTrackW(e.nativeEvent.layout.width || 1)}
          onPress={(e) => seekTo(e.nativeEvent.locationX)}
        >
          <View style={vStyles.trackBg}>
            <View style={[vStyles.trackFill, { width: `${progress * 100}%` }]} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <DotsIcon color="#fff" size={18} />
        </TouchableOpacity>
      </View>

      {/* options menu — same items as the web version */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={vStyles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={vStyles.menuSheet}>
            <TouchableOpacity style={vStyles.menuItem} onPress={() => { setMenuOpen(false); setPaused(false); setFullscreen(true); }}>
              <Text style={vStyles.menuText}>Fullscreen</Text>
            </TouchableOpacity>
            {canDownload && (
              <TouchableOpacity style={vStyles.menuItem} onPress={() => { setMenuOpen(false); handleDownload(); }}>
                <Text style={vStyles.menuText}>Download</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={vStyles.menuItem} onPress={() => { setMuted(m => !m); setMenuOpen(false); }}>
              <Text style={vStyles.menuText}>{muted ? "Unmute" : "Mute"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={vStyles.menuItem} onPress={nextSpeed}>
              <Text style={vStyles.menuText}>Playback speed · {rate}x</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
function MediaPreview({ media, fromMe }) {
  if (!media?.url) return null;

  if (media.mediaType === "video") {
    return <VideoBubble media={media} />;
  }

  if (media.mediaType === "audio") {
    return <AudioBubble url={media.url} fromMe={fromMe} />;
  }

  const fileName = media.fileName || media.url?.split("/").pop()?.split("?")[0] || "Document";
  const ext = fileName.includes(".") ? fileName.split(".").pop().toUpperCase() : "FILE";
  const sizeLabel = formatFileSize(media.fileSize);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => downloadFileToDevice(media.url, fileName)}
      style={[mediaStyles.fileCard, {
        backgroundColor: fromMe ? "rgba(255,255,255,0.12)" : "#fff",
        borderColor: fromMe ? "rgba(255,255,255,0.2)" : "#ececec",
      }]}
    >
      <FileBadge ext={ext} fromMe={fromMe} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[mediaStyles.fileName, { color: fromMe ? "#fff" : "#111" }]} numberOfLines={1}>{fileName}</Text>
        <Text style={[mediaStyles.fileMeta, { color: fromMe ? "rgba(255,255,255,0.7)" : "#8b98a3" }]}>
          {ext}{sizeLabel ? ` · ${sizeLabel}` : " Document"}
        </Text>
      </View>
      <View style={[mediaStyles.downloadCircle, { backgroundColor: fromMe ? "rgba(255,255,255,0.22)" : "#f0f2f5" }]}>
        <DownloadIcon color={fromMe ? "#fff" : "#54656f"} />
      </View>
    </TouchableOpacity>
  );
}

/* ─── Attach Menu ─── */
function AttachMenu({ onClose, onMediaSent, onOptimisticAdd, onUploadFailed, onPoll, chatId, currentUserId }) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(AudioRecorderPlayer).current;

  const startRecording = async () => {
    try {
      await recorderRef.startRecorder();
      setRecording(true);
    } catch (e) {
      console.error("startRecorder failed", e);
    }
  };

  const stopRecording = async () => {
    try {
      const uri = await recorderRef.stopRecorder();
      setRecording(false);
      uploadAndSend({ uri, name: `voice_${Date.now()}.m4a`, type: "audio/m4a" }, "audio");
    } catch (e) {
      console.error("stopRecorder failed", e);
      setRecording(false);
    }
  };

  const uploadAndSend = async (fileAsset, mediaType) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onOptimisticAdd({
      _id: tempId,
      chatId,
      user: { _id: currentUserId },
      text: "",
      media: { url: fileAsset.uri, mediaType, fileName: fileAsset.fileName || fileAsset.name, fileSize: fileAsset.fileSize || fileAsset.size },
      createdAt: new Date().toISOString(),
      sending: true,
    });
    onClose();

    try {
      const formData = new FormData();
      formData.append("file", {
        uri: fileAsset.uri,
        name: fileAsset.fileName || fileAsset.name || "upload",
        type: fileAsset.type || "application/octet-stream",
      });
      formData.append("mediaType", mediaType);
      formData.append("fileName", fileAsset.fileName || fileAsset.name || "upload");

      const res = await authApiFetch(`${API}/messages/upload`, {
        method: "POST",
        body: formData
      });
      const uploadData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(uploadData?.message || "Upload failed");

      const url = uploadData.url || uploadData.secure_url;
      const msgData = await apiFetch(`${API}/groups/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          text: "",
          media: {
            url,
            mediaType,
            fileName: uploadData.fileName || fileAsset.fileName || fileAsset.name,
            fileSize: uploadData.fileSize || fileAsset.fileSize || fileAsset.size,
          },
        }),
      });
      onMediaSent(msgData, tempId);
    } catch (err) {
      console.error("Upload failed", err);
      onUploadFailed(tempId);
    }
  };

  const pickImage = async () => {
    const result = await launchImageLibrary({ mediaType: "photo" });
    if (result.didCancel || !result.assets?.length) return;
    uploadAndSend(result.assets[0], "image");
  };

  const pickVideo = async () => {
    const result = await launchImageLibrary({ mediaType: "video" });
    if (result.didCancel || !result.assets?.length) return;
    uploadAndSend(result.assets[0], "video");
  };

  const pickFile = async () => {
    try {
      const [res] = await pick({ type: [types.allFiles] });
      uploadAndSend(res, "file");
    } catch (err) {
      if (!(isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED)) {
        console.error(err);
      }
    }
  };

  return (
    <View style={s.attachMenu}>
      <TouchableOpacity style={s.attachOption} onPress={pickImage}>
        <View style={[s.attachOptionIcon, { backgroundColor: "#3498db18" }]}><ImageIcon /></View>
        <Text style={s.attachOptionLabel}>Photo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.attachOption} onPress={pickVideo}>
        <View style={[s.attachOptionIcon, { backgroundColor: "#e74c3c18" }]}><VideoFileIcon /></View>
        <Text style={s.attachOptionLabel}>Video</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.attachOption} onPress={pickFile}>
        <View style={[s.attachOptionIcon, { backgroundColor: "#9b59b618" }]}><FileIcon /></View>
        <Text style={s.attachOptionLabel}>File</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.attachOption} onPress={recording ? stopRecording : startRecording}>
        <View style={[s.attachOptionIcon, { backgroundColor: recording ? "#e5393522" : "#2ecc7118" }]}>
          {recording ? <StopIcon color="#e53935" /> : <AudioIcon />}
        </View>
        <Text style={s.attachOptionLabel}>{recording ? "Stop" : "Record"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.attachOption} onPress={() => { onClose(); onPoll?.(); }}>
        <View style={[s.attachOptionIcon, { backgroundColor: "#f39c1218" }]}><PollIcon /></View>
        <Text style={s.attachOptionLabel}>Poll</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ─── Poll (WhatsApp-style) ─── */
const POLL_W = Math.max(210, Math.min(270, __SCREEN_W * 0.78 - 28));
const pollVoterId = (v) => String(v?._id || v);
const countPollVoters = (options) =>
  new Set((options || []).flatMap((o) => (o.votes || []).map(pollVoterId))).size;

const pollStyles = StyleSheet.create({
  wrap: { width: POLL_W },
  question: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  hint: { fontSize: 12, marginTop: 3, marginBottom: 12 },
  optRow: { marginBottom: 12 },
  optTop: { flexDirection: "row", alignItems: "center" },
  circle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 10 },
  optText: { flex: 1, fontSize: 14 },
  optCount: { fontSize: 12, fontWeight: "700", marginLeft: 8 },
  track: { height: 5, borderRadius: 3, marginTop: 6, marginLeft: 30, overflow: "hidden" },
  bar: { height: 5, borderRadius: 3 },
  divider: { height: 1, marginTop: 2, marginBottom: 6 },
  viewVotes: { alignItems: "center", paddingVertical: 4 },
  viewVotesText: { fontSize: 13, fontWeight: "700" },
  // voters sheet
  voterOptHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#f7f7f7" },
  voterOptTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111" },
  voterOptCount: { fontSize: 12, fontWeight: "600", color: "#888", marginLeft: 8 },
  voterRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  voterName: { flex: 1, marginLeft: 12, fontSize: 14, color: "#111", fontWeight: "500" },
  noVotes: { paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, color: "#aaa", fontStyle: "italic" },
  // create sheet
  label: { fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: "#f2f2f2", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: "#111" },
  optInputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  addOptBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingVertical: 4 },
  sendPollBtn: { backgroundColor: GOLDEN, borderRadius: 24, paddingVertical: 13, alignItems: "center" },
});

function PollVotersSheet({ poll, members, currentUserId, onClose }) {
  const userMap = new Map((members || []).map((m) => [String(m.user?._id || m.user), m.user]));
  const options = poll.options || [];
  const total = countPollVoters(options);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.infoSheet} onPress={() => {}}>
          <View style={s.infoHeader}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.infoHeaderTitle} numberOfLines={2}>{poll.question}</Text>
              <Text style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                {total} {total === 1 ? "vote" : "votes"}
              </Text>
            </View>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {options.map((o) => {
              const voters = (o.votes || []).map((v) => {
                const id = pollVoterId(v);
                return userMap.get(id) || { _id: id, username: "Former member" };
              });
              return (
                <View key={String(o._id)}>
                  <View style={pollStyles.voterOptHeader}>
                    <Text style={pollStyles.voterOptTitle}>{o.text}</Text>
                    <Text style={pollStyles.voterOptCount}>{voters.length} {voters.length === 1 ? "vote" : "votes"}</Text>
                  </View>
                  {voters.length === 0 ? (
                    <Text style={pollStyles.noVotes}>No votes</Text>
                  ) : (
                    voters.map((u) => (
                      <View key={String(u._id)} style={pollStyles.voterRow}>
                        <Avatar user={u} size={34} />
                        <Text style={pollStyles.voterName}>
                          {u.username}{String(u._id) === String(currentUserId) ? " (You)" : ""}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              );
            })}
            <View style={{ height: 24 }} />
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function PollBubble({ poll, fromMe, currentUserId, members, onVote, disabled }) {
  const [showVoters, setShowVoters] = useState(false);
  const me = String(currentUserId);
  const options = poll.options || [];
  const totalVoters = countPollVoters(options);
  const myChoices = options
    .filter((o) => (o.votes || []).some((v) => pollVoterId(v) === me))
    .map((o) => String(o._id));

  const toggle = (optId) => {
    if (disabled) return;
    const id = String(optId);
    let next;
    if (poll.allowMultiple) {
      next = myChoices.includes(id) ? myChoices.filter((x) => x !== id) : [...myChoices, id];
    } else {
      next = myChoices.includes(id) ? [] : [id];
    }
    onVote(next);
  };

  const fg = fromMe ? "#fff" : "#111";
  const sub = fromMe ? "rgba(255,255,255,0.8)" : "#888";
  const track = fromMe ? "rgba(255,255,255,0.35)" : "#ececec";
  const fill = fromMe ? "#fff" : GOLDEN;

  return (
    <View style={pollStyles.wrap}>
      <Text style={[pollStyles.question, { color: fg }]}>{poll.question}</Text>
      <Text style={[pollStyles.hint, { color: sub }]}>
        {poll.allowMultiple ? "Select one or more" : "Select one"}
      </Text>

      {options.map((o) => {
        const id = String(o._id);
        const count = o.votes?.length || 0;
        const mine = myChoices.includes(id);
        const pct = totalVoters ? (count / totalVoters) * 100 : 0;
        return (
          <TouchableOpacity key={id} activeOpacity={0.7} style={pollStyles.optRow} onPress={() => toggle(id)} disabled={disabled}>
            <View style={pollStyles.optTop}>
              <View style={[pollStyles.circle, { borderColor: mine ? fill : sub }, mine && { backgroundColor: fill }]}>
                {mine && <CheckIcon color={fromMe ? GOLDEN : "#fff"} />}
              </View>
              <Text style={[pollStyles.optText, { color: fg }]}>{o.text}</Text>
              <Text style={[pollStyles.optCount, { color: fg }]}>{count}</Text>
            </View>
            <View style={[pollStyles.track, { backgroundColor: track }]}>
              <View style={[pollStyles.bar, { width: `${pct}%`, backgroundColor: fill }]} />
            </View>
          </TouchableOpacity>
        );
      })}

      <View style={[pollStyles.divider, { backgroundColor: track }]} />
      <TouchableOpacity style={pollStyles.viewVotes} onPress={() => setShowVoters(true)} disabled={totalVoters === 0}>
        <Text style={[pollStyles.viewVotesText, { color: fromMe ? "#fff" : GOLDEN, opacity: totalVoters ? 1 : 0.6 }]}>
          {totalVoters ? `View votes (${totalVoters})` : "No votes yet"}
        </Text>
      </TouchableOpacity>

      {showVoters && (
        <PollVotersSheet poll={poll} members={members} currentUserId={currentUserId} onClose={() => setShowVoters(false)} />
      )}
    </View>
  );
}

function CreatePollSheet({ onClose, onCreate }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const cleaned = options.map((o) => o.trim()).filter(Boolean);
  const canSend = question.trim().length > 0 && new Set(cleaned).size >= 2 && !submitting;

  const setOpt = (i, v) => setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOpt = () => setOptions((prev) => (prev.length >= 12 ? prev : [...prev, ""]));
  const removeOpt = (i) => setOptions((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      await onCreate({ question: question.trim(), options: cleaned, allowMultiple });
      // parent closes the sheet on success
    } catch (err) {
      console.error("Create poll failed", err);
      Alert.alert("Couldn't create poll", "Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.infoSheet} onPress={() => {}}>
          <View style={s.infoHeader}>
            <Text style={s.infoHeaderTitle}>Create poll</Text>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={pollStyles.label}>Question</Text>
            <TextInput
              style={pollStyles.input}
              placeholder="Ask a question"
              placeholderTextColor="#999"
              value={question}
              onChangeText={setQuestion}
              maxLength={250}
              multiline
            />

            <Text style={pollStyles.label}>Options</Text>
            {options.map((o, i) => (
              <View key={i} style={pollStyles.optInputRow}>
                <TextInput
                  style={[pollStyles.input, { flex: 1 }]}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor="#999"
                  value={o}
                  onChangeText={(v) => setOpt(i, v)}
                  maxLength={100}
                />
                {options.length > 2 && (
                  <TouchableOpacity style={s.iconBtn} onPress={() => removeOpt(i)}><CloseIcon color="#e53935" /></TouchableOpacity>
                )}
              </View>
            ))}
            {options.length < 12 && (
              <TouchableOpacity style={pollStyles.addOptBtn} onPress={addOpt}>
                <PlusIcon color={GOLDEN} />
                <Text style={{ color: GOLDEN, fontWeight: "700", fontSize: 14 }}>Add option</Text>
              </TouchableOpacity>
            )}

            <View style={pollStyles.switchRow}>
              <Text style={{ fontSize: 14, color: "#111", fontWeight: "600" }}>Allow multiple answers</Text>
              <Switch
                value={allowMultiple}
                onValueChange={setAllowMultiple}
                trackColor={{ false: "#ddd", true: "rgba(234,182,118,0.6)" }}
                thumbColor={allowMultiple ? GOLDEN : "#f4f4f4"}
              />
            </View>
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
            <TouchableOpacity style={[pollStyles.sendPollBtn, { opacity: canSend ? 1 : 0.45 }]} onPress={submit} disabled={!canSend}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Send poll</Text>}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Group message bubble ─── */
function GroupMessageBubble({ msg, fromMe, currentUser, members, onDelete, onEdit, onReply, onForward, onVote }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.text || "");
  const [liked, setLiked] = useState(msg.likes?.some(id => id?.toString() === currentUser._id?.toString()) || false);
  const [likeCount, setLikeCount] = useState(msg.likes?.length || 0);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const fmt = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isTemp = isTempMsgId(msg._id);

  useEffect(() => {
    setLiked(msg.likes?.some(id => id?.toString() === currentUser._id?.toString()) || false);
    setLikeCount(msg.likes?.length || 0);
  }, [msg.likes, currentUser._id]);

  const handleDeleteForMe = async () => {
    setShowDeleteSheet(false);
    if (isTemp) { onDelete(msg._id); return; }
    try {
      await authApiFetch(`${API}/groups/messages/${msg._id}`, {
        method: "DELETE",
        body: JSON.stringify({ chatId: msg.chatId, forEveryone: false })
      });
      onDelete(msg._id);
    } catch (err) { console.error("Delete failed", err); }
  };

  const handleDeleteForEveryone = async () => {
    setShowDeleteSheet(false);
    if (isTemp) { onDelete(msg._id); return; }
    try {
      await authApiFetch(`${API}/groups/messages/${msg._id}`, {
        method: "DELETE",
        body: JSON.stringify({ chatId: msg.chatId, forEveryone: true })
      });
      onDelete(msg._id);
    } catch (err) { console.error("Delete for everyone failed", err); }
  };

  const handleEdit = async () => {
    if (!editText.trim()) return;
    try {
      await apiFetch(`${API}/groups/messages/${msg._id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText, chatId: msg.chatId }),
      });
      onEdit(msg._id, editText);
      setEditing(false);
    } catch (err) { console.error("Edit failed", err); }
  };

  const handleLike = async () => {
    const was = liked;
    setLiked(!was);
    setLikeCount(c => was ? c - 1 : c + 1);
    try {
      await apiFetch(`${API}/groups/messages/like/${msg._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: msg.chatId }),
      });
    } catch {
      setLiked(was);
      setLikeCount(c => was ? c + 1 : c - 1);
    }
  };

  const isEditable = !msg.poll && !msg.media?.url && !msg.sharedPost?.postId && !msg.sharedPost?.storyId && !msg.sending;

  if (msg.deletedForEveryone) {
    return (
      <View style={[messageStyles.wrap, { alignItems: fromMe ? "flex-end" : "flex-start" }]}>
        <View style={[messageStyles.row, { flexDirection: fromMe ? "row-reverse" : "row" }]}>
          {!fromMe && <Avatar user={msg.user} size={28} />}
          <View style={messageStyles.deletedBubble}>
            <TrashIcon />
            <Text style={{ fontSize: 13, color: "#999", fontStyle: "italic", marginLeft: 6 }}>
              {fromMe ? "You deleted this message" : "This message was deleted"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      {showDeleteSheet && (
        <DeleteMessageSheet
          canDeleteForEveryone={fromMe && !isTemp}
          onDeleteForMe={handleDeleteForMe}
          onDeleteForEveryone={handleDeleteForEveryone}
          onClose={() => setShowDeleteSheet(false)}
        />
      )}

      <View style={[messageStyles.wrap, { alignItems: fromMe ? "flex-end" : "flex-start" }]}>
        <View style={[messageStyles.row, { flexDirection: fromMe ? "row-reverse" : "row" }]}>
          {!fromMe && <Avatar user={msg.user} size={28} />}
          <View>
            {!fromMe && <Text style={messageStyles.senderName}>{msg.user?.username}</Text>}

            {editing ? (
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <TextInput
                  value={editText}
                  onChangeText={setEditText}
                  onSubmitEditing={handleEdit}
                  style={[s.chatInput, { paddingVertical: 7, paddingHorizontal: 12, fontSize: 13, minWidth: 160, flex: 1 }]}
                  autoFocus
                />
                <TouchableOpacity onPress={handleEdit} style={s.sendCircleBtn}><SendIcon /></TouchableOpacity>
              </View>
            ) : (
              <View>
                <View style={[
                  messageStyles.bubble,
                  {
                    backgroundColor: fromMe ? "rgba(234,182,118,0.92)" : "#fff",
                    borderBottomRightRadius: fromMe ? 4 : 18,
                    borderBottomLeftRadius: fromMe ? 18 : 4,
                    opacity: msg.sending ? 0.75 : 1,
                  },
                  msg.failed && messageStyles.bubbleFailed,
                ]}>
                  {msg.replyTo && (
                    <View style={[messageStyles.replyQuote, { borderLeftColor: fromMe ? "rgba(255,255,255,0.6)" : GOLDEN, backgroundColor: fromMe ? "rgba(0,0,0,0.1)" : "#fff8ee" }]}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: fromMe ? "rgba(255,255,255,0.9)" : GOLDEN }}>{msg.replyTo?.user?.username}</Text>
                      <Text style={{ fontSize: 12, opacity: 0.75, marginTop: 1 }} numberOfLines={1}>{msg.replyTo?.text}</Text>
                    </View>
                  )}
                  {msg.isForwarded && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 4 }}>
                      <ForwardIcon size={10} color={fromMe ? "#fff" : "#555"} />
                      <Text style={{ fontSize: 10, opacity: 0.6, color: fromMe ? "#fff" : "#111" }}>Forwarded</Text>
                    </View>
                  )}
                  {(msg.sharedPost?.postId || msg.sharedPost?.storyId) && (
                    <>
                      <Text style={{ fontSize: 12, fontStyle: "italic", fontWeight: "600", marginBottom: 6, color: fromMe ? "rgba(255,255,255,0.75)" : "#8e8e8e" }}>
                        {getShareCaption(msg, fromMe, null)}
                      </Text>
                      <SharedPostBubble sharedPost={msg.sharedPost} fromMe={fromMe} />
                    </>
                  )}

                  {msg.media?.url && (
                    <View>
                      <MediaPreview media={msg.media} fromMe={fromMe} />
                      {msg.sending && (
                        <View style={messageStyles.uploadOverlay}>
                          <ActivityIndicator color="#fff" size="small" />
                        </View>
                      )}
                    </View>
                  )}
                  {!msg.media?.url && msg.mediaExpired && (
                    <View style={[messageStyles.expiredMedia, { backgroundColor: fromMe ? "rgba(255,255,255,0.15)" : "#f0f2f5" }]}>
                      <Text style={{ fontSize: 12, fontStyle: "italic", color: fromMe ? "rgba(255,255,255,0.8)" : "#888" }}>⏱️ Media expired after 3 days</Text>
                    </View>
                  )}
                  {msg.poll && (
                    <PollBubble
                      poll={msg.poll}
                      fromMe={fromMe}
                      currentUserId={currentUser._id}
                      members={members}
                      onVote={onVote}
                      disabled={!!msg.sending}
                    />
                  )}
                  {!!msg.text && !msg.poll && !msg.sharedPost?.postId && !msg.sharedPost?.storyId && (
                    <Text style={{ fontSize: 14, lineHeight: 20, color: fromMe ? "#fff" : "#111" }}>{msg.text}</Text>
                  )}
                  {msg.isEdited && <Text style={{ fontSize: 10, opacity: 0.55, marginLeft: 4 }}>· edited</Text>}
                </View>
                {likeCount > 0 && (
                  <View style={[messageStyles.likeBadge, fromMe ? { left: 8 } : { right: 8 }]}>
                    <Text style={{ fontSize: 11 }}>❤️ {likeCount}</Text>
                  </View>
                )}
              </View>
            )}

            {!editing && !msg.sending && (
              <View style={[messageStyles.actionsRow, { justifyContent: fromMe ? "flex-end" : "flex-start" }]}>
                <TouchableOpacity style={[messageStyles.actionBtn, liked && messageStyles.actionBtnLiked]} onPress={handleLike}>
                  <HeartIcon filled={liked} color={liked ? "#e53935" : "#555"} />
                </TouchableOpacity>
                <TouchableOpacity style={messageStyles.actionBtn} onPress={() => onReply(msg)}><ReplyIcon /></TouchableOpacity>
                {!msg.poll && (
                  <TouchableOpacity style={messageStyles.actionBtn} onPress={() => onForward(msg)}><ForwardIcon /></TouchableOpacity>
                )}
                {fromMe && isEditable && (
                  <TouchableOpacity style={messageStyles.actionBtn} onPress={() => { setEditing(true); setEditText(msg.text || ""); }}><EditIcon /></TouchableOpacity>
                )}
                <TouchableOpacity style={messageStyles.actionBtn} onPress={() => setShowDeleteSheet(true)}><TrashIcon color="#e53935" /></TouchableOpacity>
              </View>
            )}
          </View>
        </View>
        <Text style={[
          messageStyles.timeLabel,
          { color: msg.failed ? "#e53935" : "#aaa", fontWeight: msg.failed ? "600" : "400", marginTop: likeCount > 0 ? 18 : 3, marginRight: fromMe ? 4 : 0, marginLeft: fromMe ? 0 : 36 },
        ]}>
          {msg.sending ? "Sending…" : msg.failed ? "Failed to send" : fmt(msg.createdAt)}
        </Text>
      </View>
    </>
  );
}

/* ─── Add Member sheet ─── */
function AddMemberSheet({ chatId, existingMemberIds, onClose, onAdded }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(new Map());
  const [adding, setAdding] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`${API}/messages/search-users?q=${encodeURIComponent(search)}`);
        const users = (data.users || data.following || []).filter(u => !existingMemberIds.includes(u._id));
        setResults(users);
      } catch (err) { console.error(err); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [search, existingMemberIds]);

  const toggle = (user) => {
    setSelected(prev => {
      const next = new Map(prev);
      next.has(user._id) ? next.delete(user._id) : next.set(user._id, user);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0 || adding) return;
    setAdding(true);
    try {
      await apiFetch(`${API}/groups/${chatId}/add-members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberIds: Array.from(selected.keys()) }),
      });
      onAdded();
      onClose();
    } catch (err) {
      console.error("Add members failed", err);
      Alert.alert("Couldn't add members. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.infoSheet} onPress={() => {}}>
          <View style={s.infoHeader}>
            <Text style={s.infoHeaderTitle}>Add members</Text>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>

          {selected.size > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingTop: 10 }}>
              {Array.from(selected.values()).map((u) => (
                <TouchableOpacity key={u._id} style={s.chip} onPress={() => toggle(u)}>
                  <Avatar user={u} size={22} />
                  <Text style={s.chipText}>{u.username}</Text>
                  <CloseIcon size={12} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={s.searchWrap}>
            <SearchIcon />
            <TextInput style={s.searchInput} placeholder="Search people to add…" placeholderTextColor="#bbb" value={search} onChangeText={setSearch} autoFocus />
          </View>

          <ScrollView style={{ flex: 1 }}>
            {searching && <Text style={s.loadingText}>Searching…</Text>}
            {!searching && results.length === 0 && <Text style={s.loadingText}>{search ? "No users found." : "Start typing to find people."}</Text>}
            {!searching && results.map((u) => (
              <TouchableOpacity key={u._id} style={s.memberRow} onPress={() => toggle(u)}>
                <Avatar user={u} size={40} />
                <Text style={s.memberName}>{u.username}</Text>
                <View style={[s.checkbox, selected.has(u._id) && s.checkboxChecked]}>
                  {selected.has(u._id) && <Text style={s.checkboxCheck}>✓</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 }}>
            <TouchableOpacity style={[s.smallBtn, { opacity: selected.size > 0 && !adding ? 1 : 0.5 }]} disabled={selected.size === 0 || adding} onPress={handleAdd}>
              <Text style={s.smallBtnText}>{adding ? "Adding…" : `Add ${selected.size > 0 ? `(${selected.size})` : ""}`}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Group info / member management sheet ─── */
function GroupInfoSheet({ group, currentUser, onClose, onExit, onRemoveMember, onRename, onAddMember }) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(group.name);
  const navigation = useNavigation();
  const myEntry = group.members.find(m => (m.user?._id || m.user) === currentUser._id);
  const isAdmin = myEntry?.role === "admin";
  const accepted = group.members.filter(m => m.status === "accepted");

  const goToProfile = (userId) => {
    if (userId === currentUser._id) { navigation.navigate("Profile"); return; }
    navigation.navigate("UserProfile", { userId });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.infoSheet} onPress={() => {}}>
          <View style={s.infoHeader}>
            <Text style={s.infoHeaderTitle}>Group Info</Text>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>

          <View style={{ alignItems: "center", padding: 18 }}>
            <GroupAvatarStack members={accepted} size={72} />
            {renaming ? (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 14, width: "100%" }}>
                <TextInput value={newName} onChangeText={setNewName} style={s.renameInput} autoFocus />
                <TouchableOpacity style={s.smallBtn} onPress={() => { onRename(newName); setRenaming(false); }}>
                  <Text style={s.smallBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
                <Text style={s.groupNameText}>{group.name}</Text>
                {isAdmin && (
                  <TouchableOpacity onPress={() => setRenaming(true)}>
                    <Text style={s.linkBtnText}>Edit</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <Text style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{accepted.length} members</Text>

            <TouchableOpacity style={s.addMemberBtn} onPress={onAddMember}>
              <UserPlusIcon />
              <Text style={{ color: GOLDEN, fontWeight: "700", fontSize: 13 }}>Add members</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {accepted.map((m) => {
              const memberId = m.user._id;
              return (
                <View key={memberId} style={s.memberRow}>
                  <TouchableOpacity onPress={() => goToProfile(memberId)}>
                    <Avatar user={m.user} size={40} />
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 1, marginLeft: 12 }} onPress={() => goToProfile(memberId)}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: "#111" }}>{m.user.username}</Text>
                      {m.role === "admin" && <CrownIcon />}
                      {memberId === currentUser._id && <Text style={{ fontSize: 11, color: "#999" }}>(you)</Text>}
                    </View>
                  </TouchableOpacity>
                  {memberId !== currentUser._id && (
                    <TouchableOpacity style={s.removeBtn} onPress={() => onRemoveMember(memberId)}>
                      <Text style={{ color: "#e53935", fontSize: 12, fontWeight: "600" }}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 }}>
            <TouchableOpacity style={s.exitBtn} onPress={onExit}>
              <Text style={{ color: "#e53935", fontWeight: "700", fontSize: 14 }}>🚪 Exit Group</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Wallpaper picker ─── */
const WALLPAPER_OPTIONS = [
  // Solid colors
  { id: "cream",  label: "Cream",  type: "color", value: "#f6ecdf" },
  { id: "sage",   label: "Sage",   type: "color", value: "#e3ecdf" },
  { id: "sky",    label: "Sky",    type: "color", value: "#e3edf5" },
  { id: "blush",  label: "Blush",  type: "color", value: "#f5e3ea" },
  { id: "mint",   label: "Mint",   type: "color", value: "#e2f5ec" },
  { id: "peach",  label: "Peach",  type: "color", value: "#fce7d8" },
  { id: "lilac",  label: "Lilac",  type: "color", value: "#ece3f5" },

  // WhatsApp-style doodle wallpapers
  {
    id: "wa-light", label: "WhatsApp", type: "doodle", value: "#e5ddd5",
    icons: ["chat", "heart", "music", "camera", "star"], iconColor: "#7a746b", iconOpacity: 0.16, iconSize: 20, gap: 46,
  },
  {
    id: "wa-dark", label: "WA Dark", type: "doodle", value: "#0b141a",
    icons: ["chat", "heart", "music", "camera", "star"], iconColor: "#ffffff", iconOpacity: 0.10, iconSize: 20, gap: 46,
  },

  // Playful emoji patterns
  { id: "leaves",   label: "Leaves",   type: "emoji", value: "#eef7ee", sticker: "🍃", stickerOpacity: 0.30, stickerSize: 18, stickerGap: 42 },
  { id: "bubbles",  label: "Bubbles",  type: "emoji", value: "#eaf6ff", sticker: "🫧", stickerOpacity: 0.30, stickerSize: 18, stickerGap: 42 },
  { id: "confetti", label: "Confetti", type: "emoji", value: "#fffaf0", sticker: "🎉", stickerOpacity: 0.28, stickerSize: 18, stickerGap: 46 },
  { id: "stars",    label: "Stars",    type: "emoji", value: "#12122a", sticker: "✨", stickerOpacity: 0.35, stickerSize: 16, stickerGap: 40 },

  // Instagram-style gradients
  { id: "ig-classic", label: "Instagram", type: "gradient", value: ["#feda75", "#fa7e1e", "#d62976", "#962fbf", "#4f5bd5"] },
  { id: "ig-sunset",  label: "Sunset",    type: "gradient", value: ["#ff9a8b", "#ff6a88", "#ff99ac"] },
  { id: "ig-dusk",    label: "Dusk",      type: "gradient", value: ["#4f5bd5", "#962fbf", "#d62976"] },
];

function EmojiPattern({ sticker, opacity = 0.3, size = 18, gap = 42, width, height }) {
  const win = Dimensions.get("window");
  const w = width ?? win.width;
  const h = height ?? win.height;
  const cols = Math.ceil(w / gap) + 1;
  const rows = Math.ceil(h / gap) + 1;
  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offsetX = r % 2 === 0 ? 0 : gap / 2;
      items.push(
        <Text
          key={`${r}-${c}`}
          style={{ position: "absolute", left: c * gap + offsetX, top: r * gap, fontSize: size, opacity }}
        >
          {sticker}
        </Text>
      );
    }
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {items}
    </View>
  );
}

function DoodleIcon({ type, color, size }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24" };
  switch (type) {
    case "chat":
      return (
        <Svg {...common}>
          <Path d="M4 4h16v12H8l-4 4V4z" stroke={color} strokeWidth={1.4} fill="none" />
        </Svg>
      );
    case "heart":
      return (
        <Svg {...common}>
          <Path d="M12 20s-7-4.35-9.3-8.4C.9 8.4 2.7 5.2 6 5.2c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.3 0 5.1 3.2 3.3 6.4C19 15.65 12 20 12 20z" stroke={color} strokeWidth={1.4} fill="none" />
        </Svg>
      );
    case "music":
      return (
        <Svg {...common}>
          <Circle cx="6" cy="18" r="2.3" stroke={color} strokeWidth={1.4} fill="none" />
          <Circle cx="16" cy="16" r="2.3" stroke={color} strokeWidth={1.4} fill="none" />
          <Path d="M8.3 18V6l10-2v10" stroke={color} strokeWidth={1.4} fill="none" />
        </Svg>
      );
    case "camera":
      return (
        <Svg {...common}>
          <Rect x="3" y="7" width="18" height="13" rx="2" stroke={color} strokeWidth={1.4} fill="none" />
          <Circle cx="12" cy="13.5" r="3.3" stroke={color} strokeWidth={1.4} fill="none" />
          <Path d="M8 7l1.4-2h5.2L16 7" stroke={color} strokeWidth={1.4} fill="none" />
        </Svg>
      );
    case "star":
      return (
        <Svg {...common}>
          <Polygon points="12,3 14.7,9.2 21.5,9.8 16.4,14.3 17.9,21 12,17.3 6.1,21 7.6,14.3 2.5,9.8 9.3,9.2" stroke={color} strokeWidth={1.2} fill="none" />
        </Svg>
      );
    default:
      return null;
  }
}

function DoodlePattern({ icons = ["chat", "heart", "music", "camera", "star"], color = "#000", opacity = 0.12, size = 20, gap = 46, width, height }) {
  const win = Dimensions.get("window");
  const w = width ?? win.width;
  const h = height ?? win.height;
  const cols = Math.ceil(w / gap) + 1;
  const rows = Math.ceil(h / gap) + 1;
  const items = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offsetX = r % 2 === 0 ? 0 : gap / 2;
      const iconType = icons[idx % icons.length];
      idx++;
      items.push(
        <View key={`${r}-${c}`} style={{ position: "absolute", left: c * gap + offsetX, top: r * gap, opacity }}>
          <DoodleIcon type={iconType} color={color} size={size} />
        </View>
      );
    }
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {items}
    </View>
  );
}

function GradientBackground({ colors, id = "wallpaperGradient" }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          {colors.map((c, i) => (
            <Stop key={i} offset={`${(i / (colors.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function WallpaperSheet({ current, onClose, onSelect, onPickPhoto }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.wallpaperSheet} onPress={() => {}}>
          <View style={s.infoHeader}>
            <Text style={s.infoHeaderTitle}>Chat Wallpaper</Text>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <TouchableOpacity style={s.wallpaperGalleryBtn} onPress={() => { onPickPhoto(); onClose(); }}>
              <ImageIcon />
              <Text style={{ marginLeft: 10, fontWeight: "600", color: "#333" }}>Choose from gallery</Text>
            </TouchableOpacity>

            <Text style={s.wallpaperSectionLabel}>Wallpapers</Text>
            {/* ...rest of the sheet stays exactly the same */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
              <View style={{ alignItems: "center", width: 64 }}>
                <TouchableOpacity
                  onPress={() => { onSelect(null); onClose(); }}
                  style={[s.wallpaperSwatch, { backgroundColor: "#fff", borderWidth: !current ? 3 : 1, borderColor: !current ? GOLDEN : "#ddd" }]}
                >
                  <Text style={{ fontSize: 10, color: "#999" }}>Default</Text>
                </TouchableOpacity>
              </View>

              {WALLPAPER_OPTIONS.map((w) => {
                const isSelected = current?.id === w.id;
                return (
                  <View key={w.id} style={{ alignItems: "center", width: 64 }}>
                    <TouchableOpacity
                      onPress={() => {
                        onSelect({
                          id: w.id,
                          type: w.type,
                          value: w.value,
                          sticker: w.sticker,
                          stickerOpacity: w.stickerOpacity,
                          stickerSize: w.stickerSize,
                          stickerGap: w.stickerGap,
                          icons: w.icons,
                          iconColor: w.iconColor,
                          iconOpacity: w.iconOpacity,
                          iconSize: w.iconSize,
                          gap: w.gap,
                        });
                        onClose();
                      }}
                      style={[
                        s.wallpaperSwatch,
                        { backgroundColor: w.type === "gradient" ? undefined : w.value, borderWidth: isSelected ? 3 : 1, borderColor: isSelected ? GOLDEN : "#ddd", overflow: "hidden" },
                      ]}
                    >
                      {w.type === "gradient" && <GradientBackground colors={w.value} id={`swatch-${w.id}`} />}
                      {w.type === "emoji" && (
                        <EmojiPattern sticker={w.sticker} opacity={w.stickerOpacity} size={w.stickerSize * 0.8} gap={w.stickerGap * 0.55} width={64} height={64} />
                      )}
                      {w.type === "doodle" && (
                        <DoodlePattern icons={w.icons} color={w.iconColor} opacity={w.iconOpacity} size={w.iconSize * 0.7} gap={w.gap * 0.5} width={64} height={64} />
                      )}
                    </TouchableOpacity>
                    <Text style={{ fontSize: 10, color: "#999", marginTop: 4 }} numberOfLines={1}>{w.label}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function GroupChatWindow({ group: initialGroup, currentUser, onClose, onRequestHandled }) {
  const [group, setGroup] = useState(initialGroup);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [wallpaper, setWallpaper] = useState(null);
  const [showWallpaper, setShowWallpaper] = useState(false);
  const [showPollSheet, setShowPollSheet] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const chatId = group.chatId;
  const accepted = group.members?.filter(m => m.status === "accepted") || [];
  const existingMemberIds = (group.members || []).filter(m => m.status !== "declined").map(m => (m.user?._id || m.user));

  // FIX: same issue as ChatWindow in Message.js — this window is opened
  // via local state (openConv in Messages()), not a navigator push, so
  // the navigator doesn't know a group chat is "open". Android's
  // hardware back button was falling through to the navigator's own
  // default back behavior (jumping to a previous tab) instead of closing
  // this window back to the Messages inbox. Intercepting it here and
  // calling onClose() fixes that.
  useEffect(() => {
    const onBackPress = () => {
      onClose();
      return true;
    };
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const [groupData, msgs] = await Promise.all([
          apiFetch(`${API}/groups/${chatId}`),
          apiFetch(`${API}/groups/${chatId}/messages`),
        ]);
        if (cancelled) return;
        if (groupData.success) setGroup(groupData.group);
        setMessages(Array.isArray(msgs) ? msgs : []);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wp = await fetchWallpaper(chatId, true); // false in Message.js
      if (!cancelled) setWallpaper(wp);
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  const handleWallpaperSelect = async (val) => {
    setWallpaper(val);
    try {
      if (val) await saveWallpaper(chatId, true, val); // false in Message.js
      else await clearWallpaperOnServer(chatId, true); // false in Message.js
    } catch (err) {
      console.log("[Wallpaper] save failed:", err.message);
    }
  };

  const handleWallpaperPhoto = async () => {
    const result = await launchImageLibrary({ mediaType: "photo" });
    if (result.didCancel || !result.assets?.[0]) return;
    try {
      const data = await uploadWallpaperPhoto(chatId, true, result.assets[0]); // false in Message.js
      if (data.success) setWallpaper(data.wallpaper);
      else Alert.alert("Couldn't set wallpaper", data.message || "Please try again.");
    } catch (err) {
      console.log("[Wallpaper] upload failed:", err.message);
      Alert.alert("Couldn't set wallpaper", "Please try again.");
    }
  };

  useEffect(() => {
    const onReceive = ({ chatId: cId, message }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.some(m => m._id === message._id) ? prev : [...prev, message]);
    };
    const onJoined = ({ chatId: cId, message }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.some(m => m._id === message._id) ? prev : [...prev, message]);
      apiFetch(`${API}/groups/${chatId}`).then(d => d.success && setGroup(d.group)).catch(() => {});
    };
    const onLeft = ({ chatId: cId, message }) => {
      if (cId !== chatId) return;
      if (message) setMessages(prev => prev.some(m => m._id === message._id) ? prev : [...prev, message]);
      apiFetch(`${API}/groups/${chatId}`).then(d => d.success && setGroup(d.group)).catch(() => {});
    };
    const onRenamed = ({ chatId: cId, name, message }) => {
      if (cId !== chatId) return;
      setGroup(prev => ({ ...prev, name }));
      if (message) setMessages(prev => prev.some(m => m._id === message._id) ? prev : [...prev, message]);
    };
    const onRemoved = ({ chatId: cId, groupName }) => {
      if (cId !== chatId) return;
      Alert.alert(`You were removed from "${groupName}"`);
      onClose();
    };
    const onEdited = ({ chatId: cId, messageId, text }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, text, isEdited: true } : m));
    };
    const onDeletedForEveryone = ({ chatId: cId, messageId }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, deletedForEveryone: true, text: "", media: undefined, sharedPost: undefined } : m));
    };
    const onLiked = ({ chatId: cId, messageId, likes }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, likes } : m));
    };
    const onMediaExpired = ({ chatId: cId, messageId }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, media: undefined, mediaExpired: true } : m));
    };
    const onPurged = ({ chatId: cId, messageId }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.filter(m => m._id !== messageId));
    };

    const onPollUpdated = ({ chatId: cId, messageId, options }) => {
      if (cId !== chatId) return;
      setMessages(prev => prev.map(m => (m._id === messageId && m.poll ? { ...m, poll: { ...m.poll, options } } : m)));
    };

    socket.on("receiveGroupMessage", onReceive);
    socket.on("groupMemberJoined", onJoined);
    socket.on("groupMemberLeft", onLeft);
    socket.on("groupRenamed", onRenamed);
    socket.on("removedFromGroup", onRemoved);
    socket.on("groupMessageEdited", onEdited);
    socket.on("groupMessageDeletedForEveryone", onDeletedForEveryone);
    socket.on("groupMessageLiked", onLiked);
    socket.on("groupMediaExpired", onMediaExpired);
    socket.on("groupMessagePurged", onPurged);
    socket.on("groupPollUpdated", onPollUpdated);
    return () => {
      socket.off("receiveGroupMessage", onReceive);
      socket.off("groupMemberJoined", onJoined);
      socket.off("groupMemberLeft", onLeft);
      socket.off("groupRenamed", onRenamed);
      socket.off("removedFromGroup", onRemoved);
      socket.off("groupMessageEdited", onEdited);
      socket.off("groupMessageDeletedForEveryone", onDeletedForEveryone);
      socket.off("groupMessageLiked", onLiked);
      socket.off("groupMediaExpired", onMediaExpired);
      socket.off("groupMessagePurged", onPurged);
      socket.off("groupPollUpdated", onPollUpdated);
    };
  }, [chatId, onClose]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const currentReply = replyTo;
    setReplyTo(null);
    try {
      const data = await apiFetch(`${API}/groups/messages/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, text, replyTo: currentReply?._id || null }),
      });
      setMessages(prev => prev.some(m => m._id === data._id) ? prev : [...prev, data]);
    } catch (err) { console.error("Send failed", err); }
  };

  const handleOptimisticAdd = (msg) => setMessages(prev => [...prev, msg]);

  const handleMediaSent = (msg, tempId) => {
    setMessages(prev => prev.map(m => m._id === tempId ? msg : m));
  };

  const handleUploadFailed = (tempId) => {
    setMessages(prev => prev.map(m => m._id === tempId ? { ...m, sending: false, failed: true } : m));
  };

  const handleDelete = (msgId) => setMessages(prev => prev.filter(m => m._id !== msgId));
  const handleEdit = (msgId, text) => setMessages(prev => prev.map(m => m._id === msgId ? { ...m, text, isEdited: true } : m));

  const handleCreatePoll = async ({ question, options, allowMultiple }) => {
    const data = await apiFetch(`${API}/groups/messages/poll`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, question, options, allowMultiple }),
    });
    setMessages(prev => prev.some(m => m._id === data._id) ? prev : [...prev, data]);
    setShowPollSheet(false);
  };

  // optionIds = this user's FULL selection after the tap ([] = remove vote)
  const handleVote = async (msg, optionIds) => {
    const me = String(currentUser._id);
    const prevOptions = msg.poll.options;
    const applyOptions = (opts) =>
      setMessages(prev => prev.map(m => (m._id === msg._id ? { ...m, poll: { ...m.poll, options: opts } } : m)));

    // optimistic update
    applyOptions(prevOptions.map(o => {
      const without = (o.votes || []).filter(v => String(v?._id || v) !== me);
      return { ...o, votes: optionIds.includes(String(o._id)) ? [...without, me] : without };
    }));

    try {
      const data = await apiFetch(`${API}/groups/messages/poll/${msg._id}/vote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionIds }),
      });
      if (data?.options) applyOptions(data.options);
    } catch (err) {
      console.error("Vote failed", err);
      applyOptions(prevOptions); // roll back
    }
  };

  const handleExit = () => {
    Alert.alert("Leave group", `Leave "${group.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave", style: "destructive",
        onPress: async () => {
          try {
            await apiFetch(`${API}/groups/${chatId}/exit`, { method: "POST" });
            setShowInfo(false);
            onRequestHandled?.(chatId);
            onClose();
          } catch (err) { console.error(err); }
        },
      },
    ]);
  };

  const handleRemoveMember = async (memberId) => {
    try {
      await apiFetch(`${API}/groups/${chatId}/remove-member`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      const d = await apiFetch(`${API}/groups/${chatId}`);
      if (d.success) setGroup(d.group);
    } catch (err) {
      console.error(err);
      Alert.alert("Couldn't remove member.");
    }
  };

  const handleRename = async (name) => {
    try {
      await apiFetch(`${API}/groups/${chatId}/rename`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch (err) { console.error(err); }
  };

  const refreshGroup = () => {
    apiFetch(`${API}/groups/${chatId}`).then(d => d.success && setGroup(d.group)).catch(() => {});
  };

  return (
    <View style={s.chatOverlay}>
      {showInfo && (
        <GroupInfoSheet
          group={group}
          currentUser={currentUser}
          onClose={() => setShowInfo(false)}
          onExit={handleExit}
          onRemoveMember={handleRemoveMember}
          onRename={handleRename}
          onAddMember={() => { setShowInfo(false); setShowAddMember(true); }}
        />
      )}
      {showAddMember && (
        <AddMemberSheet chatId={chatId} existingMemberIds={existingMemberIds} onClose={() => setShowAddMember(false)} onAdded={refreshGroup} />
      )}
      {forwardMsg && <ForwardModal msg={forwardMsg} currentUser={currentUser} onClose={() => setForwardMsg(null)} />}
      {showPollSheet && <CreatePollSheet onClose={() => setShowPollSheet(false)} onCreate={handleCreatePoll} />}
      {showWallpaper && (
        <WallpaperSheet current={wallpaper} onClose={() => setShowWallpaper(false)} onSelect={handleWallpaperSelect} onPickPhoto={handleWallpaperPhoto} />
      )}

      <View style={s.topbar}>
        <TouchableOpacity style={s.iconBtn} onPress={onClose}><BackArrow /></TouchableOpacity>
        <TouchableOpacity onPress={() => setShowInfo(true)} style={{ flexDirection: "row", alignItems: "center" }}>
          <GroupAvatarStack members={accepted} size={38} />
          <View style={{ marginLeft: 10 }}>
            <Text style={s.name}>{group.name}</Text>
            <Text style={s.status}>{accepted.length} members</Text>
          </View>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <View style={{ position: "relative" }}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setShowMenu(v => !v)}><DotsIcon /></TouchableOpacity>
          {showMenu && (
            <View style={s.dropMenu}>
              <TouchableOpacity style={s.dropItem} onPress={() => { setShowInfo(true); setShowMenu(false); }}>
                <Text>ℹ️ Group Info</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dropItem} onPress={() => { setShowAddMember(true); setShowMenu(false); }}>
                <UserPlusIcon size={16} /><Text>  Add Members</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dropItem} onPress={() => { setShowWallpaper(true); setShowMenu(false); }}>
                <Text>🖼️ Wallpaper</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dropItem} onPress={handleExit}>
                <Text style={{ color: "#e53935" }}>🚪 Exit Group</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
    </View>

  <ImageBackground
    source={wallpaper?.type === "image" ? { uri: wallpaper.value } : undefined}
    resizeMode="cover"
    style={{ flex: 1 }}
    onLoad={() => console.log("[Wallpaper] bg loaded")}
    onError={(e) => console.log("[Wallpaper] bg ERROR:", e.nativeEvent?.error)}
  >
{wallpaper?.type === "gradient" && (
  <GradientBackground colors={wallpaper.value} id={`chat-${wallpaper.id || "custom"}`} />
)}
{(wallpaper?.type === "emoji" || wallpaper?.type === "doodle") && (
  <View style={[StyleSheet.absoluteFillObject, { backgroundColor: wallpaper.value }]} />
)}
{wallpaper?.type === "emoji" && (
  <EmojiPattern sticker={wallpaper.sticker} opacity={wallpaper.stickerOpacity} size={wallpaper.stickerSize} gap={wallpaper.stickerGap} />
)}
{wallpaper?.type === "doodle" && (
  <DoodlePattern icons={wallpaper.icons} color={wallpaper.iconColor} opacity={wallpaper.iconOpacity} size={wallpaper.iconSize} gap={wallpaper.gap} />
)}
<FlatList
  ref={scrollRef}
  style={{ flex: 1, backgroundColor: wallpaper?.type === "color" ? wallpaper.value : "transparent" }}
  data={messages}
  keyExtractor={(item, i) => item._id || i.toString()}
  contentContainerStyle={{ padding: 14 }}
  initialNumToRender={15}
  maxToRenderPerBatch={10}
  windowSize={10}
  removeClippedSubviews={true}
  onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
  ListHeaderComponent={
    loading ? (
      <>{[false, true, false, true, false].map((me, i) => <ChatBubbleSkeleton key={i} me={me} />)}</>
    ) : null
  }
  renderItem={({ item: msg, index: i }) => {
    if (msg.isSystem) return <SystemMessage msg={msg} />;
    const fromMe = (msg.user?._id || msg.user) === currentUser._id;
    return (
      <GroupMessageBubble
        msg={{ ...msg, chatId }}
        fromMe={fromMe}
        currentUser={currentUser}
        members={group.members}
        onVote={(ids) => handleVote(msg, ids)}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onReply={(m) => { setReplyTo(m); inputRef.current?.focus(); }}
        onForward={(m) => setForwardMsg(m)}
      />
    );
  }}
/>
</ImageBackground>

      {/* Tap anywhere outside the + menu to close it */}
      {showAttach && (
        <TouchableOpacity
          activeOpacity={1}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }}
          onPress={() => setShowAttach(false)}
        />
      )}

      {replyTo && (
        <View style={s.replyBar}>
          <View style={s.replyBarAccent} />
          <View style={{ flex: 1 }}>
            <Text style={s.replyBarName}>Replying to {replyTo.user?.username}</Text>
            <Text style={s.replyBarText} numberOfLines={1}>{replyTo.text}</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={() => setReplyTo(null)}><CloseIcon color="#aaa" /></TouchableOpacity>
        </View>
      )}

      <View style={[s.inputBar, { zIndex: 10 }]}>
        <View style={{ position: "relative" }}>
          <TouchableOpacity style={s.attachCircleBtn} onPress={() => setShowAttach(v => !v)}><PlusIcon /></TouchableOpacity>
          {showAttach && (
            <AttachMenu
              onClose={() => setShowAttach(false)}
              onMediaSent={handleMediaSent}
              onOptimisticAdd={handleOptimisticAdd}
              onUploadFailed={handleUploadFailed}
              chatId={chatId}
              currentUserId={currentUser._id}
              onPoll={() => setShowPollSheet(true)}
            />
          )}
        </View>
        <TextInput
          ref={inputRef}
          onFocus={() => setShowAttach(false)}
          style={s.chatInput}
          placeholder={replyTo ? `Reply to ${replyTo.user?.username}…` : "Message…"}
          placeholderTextColor="#999"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={[s.sendBtn, { opacity: input.trim() ? 1 : 0.45 }]} onPress={send} disabled={!input.trim()}>
          <SendIcon />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  chatOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#fff", zIndex: 100 },
  topbar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#efefef", backgroundColor: "#fff" },
  name: { fontSize: 15, fontWeight: "700", color: "#111" },
  status: { fontSize: 12, color: "#999", marginTop: 1 },
  iconBtn: { padding: 8, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  dropMenu: { position: "absolute", top: 44, right: 0, backgroundColor: "#fff", borderRadius: 12, minWidth: 190, overflow: "hidden", elevation: 20, zIndex: 999, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 20 },
  dropItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
  messages: { flex: 1, backgroundColor: "#f0f2f5" },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#efefef", backgroundColor: "#fff" },
  chatInput: { flex: 1, backgroundColor: "#f2f2f2", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: "#111", fontSize: 14 },
  attachCircleBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "#e0e0e0", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#3897f0", alignItems: "center", justifyContent: "center" },
  sendCircleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#3897f0", alignItems: "center", justifyContent: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  infoSheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "80%", maxHeight: "85%" },
  infoHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  infoHeaderTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  memberRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 9 },
  memberName: { flex: 1, marginLeft: 12, fontSize: 14, fontWeight: "600", color: "#111" },
  removeBtn: { backgroundColor: "#fdeaea", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  exitBtn: { paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#f0c4c4", backgroundColor: "#fff5f5", alignItems: "center" },
  renameInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#ececec", fontSize: 14 },
  smallBtn: { backgroundColor: GOLDEN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  linkBtnText: { color: "#3897f0", fontSize: 12, fontWeight: "600", marginLeft: 6 },
  groupNameText: { fontSize: 17, fontWeight: "700", color: "#111" },
  addMemberBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, borderWidth: 1, borderColor: "#ececec", backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f2f2f2", borderRadius: 20, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 },
  chipText: { fontSize: 12, fontWeight: "600", color: "#333" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  searchInput: { flex: 1, fontSize: 14, color: "#111" },
  loadingText: { textAlign: "center", color: "#bbb", paddingVertical: 24 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: GOLDEN, borderWidth: 0 },
  checkboxCheck: { color: "#fff", fontSize: 12 },
  attachMenu: { position: "absolute", bottom: 46, left: 0, width: Math.min(316, __SCREEN_W - 24), flexWrap: "wrap", backgroundColor: "#fff", borderRadius: 16, padding: 10, flexDirection: "row", gap: 4, elevation: 8, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 24, zIndex: 50 },
  attachOption: { alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 6, borderRadius: 12 },
  attachOptionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  attachOptionLabel: { fontSize: 11, color: "#555", fontWeight: "500", textAlign: "center" },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#f7f7f7", borderTopWidth: 1, borderTopColor: "#ececec" },
  replyBarAccent: { width: 3, minHeight: 36, borderRadius: 4, backgroundColor: GOLDEN },
  replyBarName: { fontSize: 12, fontWeight: "700", color: GOLDEN },
  replyBarText: { fontSize: 12, color: "#666", marginTop: 2 },
  actionSheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  actionSheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 8, paddingBottom: 24 },
  actionSheetBtn: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 14 },
  wallpaperSheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "60%", maxHeight: "75%" },
  wallpaperGalleryBtn: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, backgroundColor: "#f7f7f7", borderWidth: 1, borderColor: "#ececec" },
  wallpaperSectionLabel: { fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  wallpaperSwatch: { width: 64, height: 64, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});

const messageStyles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "78%" },
  senderName: { marginLeft: 4, marginBottom: 2, fontSize: 11.5, fontWeight: "700", color: GOLDEN },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, elevation: 1, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4 },
  bubbleFailed: { borderWidth: 1.5, borderColor: "#e53935" },
  deletedBubble: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "#f0f0f0" },
  replyQuote: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  expiredMedia: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  likeBadge: { position: "absolute", bottom: -14, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 1, elevation: 3 },
  actionsRow: { flexDirection: "row", gap: 5, marginTop: 6, flexWrap: "wrap" },
  actionBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 2 },
  actionBtnLiked: { backgroundColor: "#fff0f0" },
  timeLabel: { fontSize: 10, marginTop: 3 },
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minWidth: 180, maxWidth: 220 },
  audioIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, borderRadius: 10, padding: 10, maxWidth: 240, borderWidth: 1 },
  fileIconBox: { width: 42, height: 48, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 13, fontWeight: "600" },
  fileMeta: { fontSize: 11.5, marginTop: 2 },
  downloadCircle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});