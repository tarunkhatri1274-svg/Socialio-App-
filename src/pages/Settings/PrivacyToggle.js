import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL;

function PrivacyToggle() {
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── load real privacy state on mount ──
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await apiFetch(`${API}/auth/profile`);

        const data = await res.json();

        if (data.success) {
          setIsPrivate(data.user.isPrivate);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  // ── toggle privacy ──
  const togglePrivacy = async () => {
    try {
      const res = await apiFetch(`${API}/auth/private/toggle`, { method: "PATCH" });

      const data = await res.json();

      if (data.success) {
        setIsPrivate(data.isPrivate);
      }
    } catch (err) {
      console.error("Error toggling privacy:", err);
    }
  };

  // ── loading state — plain View, no dependency on the styles object
  // below (which is fine here since `styles` is a top-level constant,
  // not computed per-render off `isPrivate`) ──
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Privacy Settings</Text>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="rgb(234,182,118)" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Privacy Settings</Text>

        <View style={styles.row}>
          <Text style={styles.text}>
            {isPrivate ? "Private Account 🔒" : "Public Account 🌐"}
          </Text>

          <AnimatedToggle value={isPrivate} onToggle={togglePrivacy} />
        </View>
      </View>
    </View>
  );
}

// ── Animated switch, mirrors the web toggle's translateX/color transition ──
function AnimatedToggle({ value, onToggle }) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#ccc", "rgb(234,182,118)"],
  });
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 30],
  });

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onToggle}>
      <Animated.View style={[styles.toggle, { backgroundColor: bg }]}>
        <Animated.View style={[styles.circle, { transform: [{ translateX }] }]} />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = {
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
    alignItems: "center",
  },
  title: {
    marginBottom: 20,
    color: "#333",
    fontWeight: "bold",
    fontSize: 22,
    textAlign: "center",
  },
  loadingWrap: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 30,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: "100%",
  },
  text: {
    fontWeight: "bold",
    fontSize: 14,
  },
  toggle: {
    width: 60,
    height: 30,
    borderRadius: 15,
    padding: 5,
    justifyContent: "center",
  },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
};

export default PrivacyToggle;