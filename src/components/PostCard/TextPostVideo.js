import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  PermissionsAndroid,
  StyleSheet,
} from "react-native";
import Video from "react-native-video";
import FeatherIcon from "react-native-vector-icons/Feather";
import Config from "react-native-config";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { apiFetch } from "../../api/authToken";
import socket from "../../sockets/Sockets";
import { recordPostView } from "../State/ViewStore";
import { saveMediaToGallery } from "../../utils/saveToGallery";


const API = Config.API_URL;

function formatCount(num) {
  const n = Number(num) || 0;
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
}



async function requestSavePermission() {
  if (Platform.OS !== "android") return true;
  if (Platform.Version >= 33) return true;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE, {
    title: "Storage permission",
    message: "Allow access to save this video to your gallery.",
    buttonPositive: "Allow",
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}





/**
 * Video tile for TEXT posts. Same size as the image tile next to it, plays
 * with resizeMode="contain", and carries pause / mute / views / download
 * buttons inside it (white icons, no background boxes, count underneath —
 * the same look as the buttons in UserProfileVideoPost).
 *
 * Props
 *  - post, media          the post and this video's media item
 *  - width, height        numeric size (pass the same numbers as the image tile)
 *  - isOwner              owner can always download
 *  - isVisible            optional. Pass it from a FlatList viewability callback
 *                         for autoplay-while-visible. When omitted (plain
 *                         ScrollView screens) the video starts paused and the
 *                         user taps play.
 *  - onPress              tap on the video surface (used for double-tap like)
 */
function TextPostVideo({ post, media, width, height = 240, isOwner = false, isVisible, onPress, style }) {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const autoMode = isVisible !== undefined;

  const [userPaused, setUserPaused] = useState(!autoMode);
  const [muted, setMuted] = useState(true);
  const [viewsCount, setViewsCount] = useState(post?.viewsCount ?? post?.views?.length ?? 0);

  const [downloadCount, setDownloadCount] = useState(post?.downloadsCount || post?.downloads?.length || 0);
  const isDownloadingRef = useRef(false);
  const recordedRef = useRef(false);

  const canDownload = !post?.disableDownload || isOwner;
  const url = media?.url || "";

  // In auto mode a video that scrolls back into view starts fresh.
  useEffect(() => {
    if (autoMode && isVisible) setUserPaused(false);
  }, [autoMode, isVisible]);

  const paused = !isFocused || (autoMode && !isVisible) || userPaused;

  // One view per post per session (ViewStore dedupes across every page).
  useEffect(() => {
    if (!paused && !recordedRef.current && post?._id) {
      recordedRef.current = true;
      recordPostView(post._id);
    }
  }, [paused, post?._id]);

  // Live view count + viewers list.
  // Live view count only
  useEffect(() => {
    if (!post?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API}/auth/views/posts/${post._id}/views-count`);
        const data = await res.json();
        if (!cancelled && res.ok && data.totalViews != null) setViewsCount(data.totalViews);
      } catch {}
    })();
    const onViews = ({ totalViews }) => {
      if (totalViews != null) setViewsCount(totalViews);
    };
    socket.on(`post:${post._id}:views`, onViews);
    return () => {
      cancelled = true;
      socket.off(`post:${post._id}:views`, onViews);
    };
  }, [post?._id]);

  const handleDownload = async () => {
    if (!canDownload || isDownloadingRef.current || !url) return;
    isDownloadingRef.current = true;
    try {
      const ok = await requestSavePermission();
      if (!ok) {
        Alert.alert("Permission needed", "Storage access is required to save this video.");
        return;
      }
      await saveMediaToGallery(url, { isVideo: true, name: `${post?._id || "video"}_${Date.now()}` });
      setDownloadCount((c) => c + 1);
      Alert.alert("Saved", "Video saved to your gallery.");
    } catch (err) {
      console.log("[download-text-video] failed:", err?.message);
      Alert.alert("Download failed", "Something went wrong while saving this video.");
    } finally {
      isDownloadingRef.current = false;
    }
  };



  const source = useMemo(() => (url ? { uri: url } : undefined), [url]);
  const togglePause = useCallback(() => setUserPaused((p) => !p), []);

  return (
    <>
      <View style={[styles.box, { width, height }, style]}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onPress}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
            <Video
              source={source}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              repeat
              muted={muted}
              paused={paused}
              onError={(e) => console.log("[text-post video error]", JSON.stringify(e))}
            />
          </View>
        </TouchableOpacity>

        <View style={styles.actions} pointerEvents="box-none">
          <TouchableOpacity style={styles.actionBtn} onPress={togglePause}>
            <FeatherIcon name={paused ? "play" : "pause"} size={22} color="#fff" style={styles.icon} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => setMuted((m) => !m)}>
            <FeatherIcon name={muted ? "volume-x" : "volume-2"} size={22} color="#fff" style={styles.icon} />
          </TouchableOpacity>

          <View style={styles.actionCol}>
            <FeatherIcon name="eye" size={22} color="#fff" style={styles.icon} />
            <Text style={styles.actionLabel}>{formatCount(viewsCount)}</Text>
          </View>

          {canDownload && (
            <View style={styles.actionCol}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleDownload}>
                <FeatherIcon name="download" size={22} color="#fff" style={styles.icon} />
              </TouchableOpacity>
              {downloadCount > 0 && <Text style={styles.actionLabel}>{formatCount(downloadCount)}</Text>}
            </View>
          )}
        </View>
      </View>

     
    </>
  );
}

export default TextPostVideo;

const styles = StyleSheet.create({
  box: { backgroundColor: "#000", borderRadius: 14, overflow: "hidden", marginRight: 8 },
  actions: { position: "absolute", right: 8, bottom: 10, alignItems: "center", gap: 12 },
  actionCol: { alignItems: "center", gap: 2 },
  actionBtn: { alignItems: "center", justifyContent: "center", padding: 2 },
  icon: { textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  actionLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0f0f0", borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  empty: { textAlign: "center", color: "#aaa", paddingVertical: 32, fontSize: 15 },
});