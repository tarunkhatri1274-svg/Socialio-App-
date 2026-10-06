import React, { useState, useRef, useEffect, useCallback } from "react";
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
} from "react-native";
import Video from "react-native-video";
import ReactNativeBlobUtil from "react-native-blob-util";
import { fetchWallpaper, saveWallpaper, uploadWallpaperPhoto, clearWallpaperOnServer } from "./WallpaperAPI"; // adjust path to where you place the file
import { useNavigation, useFocusEffect, useRoute } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import RNFS from "@dr.pogodin/react-native-fs";
import { pick, types, isErrorWithCode, errorCodes } from "@react-native-documents/picker";
import AudioRecorderPlayer from "react-native-nitro-sound"
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";
import { apiFetch as authApiFetch, getCachedUser } from "../../api/authToken";
import Svg, { Path, Line, Circle, Polyline, Polygon, Rect, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";

import Navbar, { subscribeTabReload, useSwipeToChangeTab } from "../../components/Navbar/Navbar";
import socket from "../../sockets/Sockets";
import { playAlertSound } from "../Activity/AlertSound"
import { SharedPostBubble, ForwardModal, getShareCaption } from "./SharePostBubble";
import { useCall } from "../../components/Context/CallContext";
import NewGroupSheet from "./NewGroupSheet";
import GroupChatWindow from "./GroupChatWindow";
import { DmRowSkeleton, ChatBubbleSkeleton } from "../../components/Skeleton/Skeleton";

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

// ── Local device cache of original file names for chat attachments ────────
const FILE_NAME_CACHE_KEY = "dm_file_name_cache";
const getFileNameCache = async () => {
  try { return JSON.parse(await AsyncStorage.getItem(FILE_NAME_CACHE_KEY)) || {}; }
  catch { return {}; }
};
const cacheFileName = async (url, name) => {
  if (!url || !name) return;
  try {
    const cache = await getFileNameCache();
    cache[url] = name;
    await AsyncStorage.setItem(FILE_NAME_CACHE_KEY, JSON.stringify(cache));
  } catch {}
};

const isTempMsgId = (id) => typeof id === "string" && id.startsWith("temp-");

/* ─── Icons ─── */
const BackArrow = ({ color = "#333", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M19 12H5M12 5l-7 7 7 7" /></Svg>
);
const PenIcon = ({ color = "#333", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M12 20h9" /><Path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></Svg>
);
const CallIcon = ({ color = "#333", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></Svg>
);
const VideoIcon = ({ color = "#333", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Polygon points="23 7 16 12 23 17 23 7" /><Rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Svg>
);
const SendIcon = ({ color = "#fff", size = 18 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Line x1="22" y1="2" x2="11" y2="13" /><Polygon points="22 2 15 22 11 13 2 9 22 2" /></Svg>
);
const SearchIcon = ({ color = "#aaa", size = 18 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Circle cx="11" cy="11" r="8" /><Line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>
);
const EditIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
);
const TrashIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Polyline points="3 6 5 6 21 6" /><Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><Path d="M10 11v6M14 11v6" /><Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Svg>
);
const HeartIcon = ({ filled, color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill={filled ? color : "none"} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></Svg>
);
const ReplyIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Polyline points="9 14 4 9 9 4" /><Path d="M20 20v-7a4 4 0 0 0-4-4H4" /></Svg>
);
const ForwardIcon = ({ color = "#555", size = 15 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Polyline points="15 10 20 15 15 20" /><Path d="M4 4v7a4 4 0 0 0 4 4h12" /></Svg>
);
const DotsIcon = ({ color = "#333", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill={color} width={size} height={size}><Circle cx="5" cy="12" r="2" /><Circle cx="12" cy="12" r="2" /><Circle cx="19" cy="12" r="2" /></Svg>
);
const CloseIcon = ({ color = "#333", size = 16 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" width={size} height={size}><Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" /></Svg>
);
const PlusIcon = ({ color = "#555", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" width={size} height={size}><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></Svg>
);
const ImageIcon = ({ color = "#3498db", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Rect x="3" y="3" width="18" height="18" rx="2" /><Circle cx="8.5" cy="8.5" r="1.5" /><Polyline points="21 15 16 10 5 21" /></Svg>
);
const VideoFileIcon = ({ color = "#e74c3c", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Polygon points="23 7 16 12 23 17 23 7" /><Rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Svg>
);
const FileIcon = ({ color = "#9b59b6", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Polyline points="14 2 14 8 20 8" /></Svg>
);
const AudioIcon = ({ color = "#2ecc71", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Rect x="9" y="2" width="6" height="11" rx="3" /><Path d="M19 10a7 7 0 0 1-14 0" /><Line x1="12" y1="19" x2="12" y2="23" /><Line x1="8" y1="23" x2="16" y2="23" /></Svg>
);
const StopIcon = ({ color = "#e53935", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill={color} width={size} height={size}><Rect x="4" y="4" width="16" height="16" rx="2" /></Svg>
);
const PlayTriangleIcon = ({ color = "#fff", size = 14 }) => (
  <Svg viewBox="0 0 24 24" width={size} height={size}><Polygon points="6,4 20,12 6,20" fill={color} /></Svg>
);
const PauseIcon = ({ color = "#fff", size = 14 }) => (
  <Svg viewBox="0 0 24 24" width={size} height={size}><Rect x="5" y="4" width="5" height="16" fill={color} /><Rect x="14" y="4" width="5" height="16" fill={color} /></Svg>
);
const DownloadIcon = ({ color = "#54656f", size = 16 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><Polyline points="7 10 12 15 17 10" /><Line x1="12" y1="15" x2="12" y2="3" /></Svg>
);
const GroupIcon = ({ color = "#333", size = 20 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M23 21v-2a4 4 0 0 0-3-3.87" /><Path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>
);

/* ─── Avatar ─── */
const COLORS = ["#e74c3c", "#e67e22", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c", "#e91e63", "#ff5722"];
const getColor = (str) => COLORS[(str?.charCodeAt(0) || 0) % COLORS.length];
const getInitials = (name) => name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";

function Avatar({ user, size = 42, extraStyle = {} }) {
  const bg = getColor(user?.username || user?.name || "");
  const initials = getInitials(user?.username || user?.name || "");
  const pic = user?.profilePic || user?.avatar;
  if (pic) return <Image source={{ uri: pic }} style={[{ width: size, height: size, borderRadius: size / 2 }, extraStyle]} />;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }, extraStyle]}>
      <Text style={{ fontWeight: "700", color: "#fff", fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

function GroupAvatarStack({ members, size = 46 }) {
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

  if (count === 0) return <View style={[wrap, { alignItems: "center", justifyContent: "center" }]}><GroupIcon color="#999" /></View>;
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

function MsgStatus({ status }) {
  if (status === "sending") return <Text style={{ fontSize: 10, color: "#bbb", fontStyle: "italic" }}>Sending…</Text>;
  if (status === "failed") return <Text style={{ fontSize: 10, color: "#e53935", fontWeight: "600" }}>Failed to send</Text>;
  if (status === "seen") return <Text style={{ fontSize: 10, color: GOLDEN, fontWeight: "600" }}>Seen</Text>;
  if (status === "received") return <Text style={{ fontSize: 10, color: "#aaa" }}>Received</Text>;
  return <Text style={{ fontSize: 10, color: "#bbb" }}>Sent</Text>;
}

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDateLabel = (dateStr) => {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "long", day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
};

function DateDivider({ date }) {
  return (
    <View style={{ alignItems: "center", marginVertical: 14 }}>
      <View style={{ backgroundColor: "#e9ebee", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, color: "#888" }}>{formatDateLabel(date)}</Text>
      </View>
    </View>
  );
}

/* ─── Media bubbles — styled to match the web version ─── */
// The bubble wrapping this content is capped at maxWidth:"72%" of the
// screen (see mStyles below) with 14px horizontal padding inside it.
// A hardcoded pixel width here previously exceeded that on narrower
// phones, pushing the pill past the bubble's rounded edge. Size it off
// the real screen width instead so it always fits inside the bubble.
const { width: __SCREEN_W } = Dimensions.get("window");
const MEDIA_CARD_W = Math.max(160, Math.min(200, __SCREEN_W * 0.72 - 60));

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

/* ─── Attach Menu — now includes real audio recording via
   react-native-audio-recorder-player (tap to start, tap again to stop
   and auto-send), and a fixed file picker using the correct
   @react-native-documents/picker named-export API. ─── */
function AttachMenu({ onClose, onMediaSent, onOptimisticAdd, onUploadFailed, chatId, otherUserId, currentUserId }) {
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
      const originalFileName = uploadData.fileName || fileAsset.fileName || fileAsset.name;
      await cacheFileName(url, originalFileName);

      const msgData = await apiFetch(`${API}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId, text: "", to: otherUserId,
          media: { url, mediaType, fileName: originalFileName, fileSize: uploadData.fileSize || fileAsset.fileSize || fileAsset.size },
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
    </View>
  );
}

/* ─── Delete Message Sheet ─── */
function DeleteMessageSheet({ canDeleteForEveryone, onDeleteForMe, onDeleteForEveryone, onClose }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.actionSheetOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.actionSheet} onPress={() => {}}>
          {canDeleteForEveryone && (
            <TouchableOpacity style={s.actionSheetBtn} onPress={onDeleteForEveryone}>
              <TrashIcon color="#e53935" /><Text style={{ color: "#e53935", fontSize: 15 }}>Delete for everyone</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.actionSheetBtn} onPress={onDeleteForMe}>
            <TrashIcon /><Text style={{ fontSize: 15, color: "#111" }}>Delete for me</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionSheetBtn} onPress={onClose}>
            <Text style={{ fontSize: 15, color: "#888" }}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Message Bubble ─── */
function MessageBubble({ msg, fromMe, otherUser, currentUser, onDelete, onEdit, onReply, onForward, isLast, otherUserOnline }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.text || "");
  const [liked, setLiked] = useState(msg.likes?.some(id => id?.toString() === currentUser._id?.toString()) || false);
  const [likeCount, setLikeCount] = useState(msg.likes?.length || 0);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const isTemp = isTempMsgId(msg._id);

  useEffect(() => {
    setLiked(msg.likes?.some(id => id?.toString() === currentUser._id?.toString()) || false);
    setLikeCount(msg.likes?.length || 0);
  }, [msg.likes, currentUser._id]);

  const handleDeleteForMe = async () => {
    setShowDeleteSheet(false);
    if (isTemp) { onDelete(msg._id); return; }
    try {
      await authApiFetch(`${API}/messages/${msg._id}`, {
        method: "DELETE",
        body: JSON.stringify({ to: otherUser?._id, forEveryone: false })
      });
      onDelete(msg._id);
    } catch (err) { console.error("Delete failed", err); }
  };

  const handleDeleteForEveryone = async () => {
    setShowDeleteSheet(false);
    if (isTemp) { onDelete(msg._id); return; }
    try {
      await authApiFetch(`${API}/messages/${msg._id}`, {
        method: "DELETE",
        body: JSON.stringify({ to: otherUser?._id, forEveryone: true })
      });
      onDelete(msg._id);
    } catch (err) { console.error("Delete for everyone failed", err); }
  };

  const handleEdit = async () => {
    if (!editText.trim()) return;
    try {
      await apiFetch(`${API}/messages/${msg._id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText, to: otherUser?._id }),
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
      await apiFetch(`${API}/messages/like/${msg._id}`, { method: "PATCH" });
    } catch {
      setLiked(was);
      setLikeCount(c => was ? c + 1 : c - 1);
    }
  };

  const isEditable = !msg.media?.url && !msg.sharedPost?.postId && !msg.sharedPost?.storyId && !msg.sending;
  const fmt = d => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const msgStatus = fromMe
    ? (msg.sending ? "sending" : msg.failed ? "failed" : msg.seenBy?.length > 0 ? "seen" : otherUserOnline ? "received" : "sent")
    : null;

  if (msg.deletedForEveryone) {
    return (
      <View style={[mStyles.wrap, { alignItems: fromMe ? "flex-end" : "flex-start" }]}>
        <View style={[mStyles.row, { flexDirection: fromMe ? "row-reverse" : "row" }]}>
          {!fromMe && <Avatar user={otherUser} size={30} />}
          <View style={mStyles.deletedBubble}>
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

      <View style={[mStyles.wrap, { alignItems: fromMe ? "flex-end" : "flex-start" }]}>
        <View style={[mStyles.row, { flexDirection: fromMe ? "row-reverse" : "row" }]}>
          {!fromMe && <Avatar user={otherUser} size={30} extraStyle={{ marginBottom: 2 }} />}

          <View style={{ maxWidth: "72%" }}>
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
                  mStyles.bubble,
                  { backgroundColor: fromMe ? "rgba(234,182,118,0.92)" : "#fff", borderBottomRightRadius: fromMe ? 4 : 18, borderBottomLeftRadius: fromMe ? 18 : 4, opacity: msg.sending ? 0.75 : 1 },
                  msg.failed && mStyles.bubbleFailed,
                ]}>
                  {msg.replyTo && (
                    <View style={[mStyles.replyQuote, { borderLeftColor: fromMe ? "rgba(255,255,255,0.6)" : GOLDEN, backgroundColor: fromMe ? "rgba(0,0,0,0.1)" : "#fff8ee" }]}>
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
                        {getShareCaption(msg, fromMe, otherUser?.username)}
                      </Text>
                      <SharedPostBubble sharedPost={msg.sharedPost} fromMe={fromMe} isMentionMessage={msg.isMentionMessage} />
                    </>
                  )}

                  {msg.media?.url && (
                    <View>
                      <MediaPreview media={msg.media} fromMe={fromMe} />
                      {msg.sending && (
                        <View style={mStyles.uploadOverlay}><ActivityIndicator color="#fff" size="small" /></View>
                      )}
                    </View>
                  )}
                  {!msg.media?.url && msg.mediaExpired && (
                    <View style={[mStyles.expiredMedia, { backgroundColor: fromMe ? "rgba(255,255,255,0.15)" : "#f0f2f5" }]}>
                      <Text style={{ fontSize: 12, fontStyle: "italic", color: fromMe ? "rgba(255,255,255,0.8)" : "#888" }}>⏱️ Media expired after 3 days</Text>
                    </View>
                  )}

                  {!!msg.text && !msg.sharedPost?.postId && !msg.sharedPost?.storyId && (
                    <Text style={{ fontSize: 14, lineHeight: 20, color: fromMe ? "#fff" : "#111" }}>{msg.text}</Text>
                  )}
                  {msg.isEdited && <Text style={{ fontSize: 10, opacity: 0.55, marginLeft: 4 }}>· edited</Text>}
                </View>

                {likeCount > 0 && (
                  <View style={[mStyles.likeBadge, fromMe ? { left: 8 } : { right: 8 }]}>
                    <Text style={{ fontSize: 11 }}>❤️ {likeCount}</Text>
                  </View>
                )}
              </View>
            )}

            {!editing && !msg.sending && (
              <View style={[mStyles.actionsRow, { justifyContent: fromMe ? "flex-end" : "flex-start" }]}>
                <TouchableOpacity style={[mStyles.actionBtn, liked && mStyles.actionBtnLiked]} onPress={handleLike}>
                  <HeartIcon filled={liked} color={liked ? "#e53935" : "#555"} />
                </TouchableOpacity>
                <TouchableOpacity style={mStyles.actionBtn} onPress={() => onReply(msg)}><ReplyIcon /></TouchableOpacity>
                <TouchableOpacity style={mStyles.actionBtn} onPress={() => onForward(msg)}><ForwardIcon /></TouchableOpacity>
                {fromMe && isEditable && (
                  <TouchableOpacity style={mStyles.actionBtn} onPress={() => { setEditing(true); setEditText(msg.text || ""); }}><EditIcon /></TouchableOpacity>
                )}
                <TouchableOpacity style={mStyles.actionBtn} onPress={() => setShowDeleteSheet(true)}><TrashIcon color="#e53935" /></TouchableOpacity>
              </View>
            )}

            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: likeCount > 0 ? 18 : 4 }}>
              <Text style={{ fontSize: 10, color: "#aaa" }}>{fmt(msg.createdAt)}</Text>
              {fromMe && (isLast || msg.sending || msg.failed) && <MsgStatus status={msgStatus} />}
            </View>
          </View>
        </View>
      </View>
    </>
  );
}

function SystemMessage({ msg }) {
  const fmt = d => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={{ alignItems: "center", marginVertical: 10 }}>
      <View style={{ backgroundColor: "#ececec", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, color: "#888" }}>{msg.text}</Text>
      </View>
      <Text style={{ fontSize: 10, color: "#bbb", marginTop: 3 }}>{fmt(msg.createdAt)}</Text>
    </View>
  );
}

function RequestBanner({ otherUser, onAccept, onDecline }) {
  return (
    <View style={s.requestBanner}>
      <Avatar user={otherUser} size={56} />
      <Text style={s.requestBannerName}>{otherUser?.username}</Text>
      <Text style={s.requestBannerText}>
        {otherUser?.username} isn't in your followers. They won't know you've seen this until you accept.
      </Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 14, width: "100%" }}>
        <TouchableOpacity style={s.declineBtn} onPress={onDecline}><Text style={{ color: "#111", fontWeight: "600" }}>Delete</Text></TouchableOpacity>
        <TouchableOpacity style={s.acceptReqBtn} onPress={onAccept}><Text style={{ color: "#fff", fontWeight: "600" }}>Accept</Text></TouchableOpacity>
      </View>
    </View>
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

/* ─── ChatWindow (1:1) ─── */
function ChatWindow({ conversation, currentUser, onClose, onlineUsers, onRequestHandled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const { startCall } = useCall();
  const [muted, setMuted] = useState(false);
   const [showMenu, setShowMenu] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [showAttach, setShowAttach] = useState(false);
  const [wallpaper, setWallpaper] = useState(null);
  const [showWallpaper, setShowWallpaper] = useState(false);
  const [isPendingRequest, setIsPendingRequest] = useState(!!conversation.isRequest);
  const [pendingIsIncoming, setPendingIsIncoming] = useState(
    !!conversation.isRequest && currentUser._id !== conversation.initiator?._id?.toString()
  );

  const scrollRef = useRef(null);
  const typingTimer = useRef(null);
  const sentMsgIds = useRef(new Set());
  const inputRef = useRef(null);

  const otherUser = conversation.members?.find(m => m._id !== currentUser._id) || conversation.otherUser || conversation;
  const chatId = conversation._id || conversation.chatId;
  const otherUserOnline = onlineUsers.includes(otherUser?._id?.toString());

  // FIX: this chat window is opened via local state (`openConv` in
  // Messages()), not by pushing a new screen onto the navigator's stack.
  // So the navigator has no idea a "chat" is open — pressing the Android
  // hardware back button fell straight through to the navigator's own
  // default back behavior, which popped to whatever the previous screen
  // in navigation history happened to be (e.g. a different tab) instead
  // of just closing this chat back to the Messages inbox. Intercepting
  // hardwareBackPress here and calling onClose() (which sets openConv
  // back to null) fixes that — return true tells RN "handled, don't do
  // anything else with this back press".
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
      const wp = await fetchWallpaper(chatId, false);
      if (!cancelled) setWallpaper(wp);
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  const handleWallpaperSelect = async (val) => {
    setWallpaper(val);
    try {
      if (val) await saveWallpaper(chatId, false, val);
      else await clearWallpaperOnServer(chatId, false);
    } catch (err) {
      console.log("[Wallpaper] save failed:", err.message);
    }
  };

  const handleWallpaperPhoto = async () => {
    const result = await launchImageLibrary({ mediaType: "photo" });
    if (result.didCancel || !result.assets?.[0]) return;
    try {
      const data = await uploadWallpaperPhoto(chatId, false, result.assets[0]);
      if (data.success) setWallpaper(data.wallpaper);
      else Alert.alert("Couldn't set wallpaper", data.message || "Please try again.");
    } catch (err) {
      console.log("[Wallpaper] upload failed:", err.message);
      Alert.alert("Couldn't set wallpaper", "Please try again.");
    }
  };

  useEffect(() => {
    setLoading(true);
    apiFetch(`${API}/messages/chat/${chatId}`).then(data => {
      const list = Array.isArray(data) ? data : [];
      setMessages(list);
      const latestReal = [...list].reverse().find(m => !m.isSystem);
      if (latestReal && latestReal.requestStatus === "pending") {
        const senderId = (latestReal.user?._id || latestReal.user)?.toString();
        const iAmSender = senderId === currentUser._id?.toString();
        setIsPendingRequest(true);
        setPendingIsIncoming(!iAmSender);
      } else if (latestReal) {
        setIsPendingRequest(false);
        setPendingIsIncoming(false);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [chatId, currentUser._id]);

  useEffect(() => {
    const onReceive = data => {
      if (data.conversationId !== chatId) return;
      const incomingId = data.message?._id;
      const senderId = data.message?.user?._id || data.from;
      if (senderId?.toString() === currentUser._id?.toString()) return;
      if (sentMsgIds.current.has(incomingId)) return;
      if (typeof data.isRequest === "boolean") {
        setIsPendingRequest(data.isRequest);
        setPendingIsIncoming(data.isRequest);
      }
      setMessages(prev => {
        if (prev.some(m => m._id === incomingId)) return prev;
        return [...prev, data.message || { _id: Date.now(), chatId, user: { _id: data.from }, text: data.text, createdAt: data.createdAt }];
      });
    };
    const onEdited = ({ chatId: cId, messageId, text }) => { if (cId !== chatId) return; setMessages(prev => prev.map(m => m._id === messageId ? { ...m, text, isEdited: true } : m)); };
    const onDeleted = ({ chatId: cId, messageId }) => { if (cId !== chatId) return; setMessages(prev => prev.filter(m => m._id !== messageId)); };
    const onDeletedForEveryone = ({ chatId: cId, messageId }) => { if (cId !== chatId) return; setMessages(prev => prev.map(m => m._id === messageId ? { ...m, deletedForEveryone: true, text: "", media: undefined, sharedPost: undefined } : m)); };
    const onMediaExpired = ({ chatId: cId, messageId }) => { if (cId !== chatId) return; setMessages(prev => prev.map(m => m._id === messageId ? { ...m, media: undefined, mediaExpired: true } : m)); };
    const onPurged = ({ chatId: cId, messageId }) => { if (cId !== chatId) return; setMessages(prev => prev.filter(m => m._id !== messageId)); };
    const onTyping = ({ from }) => { if (from === otherUser?._id) setIsTyping(true); };
    const onStop = ({ from }) => { if (from === otherUser?._id) setIsTyping(false); };
    const onLikes = ({ chatId: cId, messageId, likes }) => { if (cId !== chatId) return; setMessages(prev => prev.map(m => m._id === messageId ? { ...m, likes } : m)); };
    const onChatCleared = ({ chatId: cId }) => { if (cId !== chatId) return; setMessages([]); };

    socket.on("receiveMessage", onReceive); socket.on("newMessageRequest", onReceive);
    socket.on("messageEdited", onEdited); socket.on("messageDeleted", onDeleted);
    socket.on("messageDeletedForEveryone", onDeletedForEveryone);
    socket.on("mediaExpired", onMediaExpired);
    socket.on("messagePurged", onPurged);
    socket.on("typing", onTyping); socket.on("stopTyping", onStop); socket.on("messageLiked", onLikes);
    socket.on("chatCleared", onChatCleared);
    return () => {
      socket.off("receiveMessage", onReceive); socket.off("newMessageRequest", onReceive);
      socket.off("messageEdited", onEdited); socket.off("messageDeleted", onDeleted);
      socket.off("messageDeletedForEveryone", onDeletedForEveryone);
      socket.off("mediaExpired", onMediaExpired);
      socket.off("messagePurged", onPurged);
      socket.off("typing", onTyping); socket.off("stopTyping", onStop); socket.off("messageLiked", onLikes);
      socket.off("chatCleared", onChatCleared);
    };
  }, [chatId, otherUser, currentUser._id]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [messages.length, isTyping]);

  const handleTyping = (text) => {
    setInput(text);
    socket.emit("typing", { to: otherUser?._id, from: currentUser._id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit("stopTyping", { to: otherUser?._id, from: currentUser._id }), 1500);
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const currentReply = replyTo;
    setReplyTo(null);
    socket.emit("stopTyping", { to: otherUser?._id, from: currentUser._id });
    try {
      const data = await apiFetch(`${API}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, text, to: otherUser?._id, replyTo: currentReply?._id || null }) });
      sentMsgIds.current.add(data._id);
      setMessages(prev => prev.some(m => m._id === data._id) ? prev : [...prev, data]);
      if (data.requestStatus) {
        setIsPendingRequest(data.requestStatus === "pending");
        setPendingIsIncoming(false);
      }
    } catch (err) { console.error("Send failed", err); }
  };

  const handleOptimisticAdd = (msg) => setMessages(prev => [...prev, msg]);

  const handleMediaSent = (msg, tempId) => {
    sentMsgIds.current.add(msg._id);
    setMessages(prev => prev.map(m => m._id === tempId ? msg : m));
    if (msg.requestStatus) {
      setIsPendingRequest(msg.requestStatus === "pending");
      setPendingIsIncoming(false);
    }
  };

  const handleUploadFailed = (tempId) => setMessages(prev => prev.map(m => m._id === tempId ? { ...m, sending: false, failed: true } : m));
  const handleDelete = msgId => setMessages(prev => prev.filter(m => m._id !== msgId));
  const handleEdit = (msgId, text) => setMessages(prev => prev.map(m => m._id === msgId ? { ...m, text, isEdited: true } : m));

  const handleAcceptRequest = async () => {
    try {
      await apiFetch(`${API}/messages/requests/${chatId}/accept`, { method: "POST" });
      setIsPendingRequest(false);
      setPendingIsIncoming(false);
      onRequestHandled?.(chatId, "accepted");
    } catch (err) { console.error(err); }
  };

  const handleDeclineRequest = async () => {
    try {
      await apiFetch(`${API}/messages/requests/${chatId}/decline`, { method: "POST" });
      onRequestHandled?.(chatId, "declined");
      onClose();
    } catch (err) { console.error(err); }
  };

  const handleClearChat = () => {
    Alert.alert("Clear chat", "Clear chat for yourself only?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear", style: "destructive",
        onPress: async () => {
          try {
            await authApiFetch(`${API}/messages/chat/${chatId}/clear`, {
              method: "DELETE",
              body: JSON.stringify({ to: otherUser._id, onlyForMe: true })
            });
            setMessages([]);
          } catch (err) { console.error(err); }
          setShowMenu(false);
        },
      },
    ]);
  };

  return (
    <View style={s.chatOverlay}>
            {forwardMsg && <ForwardModal msg={forwardMsg} currentUser={currentUser} onClose={() => setForwardMsg(null)} />}
      {showWallpaper && (
        <WallpaperSheet current={wallpaper} onClose={() => setShowWallpaper(false)} onSelect={handleWallpaperSelect} onPickPhoto={handleWallpaperPhoto} />
      )}

      <View style={s.chatTopbar}>
        <TouchableOpacity style={s.iconBtn} onPress={onClose}><BackArrow /></TouchableOpacity>
        <View style={{ position: "relative" }}>
          <Avatar user={otherUser} size={38} />
          {otherUserOnline && <View style={s.onlineDotBig} />}
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.topbarName}>{otherUser?.username || otherUser?.name}</Text>
          <Text style={s.topbarStatus}>
            {isTyping ? <Text style={{ color: "#4caf50" }}>typing…</Text> : otherUserOnline ? <Text style={{ color: GOLDEN }}>Active now</Text> : <Text style={{ color: "#bbb" }}>Offline</Text>}
          </Text>
        </View>
        {!isPendingRequest && (
          <View style={{ flexDirection: "row" }}>
            <TouchableOpacity style={s.iconBtn} onPress={() => startCall(otherUser, "audio")}><CallIcon /></TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => startCall(otherUser, "video")}><VideoIcon /></TouchableOpacity>
            <View style={{ position: "relative" }}>
              <TouchableOpacity style={s.iconBtn} onPress={() => setShowMenu(v => !v)}><DotsIcon /></TouchableOpacity>
              {showMenu && (
                <View style={s.dropMenu}>
                  <TouchableOpacity style={s.dropItem} onPress={handleClearChat}><Text>🗑️ Clear Chat</Text></TouchableOpacity>
                  <TouchableOpacity style={s.dropItem} onPress={() => { setMuted(m => !m); setShowMenu(false); }}>
                    <Text>{muted ? "🔔 Unmute" : "🔕 Mute"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.dropItem} onPress={() => { setShowWallpaper(true); setShowMenu(false); }}>
                    <Text>🖼️ Wallpaper</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}
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
    <>
      {loading && [false, true, false, true, false].map((me, i) => <ChatBubbleSkeleton key={i} me={me} />)}
      {!loading && messages.length === 0 && !isPendingRequest && (
        <View style={s.emptyChat}>
          <Avatar user={otherUser} size={72} />
          <Text style={s.emptyChatName}>{otherUser?.username}</Text>
          <Text style={s.emptyChatHint}>No messages yet. Say hello 👋</Text>
        </View>
      )}
      {isPendingRequest && pendingIsIncoming && (
        <RequestBanner otherUser={otherUser} onAccept={handleAcceptRequest} onDecline={handleDeclineRequest} />
      )}
    </>
  }
  ListFooterComponent={
    isTyping ? (
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 4 }}>
        <Avatar user={otherUser} size={28} />
        <View style={s.typingBubble}>
          <ActivityIndicator size="small" color="#aaa" />
        </View>
      </View>
    ) : null
  }
  renderItem={({ item: msg, index: i }) => {
    const prevMsg = i > 0 ? messages[i - 1] : null;
    const showDivider = !prevMsg || new Date(prevMsg.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();

    if (msg.isSystem) {
      return (
        <>
          {showDivider && <DateDivider date={msg.createdAt} />}
          <SystemMessage msg={msg} />
        </>
      );
    }
    const fromMe = msg.user?._id === currentUser._id || msg.user === currentUser._id;
    const isLast = i === messages.length - 1;
    return (
      <>
        {showDivider && <DateDivider date={msg.createdAt} />}
        <MessageBubble
          msg={msg} fromMe={fromMe} otherUser={otherUser} currentUser={currentUser}
          onDelete={handleDelete} onEdit={handleEdit}
          onReply={m => { setReplyTo(m); inputRef.current?.focus(); }}
          onForward={m => setForwardMsg(m)}
          isLast={isLast} otherUserOnline={otherUserOnline}
        />
      </>
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

      <View style={[s.chatInputBar, { zIndex: 10 }]}>
        <View style={{ position: "relative" }}>
          <TouchableOpacity style={s.attachCircleBtn} onPress={() => setShowAttach(v => !v)}><PlusIcon /></TouchableOpacity>
          {showAttach && (
            <AttachMenu
              onClose={() => setShowAttach(false)}
              onMediaSent={handleMediaSent}
              onOptimisticAdd={handleOptimisticAdd}
              onUploadFailed={handleUploadFailed}
              chatId={chatId}
              otherUserId={otherUser?._id}
              currentUserId={currentUser._id}
            />
          )}
        </View>
        <TextInput
          ref={inputRef}
          onFocus={() => setShowAttach(false)}
          style={s.chatInput}
          placeholder={replyTo ? `Reply to ${replyTo.user?.username}…` : isPendingRequest ? "Send a message request…" : "Message…"}
          placeholderTextColor="#999"
          value={input}
          onChangeText={handleTyping}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={[s.sendCircleBtn, { opacity: input.trim() ? 1 : 0.45 }]} onPress={send} disabled={!input.trim()}>
          <SendIcon />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── New Chat Search Sheet ─── */
function NewChatSheet({ onClose, onSelectUser }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!search.trim()) { setResults([]); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`${API}/messages/search-users?q=${encodeURIComponent(search)}`);
        setResults(data.success ? data.users : []);
      } catch (err) { console.error(err); }
      setSearching(false);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [search]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.forwardModal} onPress={() => {}}>
          <View style={s.forwardModalHeader}>
            <Text style={s.forwardModalTitle}>New Message</Text>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>
          <View style={s.forwardSearchWrap}>
            <SearchIcon />
            <TextInput style={s.forwardSearchInput} placeholder="Search people you follow…" placeholderTextColor="#bbb" value={search} onChangeText={setSearch} autoFocus />
          </View>
          <ScrollView style={s.forwardUserList}>
            {searching && <Text style={s.loadingText}>Searching…</Text>}
            {!searching && search.trim() && results.length === 0 && <Text style={s.loadingText}>No users found for "{search}"</Text>}
            {!searching && results.map(user => (
              <TouchableOpacity key={user._id} style={s.forwardUserItem} onPress={() => onSelectUser(user)}>
                <Avatar user={user} size={44} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 14, color: "#111" }}>{user.username}</Text>
                  <Text style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{user.isPrivate ? "🔒 Private" : (user.bio || "")}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/* ─── Pencil dropdown: New Message / New Group ─── */
function ComposeMenu({ onNewMessage, onNewGroup }) {
  return (
    <View style={s.composeMenu}>
      <TouchableOpacity style={s.composeItem} onPress={onNewMessage}>
        <PenIcon /><Text style={{ fontWeight: "600", fontSize: 14, color: "#111" }}>  New Message</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.composeItem} onPress={onNewGroup}>
        <GroupIcon /><Text style={{ fontWeight: "600", fontSize: 14, color: "#111" }}>  New Group</Text>
      </TouchableOpacity>
    </View>
  );
}

function Messages() {
  const navigation = useNavigation();
  // NEW — reads the chatId param ActivityPage.js's "message" notification
  // target sends via navigation.navigate("Messages", { chatId }).
  const route = useRoute();
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("inbox");
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [requests, setRequests] = useState([]);
  const [groupRequests, setGroupRequests] = useState([]);
  const [search, setSearch] = useState("");
  const [openConv, setOpenConv] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showComposeMenu, setShowComposeMenu] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [groupRequestCount, setGroupRequestCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notifSettings, setNotifSettings] = useState(null);
  // NEW — lets the tab-reload handler below scroll the inbox back to top.
  const inboxScrollRef = useRef(null);
  // NEW — guards the notification-open effect below against firing more
  // than once for the same chatId while navigation.setParams is still
  // catching up (mergedInbox is a fresh array every render).
  const handledNotifChatIdRef = useRef(null);

  // NEW — screen-wide swipe to switch tabs (bubble-phase, so a swipe
  // starting on the inbox ScrollView still scrolls normally). Only
  // wired up on the inbox list itself — spread conditionally below so
  // it doesn't fight with anything inside an open conversation.
  const { panHandlers: swipePanHandlers } = useSwipeToChangeTab({ capture: false });

  useEffect(() => {
    (async () => {
      try {
        setCurrentUser(await getCachedUser());
      } catch { setCurrentUser(null); }
      try {
        const raw = await AsyncStorage.getItem("openConv");
        setOpenConv(raw ? JSON.parse(raw) : null);
      } catch { setOpenConv(null); }
    })();
  }, []);

  useEffect(() => {
    if (!currentUser?._id) return;
    apiFetch(`${API}/auth/notifications/settings/`)
      .then(async data => {
        if (data?.success) {
          setNotifSettings(data.settings);
          await AsyncStorage.setItem("notifSettings", JSON.stringify(data.settings));
        }
      })
      .catch(err => console.error("Failed to load notification settings", err));
  }, [currentUser?._id]);

  const loadInbox = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/messages/inbox`);
      if (data.success) setConversations(data.conversations);
    } catch (err) { console.error(err); }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/messages/requests`);
      if (data.success) { setRequests(data.requests); setRequestCount(data.requests.length); }
    } catch (err) { console.error(err); }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/groups/mine`);
      if (data.success) setGroups(data.groups);
    } catch (err) { console.error(err); }
  }, []);

  const loadGroupRequests = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/groups/requests`);
      if (data.success) { setGroupRequests(data.requests); setGroupRequestCount(data.requests.length); }
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    if (!currentUser?._id) return;
    socket.emit("register", currentUser._id);
    socket.on("onlineUsers", setOnlineUsers);

    const onInboxCounts = ({ requestCount: rc }) => { setRequestCount(rc || 0); loadInbox(); };
    const onGroupInboxCounts = ({ groupRequestCount: grc }) => setGroupRequestCount(grc || 0);

    // FIX — this used to be an empty stub (`() => {}`), so every branch
    // below that called it was a silent no-op: no sound and no status-bar
    // notification ever fired from the inbox screen. Now it delegates to
    // the shared playAlertSound() (AlertSound.js), the same helper
    // ActivityPage.js already uses successfully, so it goes through the
    // real notifee channel instead of doing nothing.
    const playPing = (title = "Socialio", body = "You have a new message") =>
      playAlertSound({ title, body });

    const onNewMessage = (data) => {
      const currentlyOpenChatId = openConv?._id;
      if (data?.conversationId !== currentlyOpenChatId && notifSettings && notifSettings.message !== false) {
        playPing(
          data?.message?.user?.username ? `Message from ${data.message.user.username}` : "New message",
          data?.text || "You received a new message"
        );
      }
      loadInbox();
    };
    const onNewRequest = () => {
      if (notifSettings && notifSettings.message !== false) playPing("New message request", "You received a new message request");
      loadRequests();
    };
    const onRequestAccepted = () => loadInbox();
    const onGroupInvite = () => {
      if (notifSettings && notifSettings.message !== false) playPing("Group invite", "You were invited to a group");
      loadGroupRequests();
    };
    const onGroupMessage = (data) => {
      const currentlyOpenChatId = openConv?._id;
      if (data?.chatId !== currentlyOpenChatId && notifSettings && notifSettings.message !== false) {
        playPing(
          data?.message?.user?.username ? `${data.message.user.username} (group)` : "New group message",
          data?.text || "You received a new group message"
        );
      }
      loadGroups();
    };
    const onGroupMemberJoined = () => loadGroups();
    const onGroupMemberLeft = () => loadGroups();
    const onRemovedFromGroup = () => loadGroups();

    socket.on("inboxCounts", onInboxCounts);
    socket.on("groupInboxCounts", onGroupInboxCounts);
    socket.on("receiveMessage", onNewMessage);
    socket.on("newMessageRequest", onNewRequest);
    socket.on("messageRequestAccepted", onRequestAccepted);
    socket.on("groupInviteReceived", onGroupInvite);
    socket.on("receiveGroupMessage", onGroupMessage);
    socket.on("groupMemberJoined", onGroupMemberJoined);
    socket.on("groupMemberLeft", onGroupMemberLeft);
    socket.on("removedFromGroup", onRemovedFromGroup);

    return () => {
      socket.off("onlineUsers");
      socket.off("inboxCounts", onInboxCounts);
      socket.off("groupInboxCounts", onGroupInboxCounts);
      socket.off("receiveMessage", onNewMessage);
      socket.off("newMessageRequest", onNewRequest);
      socket.off("messageRequestAccepted", onRequestAccepted);
      socket.off("groupInviteReceived", onGroupInvite);
      socket.off("receiveGroupMessage", onGroupMessage);
      socket.off("groupMemberJoined", onGroupMemberJoined);
      socket.off("groupMemberLeft", onGroupMemberLeft);
      socket.off("removedFromGroup", onRemovedFromGroup);
    };
  }, [currentUser?._id, openConv, notifSettings, loadInbox, loadRequests, loadGroups, loadGroupRequests]);

  useEffect(() => {
    if (!currentUser?._id) return;
    setLoading(true);
    Promise.all([loadInbox(), loadRequests(), loadGroups(), loadGroupRequests()]).finally(() => setLoading(false));
  }, [currentUser?._id, loadInbox, loadRequests, loadGroups, loadGroupRequests]);

  // NEW — tapping the already-active "Messages" tab reloads the inbox
  // list and scrolls it back to top. Guarded to only fire when the user
  // is looking at the inbox (not already inside a conversation) — like
  // Instagram, ordinary focus (closing a chat, coming back from a
  // profile) does NOT reload anything; only the explicit tab tap does.
  useEffect(() => {
    return subscribeTabReload("Messages", () => {
      if (openConv) return;
      inboxScrollRef.current?.scrollTo?.({ y: 0, animated: true });
      setLoading(true);
      Promise.all([loadInbox(), loadRequests(), loadGroups(), loadGroupRequests()]).finally(() => setLoading(false));
    });
  }, [openConv, loadInbox, loadRequests, loadGroups, loadGroupRequests]);

  const isOnline = userId => onlineUsers.includes(userId?.toString());

  const mergedInbox = [
    ...conversations.map(c => ({ ...c, isGroup: false })),
    ...groups.map(g => ({ ...g, isGroup: true })),
  ].sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

  const filteredConvos = mergedInbox.filter(c => {
    const name = c.isGroup ? c.name : c.otherUser?.username;
    return (name || "").toLowerCase().includes(search.toLowerCase());
  });

  // NEW — this screen previously never read any navigation param, so a
  // "message" notification tap (navigation.navigate("Messages", { chatId }),
  // see ActivityPage.js) landed on the plain inbox list instead of the
  // conversation. The notification only carries a bare chatId — no
  // members/otherUser to build an openConv object from directly — so we
  // wait for the inbox to finish loading and resolve it against
  // mergedInbox instead, then reuse the existing openConversation() flow
  // (which already knows how to open either a DM or a group).
  useEffect(() => {
    const targetChatId = route.params?.chatId;
    if (!targetChatId || loading) return;
    if (handledNotifChatIdRef.current === targetChatId) return;
    const match = mergedInbox.find(c => c.chatId === targetChatId);
    if (match) {
      handledNotifChatIdRef.current = targetChatId;
      openConversation(match);
      // Clear the param so switching away and back to this tab later
      // doesn't reopen the same chat every time.
      navigation.setParams({ chatId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.chatId, loading, mergedInbox]);

  const totalRequestBadge = requestCount + groupRequestCount;

  const openChat = async (user) => {
    try {
      const data = await apiFetch(`${API}/messages/chat/${currentUser._id}/${user._id}`);
      const conv = { _id: data.chatId, chatId: data.chatId, members: [currentUser, user], otherUser: user, isGroup: false };
      await AsyncStorage.setItem("openConv", JSON.stringify(conv));
      setOpenConv(conv);
      setShowNewChat(false);
    } catch (err) { console.error("Open chat failed", err); }
  };

  const openConversation = async (convo) => {
    if (convo.isGroup) {
      const conv = { _id: convo.chatId, chatId: convo.chatId, isGroup: true, ...convo };
      await AsyncStorage.setItem("openConv", JSON.stringify(conv));
      setOpenConv(conv);
      return;
    }
    const otherUser = convo.otherUser;
    const conv = { _id: convo.chatId, chatId: convo.chatId, members: [currentUser, otherUser], otherUser, isRequest: convo.status === "pending", initiator: convo.initiator, isGroup: false };
    await AsyncStorage.setItem("openConv", JSON.stringify(conv));
    setOpenConv(conv);
  };

  const openRequest = async (req) => {
    const otherUser = req.initiator;
    const conv = { _id: req.chatId, chatId: req.chatId, members: [currentUser, otherUser], otherUser, isRequest: true, initiator: req.initiator, isGroup: false };
    await AsyncStorage.setItem("openConv", JSON.stringify(conv));
    setOpenConv(conv);
  };

  const handleRequestHandled = (chatId, status) => {
    setRequests(prev => prev.filter(r => r.chatId !== chatId));
    setRequestCount(prev => Math.max(0, prev - 1));
    if (status === "accepted") loadInbox();
  };

  const handleGroupCreated = async (group) => {
    setShowNewGroup(false);
    loadGroups();
    const conv = { _id: group.chatId, chatId: group.chatId, isGroup: true, name: group.name, members: group.members };
    await AsyncStorage.setItem("openConv", JSON.stringify(conv));
    setOpenConv(conv);
  };

  const handleAcceptGroupInvite = async (chatId) => {
    try {
      await apiFetch(`${API}/groups/${chatId}/accept`, { method: "POST" });
      setGroupRequests(prev => prev.filter(r => r.chatId !== chatId));
      setGroupRequestCount(prev => Math.max(0, prev - 1));
      loadGroups();
    } catch (err) { console.error(err); }
  };

  const handleDeclineGroupInvite = async (chatId) => {
    try {
      await apiFetch(`${API}/groups/${chatId}/decline`, { method: "POST" });
      setGroupRequests(prev => prev.filter(r => r.chatId !== chatId));
      setGroupRequestCount(prev => Math.max(0, prev - 1));
    } catch (err) { console.error(err); }
  };

  const handleGroupExited = () => loadGroups();

  const closeChat = async () => {
    await AsyncStorage.removeItem("openConv");
    setOpenConv(null);
    loadInbox();
    loadRequests();
  };

  const closeGroupChat = async () => {
    await AsyncStorage.removeItem("openConv");
    setOpenConv(null);
    loadGroups();
  };

  if (!currentUser) return null;

  return (
    <View style={s.page} {...(!openConv ? swipePanHandlers : {})}>
      {showNewChat && <NewChatSheet onClose={() => setShowNewChat(false)} onSelectUser={openChat} />}
      {showNewGroup && <NewGroupSheet onClose={() => setShowNewGroup(false)} onCreated={handleGroupCreated} />}

      <ScrollView ref={inboxScrollRef} style={s.dmListWrap}>
        <View style={s.dmHeader}>
          <View>
            <Text style={s.dmTitle}>Messages</Text>
            <Text style={s.dmUsername}>{currentUser?.username} ▾</Text>
          </View>
          <View style={{ position: "relative" }}>
            <TouchableOpacity style={s.iconBtn} onPress={() => setShowComposeMenu(v => !v)}><PenIcon /></TouchableOpacity>
            {showComposeMenu && (
              <ComposeMenu
                onNewMessage={() => { setShowComposeMenu(false); setShowNewChat(true); }}
                onNewGroup={() => { setShowComposeMenu(false); setShowNewGroup(true); }}
              />
            )}
          </View>
        </View>

        <View style={s.searchWrap}>
          <View style={s.searchIconWrap}><SearchIcon /></View>
          <TextInput style={s.searchInput} placeholder="Search messages…" placeholderTextColor="#aaa" value={search} onChangeText={setSearch} />
        </View>

        <View style={s.tabsRow}>
          <TouchableOpacity style={[s.tabBtn, activeTab === "inbox" && s.tabBtnActive]} onPress={() => setActiveTab("inbox")}>
            <Text style={[s.tabBtnText, activeTab === "inbox" && s.tabBtnTextActive]}>Primary</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tabBtn, activeTab === "requests" && s.tabBtnActive]} onPress={() => setActiveTab("requests")}>
            <Text style={[s.tabBtnText, activeTab === "requests" && s.tabBtnTextActive]}>Requests</Text>
            {totalRequestBadge > 0 && <View style={s.tabBadge}><Text style={{ color: "#fff", fontSize: 10 }}>{totalRequestBadge}</Text></View>}
          </TouchableOpacity>
        </View>

        {loading && Array.from({ length: 6 }).map((_, i) => <DmRowSkeleton key={i} />)}

        {!loading && activeTab === "inbox" && (
          <>
            {filteredConvos.length === 0 && <Text style={s.noConvText}>{search ? "No results." : "No conversations yet."}</Text>}
            {filteredConvos.map(convo => {
              if (convo.isGroup) {
                const accepted = (convo.members || []).filter(m => m.status === "accepted");
                const unread = convo.unreadCounts?.[currentUser._id] || 0;
                return (
                  <TouchableOpacity key={convo.chatId} style={s.dmItem} onPress={() => openConversation(convo)}>
                    <GroupAvatarStack members={accepted} size={46} />
                    <View style={s.dmInfo}>
                      <Text style={s.dmName}>{convo.name} <Text style={{ fontSize: 10, color: "#bbb", fontWeight: "500" }}>· Group</Text></Text>
                      <Text style={[s.dmLast, { color: unread > 0 ? "#111" : "#999", fontWeight: unread > 0 ? "700" : "400" }]} numberOfLines={1}>
                        {convo.lastMessageText || "No messages yet"}
                      </Text>
                    </View>
                    {unread > 0 && <View style={s.unreadBadge}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{unread}</Text></View>}
                  </TouchableOpacity>
                );
              }
              const user = convo.otherUser;
              const unread = convo.unreadCounts?.[currentUser._id] || 0;
              return (
                <TouchableOpacity key={convo.chatId} style={s.dmItem} onPress={() => openConversation(convo)}>
                  <View style={{ position: "relative" }}>
                    <Avatar user={user} size={46} />
                    {isOnline(user?._id) && <View style={s.onlineDot} />}
                  </View>
                  <View style={s.dmInfo}>
                    <Text style={s.dmName}>{user?.username}</Text>
                    <Text style={[s.dmLast, { color: unread > 0 ? "#111" : "#999", fontWeight: unread > 0 ? "700" : "400" }]} numberOfLines={1}>
                      {convo.lastMessageText || "Tap to message"}
                    </Text>
                  </View>
                  {unread > 0 && <View style={s.unreadBadge}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{unread}</Text></View>}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {!loading && activeTab === "requests" && (
          <>
            {requests.length === 0 && groupRequests.length === 0 && <Text style={s.noConvText}>No message requests.</Text>}

            {groupRequests.length > 0 && <Text style={s.sectionLabel}>Group Invites</Text>}
            {groupRequests.map(req => (
              <View key={req.chatId} style={s.dmItem}>
                <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "#e5e5e5", alignItems: "center", justifyContent: "center" }}><GroupIcon color="#999" /></View>
                <View style={s.dmInfo}>
                  <Text style={s.dmName}>{req.name}</Text>
                  <Text style={s.dmLast}>{req.invitedBy?.username ? `Invited by ${req.invitedBy.username}` : "Group invite"} · {req.memberCount} members</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <TouchableOpacity style={s.smallDeclineBtn} onPress={() => handleDeclineGroupInvite(req.chatId)}><Text style={{ fontSize: 12, color: "#666" }}>Decline</Text></TouchableOpacity>
                  <TouchableOpacity style={s.smallAcceptBtn} onPress={() => handleAcceptGroupInvite(req.chatId)}><Text style={{ fontSize: 12, color: "#fff" }}>Join</Text></TouchableOpacity>
                </View>
              </View>
            ))}

            {requests.length > 0 && <Text style={s.sectionLabel}>Messages</Text>}
            {requests.map(req => {
              const user = req.initiator;
              return (
                <TouchableOpacity key={req.chatId} style={s.dmItem} onPress={() => openRequest(req)}>
                  <Avatar user={user} size={46} />
                  <View style={s.dmInfo}>
                    <Text style={s.dmName}>{user?.username} {user?.isPrivate && "🔒"}</Text>
                    <Text style={s.dmLast} numberOfLines={1}>{req.lastMessageText || "Sent you a message"}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>

      {!openConv && <Navbar />}
      {openConv && openConv.isGroup && (
        <GroupChatWindow group={openConv} currentUser={currentUser} onRequestHandled={handleGroupExited} onClose={closeGroupChat} />
      )}
      {openConv && !openConv.isGroup && (
        <ChatWindow conversation={openConv} currentUser={currentUser} onlineUsers={onlineUsers} onRequestHandled={handleRequestHandled} onClose={closeChat} />
      )}
    </View>
  );
}

export default Messages;

/* ─── Styles ─── */
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },
  dmListWrap: { flex: 1 },
  dmHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#efefef" },
  dmTitle: { fontSize: 22, fontWeight: "700", color: "#111" },
  dmUsername: { fontSize: 13, color: "#888", marginTop: 2 },
  searchWrap: { position: "relative", marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
  searchIconWrap: { position: "absolute", left: 12, top: 12, zIndex: 1 },
  searchInput: { paddingVertical: 10, paddingLeft: 40, paddingRight: 16, backgroundColor: "#f2f2f2", borderRadius: 12, fontSize: 14, color: "#111" },
  tabsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f2f2f2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  tabBtnActive: { backgroundColor: "#111" },
  tabBtnText: { color: "#888", fontWeight: "600", fontSize: 13 },
  tabBtnTextActive: { color: "#fff" },
  tabBadge: { backgroundColor: "#e53935", borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: "#aaa", textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  dmItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, marginHorizontal: 6 },
  onlineDot: { position: "absolute", bottom: 1, right: 1, width: 13, height: 13, borderRadius: 7, backgroundColor: GOLDEN, borderWidth: 2, borderColor: "#fff" },
  onlineDotBig: { position: "absolute", bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: GOLDEN, borderWidth: 2, borderColor: "#fff" },
  dmInfo: { flex: 1, minWidth: 0 },
  dmName: { fontSize: 15, fontWeight: "600", color: "#111" },
  dmLast: { fontSize: 13, color: GOLDEN, marginTop: 2 },
  noConvText: { textAlign: "center", color: "#bbb", marginTop: 40, fontSize: 14 },
  unreadBadge: { backgroundColor: GOLDEN, borderRadius: 11, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  iconBtn: { padding: 8, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  composeMenu: { position: "absolute", top: 44, right: 0, backgroundColor: "#fff", borderRadius: 12, minWidth: 180, overflow: "hidden", elevation: 20, zIndex: 999, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 20 },
  composeItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  smallAcceptBtn: { backgroundColor: GOLDEN, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  smallDeclineBtn: { borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  chatOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#fff", zIndex: 100 },
  chatTopbar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#efefef", backgroundColor: "#fff" },
  topbarName: { fontSize: 15, fontWeight: "700", color: "#111" },
  topbarStatus: { fontSize: 12, marginTop: 1 },
  chatMessages: { flex: 1, backgroundColor: "#f0f2f5" },
  loadingText: { textAlign: "center", color: "#bbb", fontSize: 14 },
  emptyChat: { alignItems: "center", marginTop: 80, gap: 6 },
  emptyChatName: { fontSize: 17, fontWeight: "700", color: "#111" },
  emptyChatHint: { fontSize: 13, color: "#aaa", marginTop: 4 },
  typingBubble: { backgroundColor: "#fff", borderRadius: 22, borderBottomLeftRadius: 5, paddingHorizontal: 16, paddingVertical: 12, elevation: 1, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#f7f7f7", borderTopWidth: 1, borderTopColor: "#ececec" },
  replyBarAccent: { width: 3, minHeight: 36, borderRadius: 4, backgroundColor: "#3897f0" },
  replyBarName: { fontSize: 12, fontWeight: "700", color: "#3897f0" },
  replyBarText: { fontSize: 12, color: "#666", marginTop: 2 },
  chatInputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#efefef", backgroundColor: "#fff" },
  attachCircleBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "#e0e0e0", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  chatInput: { flex: 1, backgroundColor: "#f2f2f2", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: "#111", fontSize: 14 },
  sendCircleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#3897f0", alignItems: "center", justifyContent: "center" },
  attachMenu: { position: "absolute", bottom: 46, left: 0, backgroundColor: "#fff", borderRadius: 16, padding: 10, flexDirection: "row", gap: 4, elevation: 8, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 24, zIndex: 50 },
  attachOption: { alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  attachOptionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  attachOptionLabel: { fontSize: 11, color: "#555", fontWeight: "500", textAlign: "center" },
  dropMenu: { position: "absolute", top: 44, right: 0, backgroundColor: "#fff", borderRadius: 12, minWidth: 160, overflow: "hidden", elevation: 20, zIndex: 999, shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 20 },
  dropItem: { paddingHorizontal: 16, paddingVertical: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  // FIX: added explicit height alongside maxHeight — without a real
  // height, the flex:1 results list (forwardUserList) had no bounded
  // parent to expand into and collapsed to almost nothing, hiding the
  // fetched users below the search bar. Matches ShareSheet.js's working
  // pattern (height + maxHeight together).
  forwardModal: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "75%", maxHeight: "85%" },
  forwardModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  forwardModalTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  forwardSearchWrap: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  forwardSearchInput: { flex: 1, fontSize: 14, color: "#111" },
  forwardUserList: { flex: 1, paddingVertical: 6 },
  forwardUserItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
   wallpaperSheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "60%", maxHeight: "75%" },
  wallpaperGalleryBtn: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, backgroundColor: "#f7f7f7", borderWidth: 1, borderColor: "#ececec" },
  wallpaperSectionLabel: { fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  wallpaperSwatch: { width: 64, height: 64, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionSheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  actionSheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 8, paddingBottom: 24 },
  actionSheetBtn: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, paddingVertical: 14 },
  requestBanner: { alignItems: "center", padding: 32, marginTop: 40 },
  requestBannerName: { fontSize: 17, fontWeight: "700", marginTop: 12, color: "#111" },
  requestBannerText: { fontSize: 13, color: "#888", textAlign: "center", marginTop: 8, lineHeight: 19, maxWidth: 280 },
  declineBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fff", alignItems: "center" },
  acceptReqBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: "#3897f0", alignItems: "center" },
});

const mStyles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, elevation: 1, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4 },
  bubbleFailed: { borderWidth: 1.5, borderColor: "#e53935" },
  deletedBubble: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "#f0f0f0" },
  replyQuote: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  expiredMedia: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  likeBadge: { position: "absolute", bottom: -16, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 1, elevation: 3 },
  actionsRow: { flexDirection: "row", gap: 5, marginTop: 6, flexWrap: "wrap" },
  actionBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 2 },
  actionBtnLiked: { backgroundColor: "#fff0f0" },
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minWidth: 180, maxWidth: 220 },
  audioIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, borderRadius: 10, padding: 10, maxWidth: 240, borderWidth: 1 },
  fileIconBox: { width: 42, height: 48, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 13, fontWeight: "600" },
  fileMeta: { fontSize: 11.5, marginTop: 2 },
  downloadCircle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});