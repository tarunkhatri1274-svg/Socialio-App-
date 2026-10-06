import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  ScrollView,
  Switch,
  StyleSheet,
} from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import { launchImageLibrary } from "react-native-image-picker";
import Video from "react-native-video";
import { apiFetch } from "../../api/authToken";
import Config from "react-native-config";

const API = Config.API_URL;
function CreateMemoryModal({ mode = "group", groupId, groupName, onClose, onGroupCreated, onItemsAdded }) {
  const [files, setFiles] = useState([]); // [{ uri, type, fileName, isVideo }]
  const [name, setName] = useState("");
  const [disableComments, setDisableComments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handlePick = async () => {
    const result = await launchImageLibrary({
      mediaType: "mixed",
      selectionLimit: 0, // 0 = unlimited, matches the web version's multi-select
      quality: 0.9,
    });
    if (result.didCancel || !result.assets?.length) return;

    const mapped = result.assets.map((a) => ({
      uri: a.uri,
      type: a.type || (a.uri?.endsWith(".mp4") ? "video/mp4" : "image/jpeg"),
      fileName: a.fileName || `upload-${Date.now()}`,
      isVideo: (a.type || "").startsWith("video/"),
    }));
    setFiles((prev) => [...prev, ...mapped]);
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setError("Choose at least one photo or video");
      return;
    }
    if (mode === "group" && !name.trim()) {
      setError("Give your memory a name");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      files.forEach((f) => {
        // RN's fetch/FormData expects { uri, type, name } objects for file
        // parts, not raw File/Blob objects like the browser's <input type="file">.
        form.append("media", { uri: f.uri, type: f.type, name: f.fileName });
      });
      form.append("disableComments", disableComments ? "true" : "false");
      if (mode === "group") form.append("name", name.trim());

      const url = mode === "group" ? `${API}/memories/groups` : `${API}/memories/groups/${groupId}/items`;

      const res = await apiFetch(url, {
        method: "POST",
       
        body: form,
      });
      const data = await res.json();
      if (data.success) {
        if (mode === "group") onGroupCreated?.(data.group);
        else onItemsAdded?.(data.items);
        onClose();
      } else {
        setError(data.message || "Couldn't save memory");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.box}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{mode === "group" ? "Add Memory" : "Add to Memory"}</Text>
            <TouchableOpacity onPress={onClose}>
              <FeatherIcon name="x" size={20} color="#111" />
            </TouchableOpacity>
          </View>

          {/* Explicit confirmation of WHICH group this goes into, so it's
              never ambiguous that "item" mode adds here rather than
              creating something new. */}
          {mode === "item" && (
            <Text style={styles.addingToText}>
              Adding to: <Text style={{ color: "#111", fontWeight: "700" }}>{groupName || "this memory"}</Text>
            </Text>
          )}
          {mode === "group" && <View style={{ marginBottom: 8 }} />}

          {/* Thumbnail strip of everything picked so far */}
          <View style={styles.strip}>
            {files.map((f, i) => (
              <View key={i} style={styles.thumbWrap}>
                {f.isVideo ? (
                  <Video source={{ uri: f.uri }} style={styles.thumb} muted paused resizeMode="cover" />
                ) : (
                  <Image source={{ uri: f.uri }} style={styles.thumb} />
                )}
                <TouchableOpacity style={styles.removeBtn} onPress={() => removeFile(i)}>
                  <FeatherIcon name="x" size={12} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addThumb} onPress={handlePick}>
              <FeatherIcon name={files.length === 0 ? "image" : "plus"} size={22} color="#999" />
            </TouchableOpacity>
          </View>
          {files.length === 0 && (
            <Text style={styles.hintText}>Tap the box to choose one or more photos/videos.</Text>
          )}

          {mode === "group" && (
            <TextInput
              placeholder="Name this memory (e.g. Travel, Friends)"
              placeholderTextColor="#999"
              value={name}
              maxLength={40}
              onChangeText={setName}
              style={styles.nameInput}
            />
          )}

          <TouchableOpacity
            style={styles.checkboxRow}
            activeOpacity={0.7}
            onPress={() => setDisableComments((v) => !v)}
          >
            <Switch value={disableComments} onValueChange={setDisableComments} />
            <Text style={styles.checkboxLabel}>
              Turn off commenting on {files.length > 1 ? "these memories" : "this memory"}
            </Text>
          </TouchableOpacity>

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.submitBtn, saving && { backgroundColor: "#8fc9fb" }]}
            disabled={saving}
            onPress={handleSubmit}
          >
            <Text style={styles.submitBtnText}>
              {saving
                ? "Saving..."
                : mode === "group"
                ? `Add Memory${files.length > 1 ? ` (${files.length})` : ""}`
                : `Add${files.length > 1 ? ` ${files.length}` : ""}`}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default CreateMemoryModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  box: {
    backgroundColor: "#fff",
    borderRadius: 16,
    width: "100%",
    maxWidth: 380,
    padding: 18,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  addingToText: { marginBottom: 12, fontSize: 13, color: "#666" },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  thumbWrap: { position: "relative", width: 74, height: 74, borderRadius: 10, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  removeBtn: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  addThumb: {
    width: 74,
    height: 74,
    borderRadius: 10,
    backgroundColor: "#fafafa",
    borderWidth: 1.5,
    borderColor: "#ddd",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  hintText: { fontSize: 12.5, color: "#999", marginBottom: 14 },
  nameInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e2e2e2",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 4,
  },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 4 },
  checkboxLabel: { fontSize: 13.5, color: "#444", flexShrink: 1 },
  errorText: { color: "#e0245e", fontSize: 13, marginTop: 6 },
  submitBtn: {
    width: "100%",
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0095f6",
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});