import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Linking,
  StatusBar,
  Dimensions,
} from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
// Same helper HomePage uses -> saves into the "Socialio" album in the gallery,
// so profile / cover downloads land in the same folder as post downloads.
import { saveMediaToGallery } from "../../utils/saveToGallery";

// Location: src/pages/Profile/ImageViewerModal.js

const TOP_INSET = Platform.OS === "android" ? (StatusBar.currentHeight || 24) : 50;

export default function ImageViewerModal({ visible, uri, onClose, kind = "image" }) {
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [size, setSize] = useState(Dimensions.get("window"));

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setSize(window));
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (visible) setLoaded(false);
  }, [visible, uri]);

  const handleDownload = async () => {
    if (!uri || saving) return;
    setSaving(true);
    try {
      await saveMediaToGallery(uri, { isVideo: false, name: `socialio_${kind}_${Date.now()}` });
      Alert.alert("Saved", "Image saved to your gallery.");
    } catch (err) {
      console.log("Download failed:", err?.message);
      Alert.alert("Download failed", "Couldn't save the image. Open it in browser instead?", [
        { text: "Cancel", style: "cancel" },
        { text: "Open", onPress: () => Linking.openURL(uri).catch(() => {}) },
      ]);
    } finally {
      setSaving(false);
    }
  };

  if (!uri) return null;

  return (
    <Modal
      visible={!!visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <View style={[styles.root, { width: size.width, height: size.height }]}>
        <StatusBar backgroundColor="#000" barStyle="light-content" translucent />

        {/* Image, centered, fits the screen without cropping */}
        <View style={styles.imageArea}>
          <Image
            source={{ uri }}
            style={{ width: size.width, height: size.height * 0.75 }}
            resizeMode="contain"
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
          {!loaded && <ActivityIndicator color="#fff" size="large" style={StyleSheet.absoluteFill} />}
        </View>

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: TOP_INSET + 8 }]}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={12} activeOpacity={0.7}>
            <FeatherIcon name="x" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Bottom action bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            onPress={handleDownload}
            disabled={saving}
            style={[styles.downloadBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <FeatherIcon name="download" size={18} color="#fff" />}
            <Text style={styles.downloadText}>{saving ? "Saving..." : "Download"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#000" },
  imageArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingBottom: Platform.OS === "ios" ? 40 : 28,
    paddingTop: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  downloadText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});