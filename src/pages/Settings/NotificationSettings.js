import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL;

function NotificationSettings() {
  const [settings, setSettings] = useState({
    message: true,
    post: true,
    reel: true,
    story: true,
    text: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Load saved settings on mount ───────────────────────────────────
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await apiFetch(`${API}/auth/notifications/settings/`);

        if (!res.ok) throw new Error("Failed to load settings");

        const data = await res.json();
        const loaded = {
          message: data.settings.message,
          post: data.settings.post,
          reel: data.settings.reel,
          story: data.settings.story,
          text: data.settings.text,
        };
        setSettings(loaded);
        await AsyncStorage.setItem("notifSettings", JSON.stringify(loaded));
      } catch (err) {
        console.error("Failed to fetch notification settings:", err);
        setError("Couldn't load your settings. Showing defaults.");
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  // ── Toggle + persist ────────────────────────────────────────────────
  const toggleSwitch = async (key) => {
    const newValue = !settings[key];
    const updated = { ...settings, [key]: newValue };
    setSettings(updated);
    await AsyncStorage.setItem("notifSettings", JSON.stringify(updated));
    setError("");

    try {
      const res = await apiFetch(`${API}/auth/notifications/settings/`, {
        method: "PUT",
        body: JSON.stringify({ key, value: newValue }),
      });

      if (!res.ok) throw new Error("Failed to save");
    } catch (err) {
      console.error("Failed to update setting:", err);
      setError("Couldn't save that change. Reverted.");
      setSettings((prev) => ({ ...prev, [key]: !newValue }));
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Notification Settings</Text>
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
        <Text style={styles.title}>Notification Settings</Text>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {Object.keys(settings).map((key) => (
          <ToggleRow
            key={key}
            label={capitalize(key)}
            value={settings[key]}
            onToggle={() => toggleSwitch(key)}
          />
        ))}
      </View>
    </View>
  );
}

// ── Animated switch row ──────────────────────────────────────────────
function ToggleRow({ label, value, onToggle }) {
  const anim = React.useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#ccc", "rgb(234,182,118)"],
  });
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 26],
  });

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity activeOpacity={0.8} onPress={onToggle}>
        <Animated.View style={[styles.toggle, { backgroundColor: bg }]}>
          <Animated.View style={[styles.circle, { transform: [{ translateX }] }]} />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

const styles = {
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  card: {
    width: 320,
    backgroundColor: "#fff",
    padding: 24,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    textAlign: "center",
    marginBottom: 20,
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
  },
  loadingWrap: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 30,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  label: { fontWeight: "500", fontSize: 14, color: "#111" },
  toggle: {
    width: 50,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
  },
  circle: {
    width: 22,
    height: 22,
    backgroundColor: "#fff",
    borderRadius: 11,
    position: "absolute",
  },
  errorText: {
    color: "#c0392b",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
};

export default NotificationSettings;