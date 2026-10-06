import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import Config from "react-native-config";
import { useNavigation } from "@react-navigation/native";
import { clearSocketState } from "../../sockets/Sockets";
import { clearDeviceToken } from "../Activity/PushNotifications"; // adjust path to match PushNotifications.js's real location
import { apiFetch, useAuth } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL;

function Settings() {
  const navigation = useNavigation();
  const { clearAuth } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  const handleDeleteAccount = () => navigation.navigate("DeleteAccount");
  const changepassword = () => navigation.navigate("ChangePassword");
  const privacytoggle = () => navigation.navigate("Privacy");
  const notificationsettings = () => navigation.navigate("NotificationSettings");
  const blocked = () => navigation.navigate("Blocked");

  const handleLogout = async () => {
    setError("");
    setLoggingOut(true);
    try {
      await apiFetch(`${API}/auth/logout`, { method: "POST" });
    } catch (err) {
      // Even if the request fails, still log the user out locally
      console.log("Logout request failed:", err.message);
    } finally {
      // FIX — this used to only remove AsyncStorage's token/user, which
      // left the socket connected, Sockets.js's in-memory caches
      // (cachedUserId, activeChatId, notifSettings) stale, and — most
      // importantly — this device's FCM push token still registered
      // against the account being logged out on the backend. Clearing
      // the device token FIRST (while the auth token is still valid,
      // since it's needed to authenticate that request), then tearing
      // down the socket, then finally clearing AsyncStorage, so a
      // different account logging in on this same phone afterward
      // doesn't inherit stale socket state or receive this account's
      // push notifications.
      await clearDeviceToken();
      clearSocketState();
      await clearAuth();
      setLoggingOut(false);
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Account Settings</Text>

        <TouchableOpacity onPress={handleDeleteAccount} style={styles.btn}>
          <Text style={styles.btnText}>Delete Account</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={changepassword} style={styles.btn}>
          <Text style={styles.btnText}>Change Password</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={privacytoggle} style={styles.btn}>
          <Text style={styles.btnText}>Privacy Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={blocked} style={styles.btn}>
          <Text style={styles.btnText}>Blocked Accounts</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={notificationsettings} style={styles.btn}>
          <Text style={styles.btnText}>Notification Settings</Text>
        </TouchableOpacity>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          onPress={handleLogout}
          disabled={loggingOut}
          style={[styles.btn, styles.logoutBtn, { opacity: loggingOut ? 0.7 : 1 }]}
        >
          {loggingOut ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <ActivityIndicator size="small" color="#b91c1c" />
              <Text style={styles.logoutBtnText}>Logging out...</Text>
            </View>
          ) : (
            <Text style={styles.logoutBtnText}>Log Out</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f2f5",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginBottom: 20,
  },
  btn: {
    width: "100%",
    paddingVertical: 12,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: "#e4e6eb",
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 14,
    color: "#222",
  },
  logoutBtn: {
    backgroundColor: "#fddede",
  },
  logoutBtnText: {
    color: "#b91c1c",
    fontWeight: "700",
    fontSize: 14,
  },
  errorText: {
    color: "red",
    fontSize: 13,
    marginBottom: 10,
  },
});

export default Settings;