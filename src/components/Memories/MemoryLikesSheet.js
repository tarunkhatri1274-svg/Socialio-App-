import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  StyleSheet,
} from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import { apiFetch } from "../../api/authToken";
import Config from "react-native-config";
import { useNavigation } from "@react-navigation/native";
import socket from "../../sockets/Sockets";

const API = Config.API_URL;


function MemoryLikesSheet({ itemId, onClose }) {
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [likers, setLikers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLikers = async (q = "") => {
    try {
      const res = await apiFetch(`${API}/memories/items/${itemId}/likers?q=${encodeURIComponent(q)}`, {
    
      });
      const data = await res.json();
      if (data.success) setLikers(data.likers);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLikers();
  }, [itemId]);

  useEffect(() => {
    const t = setTimeout(() => fetchLikers(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!itemId) return;
    const handler = () => fetchLikers(search);
    socket.on(`memoryItem:${itemId}:likes`, handler);
    return () => socket.off(`memoryItem:${itemId}:likes`, handler);
  }, [itemId, search]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.box}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Likes</Text>
            <TouchableOpacity onPress={onClose}>
              <FeatherIcon name="x" size={20} color="#111" />
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />

          <View style={styles.searchWrap}>
            <FeatherIcon name="search" size={15} color="#999" style={{ marginLeft: 10 }} />
            <TextInput
              placeholder="Search"
              placeholderTextColor="#999"
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} style={{ marginRight: 10 }}>
                <FeatherIcon name="x" size={15} color="#999" />
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <Text style={styles.emptyText}>Loading...</Text>
          ) : likers.length === 0 ? (
            <Text style={styles.emptyText}>No likes yet</Text>
          ) : (
            <ScrollView>
              {likers.map((u) => (
                <TouchableOpacity
                  key={u._id}
                  style={styles.row}
                  onPress={() => {
                    onClose();
                    navigation.navigate("Profile", { userId: u._id });
                  }}
                >
                  {u.profilePic ? (
                    <Image source={{ uri: u.profilePic }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={{ fontWeight: "700", color: "#888" }}>
                        {u.username?.[0]?.toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.username}>{u.username}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default MemoryLikesSheet;

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
    maxHeight: "70%",
    padding: 16,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  divider: { borderTopWidth: 1, borderTopColor: "#eee", marginBottom: 10 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
    borderRadius: 10,
    marginBottom: 12,
    gap: 6,
  },
  searchInput: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, fontSize: 14 },
  emptyText: { textAlign: "center", color: "#aaa", fontSize: 14, paddingVertical: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { backgroundColor: "#ddd", alignItems: "center", justifyContent: "center" },
  username: { flex: 1, fontSize: 14, fontWeight: "500" },
});