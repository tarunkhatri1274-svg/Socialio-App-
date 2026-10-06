import React, { useState, useEffect } from "react";
import { View, Text, Image, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import FeatherIcon from "react-native-vector-icons/Feather";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path
import { DmRowSkeleton } from "../../components/Skeleton/Skeleton";

const API = Config.API_URL;

function BlockedAccounts() {
  const navigation = useNavigation();
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch blocked users from backend ──────────────────────────────────
  useEffect(() => {
    const fetchBlockedUsers = async () => {
      try {
        const res = await apiFetch(`${API}/auth/blocked-users`);
        const data = await res.json();
        if (data.success) {
          setBlockedUsers(data.blockedUsers);
        } else {
          console.error(data.message);
        }
      } catch (err) {
        console.error("Failed to fetch blocked users:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchBlockedUsers();
  }, []);

  // ── Unblock ─────────────────────────────────────────────────────────────
  const handleUnblock = async (userId) => {
    try {
      const res = await apiFetch(`${API}/auth/unblock/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setBlockedUsers((prev) => prev.filter((u) => u._id !== userId));
      } else {
        console.error(data.message);
      }
    } catch (err) {
      console.error("Unblock failed:", err);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <FeatherIcon
            name="arrow-left"
            size={22}
            color="#111"
            onPress={() => navigation.goBack()}
          />
          <Text style={styles.topBarTitle}>Blocked Accounts</Text>
          <View style={{ width: 22 }} />
        </View>
        {Array.from({ length: 6 }).map((_, i) => (
          <DmRowSkeleton key={i} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <FeatherIcon name="arrow-left" size={22} color="#111" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Blocked Accounts</Text>
        <View style={{ width: 22 }} />
      </View>

      {blockedUsers.length === 0 ? (
        <Text style={styles.empty}>No blocked users</Text>
      ) : (
        blockedUsers.map((user) => (
          <View key={user._id} style={styles.card}>
            <View style={styles.userInfo}>
              {user.profilePic ? (
                <Image source={{ uri: user.profilePic }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>
                    {user.username?.[0]?.toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.username}>{user.username}</Text>
            </View>
            <TouchableOpacity
              style={styles.unblockBtn}
              onPress={() => handleUnblock(user._id)}
            >
              <Text style={styles.unblockBtnText}>Unblock</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

export default BlockedAccounts;

const styles = {
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    backgroundColor: "#fff",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  topBarTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  userInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#c0c0c0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { fontWeight: "700", fontSize: 18, color: "#fff" },
  username: { fontWeight: "600", fontSize: 14, color: "#111" },
  unblockBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: "#ff4d4f",
    borderRadius: 8,
  },
  unblockBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  empty: { textAlign: "center", color: "gray", marginTop: 40 },
};