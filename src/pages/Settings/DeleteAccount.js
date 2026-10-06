import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import Config from "react-native-config";
import { useNavigation } from "@react-navigation/native";
import { clearSocketState } from "../../sockets/Sockets";
import { apiFetch, useAuth } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL;

function DeleteAccount() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const navigation = useNavigation();
  const { clearAuth } = useAuth();

  const handleDelete = async () => {
    if (password !== confirmPassword) {
      Alert.alert("", "Passwords do not match!");
      return;
    }

    setIsDeleting(true);
    try {
      const response = await apiFetch(`${API}/auth/delete-account`, {
        method: "DELETE",
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        // No separate clearDeviceToken() call needed here (unlike
        // Settings.js's logout) — the backend deleting the whole user
        // document removes its fcmToken field along with everything
        // else, so there's nothing left to point stale pushes at. Just
        // tear down local state.
        clearSocketState();
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      } else {
        Alert.alert("", data.message);
      }
    } catch (error) {
      console.error("Error deleting account:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Delete Account</Text>

        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="enter username"
          placeholderTextColor="#999"
          style={styles.input}
          editable={!isDeleting}
          autoCapitalize="none"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="enter password"
          placeholderTextColor="#999"
          secureTextEntry
          style={styles.input}
          editable={!isDeleting}
        />
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="confirm password"
          placeholderTextColor="#999"
          secureTextEntry
          style={styles.input}
          editable={!isDeleting}
        />

        <TouchableOpacity
          style={[styles.btn, { opacity: isDeleting ? 0.7 : 1 }]}
          onPress={handleDelete}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <ActivityIndicator size="small" color="#333" />
              <Text style={styles.btnText}>Deleting Account...</Text>
            </View>
          ) : (
            <Text style={styles.btnText}>Delete Account</Text>
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
    backgroundColor: "#f5f5f5",
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
    marginBottom: 20,
    fontSize: 22,
    fontWeight: "700",
    color: "#222",
  },
  input: {
    width: "100%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    fontSize: 14,
    color: "#333",
    backgroundColor: "#fafafa",
  },
  btn: {
    width: "100%",
    paddingVertical: 12,
    marginTop: 4,
    backgroundColor: "#e8e8e8",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 15,
    color: "#333",
    fontWeight: "500",
  },
});

export default DeleteAccount;