import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet } from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import { apiFetch, getCachedUser } from "../../api/authToken";
import Config from "react-native-config";
import MemoryCommentSection from "./MemoryCommentSection";

const API = Config.API_URL;

function MemoryCommentsSheet({ itemId, disableComments, onClose, highlightCommentId = null, highlightReplyId = null }) {
  const [currentUser, setCurrentUser] = useState({});
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = React.useRef(null);

  useEffect(() => {
    getCachedUser().then(setCurrentUser);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch(`${API}/memories/items/${itemId}/comments`);
        const data = await res.json();
        if (data.success) setComments(data.comments);
      } catch {
        /* non-fatal */
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [itemId]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.box}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Comments</Text>
            <TouchableOpacity onPress={onClose}>
              <FeatherIcon name="x" size={20} color="#111" />
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />

          {loading ? (
            <Text style={styles.loadingText}>Loading...</Text>
          ) : (
            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled">
              <MemoryCommentSection
                comments={comments}
                setComments={setComments}
                currentUser={currentUser}
                itemId={itemId}
                disableComments={disableComments}
                highlightCommentId={highlightCommentId}
                highlightReplyId={highlightReplyId}
                scrollRef={scrollRef}
              />
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default MemoryCommentsSheet;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  box: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: "100%",
    maxWidth: 420,
    maxHeight: "82%",
    padding: 16,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  divider: { borderTopWidth: 1, borderTopColor: "#eee", marginBottom: 10 },
  loadingText: { textAlign: "center", color: "#aaa", fontSize: 14, paddingVertical: 20 },
});