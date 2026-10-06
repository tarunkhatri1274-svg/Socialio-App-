// src/screens/ResetPassword.js
// src/screens/ResetPassword.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import Logo from "../../../logo";
import Config from "react-native-config";
import Icon from "react-native-vector-icons/Ionicons";
import { useNavigation, useRoute } from "@react-navigation/native";

const API = Config.API_URL;

const ResetPassword = () => {
  const navigation = useNavigation();
  const route = useRoute();

  const email = route.params?.email; // ✅ FIX: optional chaining instead of destructuring,
                                       // so a missing route.params doesn't throw immediately

  // ✅ FIX: guard against reaching this screen with no email (deep link,
  // stale nav state, app restored mid-flow, etc.)
  useEffect(() => {
    if (!email) {
      Alert.alert(
        "Session expired",
        "Please start the password reset process again."
      );
      navigation.replace("ForgotPassword");
    }
  }, [email, navigation]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const handleResetPassword = async () => {
    if (password.length < 6) {
      Alert.alert(
        "Password",
        "Password must be at least 6 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        "Password",
        "Passwords do not match."
      );
      return;
    }

    try {
      setIsResettingPassword(true);

      const response = await fetch(
        `${API}/auth/reset-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            newPassword: password,
          }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        Alert.alert(
          "Success",
          "Password reset successfully.",
          [
            {
              text: "OK",
              onPress: () =>
                navigation.replace("Login"),
            },
          ]
        );
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (error) {
      console.log(error);
      Alert.alert(
        "Error",
        "Something went wrong."
      );
    } finally {
      setIsResettingPassword(false);
    }
  };

  // ✅ FIX: don't render the form at all while redirecting away
  if (!email) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={
        Platform.OS === "ios" ? "padding" : undefined
      }
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>

          <View style={styles.logoWrap}>
            <Logo />
          </View>

          <Text style={styles.title}>
            Reset Password
          </Text>

          <Text style={styles.subtitle}>
            Create a new password for your account.
          </Text>

          {/* Password */}

          <View style={styles.inputContainer}>
            <Icon
              name="lock-closed-outline"
              size={22}
              color="#777"
              style={styles.icon}
            />

            <TextInput
              placeholder="New Password"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              style={styles.input}
              editable={!isResettingPassword}
            />

            <TouchableOpacity
              onPress={() =>
                setShowPassword(!showPassword)
              }
            >
              <Icon
                name={
                  showPassword
                    ? "eye-off-outline"
                    : "eye-outline"
                }
                size={22}
                color="#777"
              />
            </TouchableOpacity>
          </View>

          {/* Confirm Password */}

          <View style={styles.inputContainer}>
            <Icon
              name="lock-closed-outline"
              size={22}
              color="#777"
              style={styles.icon}
            />

            <TextInput
              placeholder="Confirm Password"
              placeholderTextColor="#888"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              style={styles.input}
              editable={!isResettingPassword}
            />

            <TouchableOpacity
              onPress={() =>
                setShowConfirmPassword(
                  !showConfirmPassword
                )
              }
            >
              <Icon
                name={
                  showConfirmPassword
                    ? "eye-off-outline"
                    : "eye-outline"
                }
                size={22}
                color="#777"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, isResettingPassword && styles.buttonDisabled]}
            onPress={handleResetPassword}
            disabled={isResettingPassword}
          >
            {isResettingPassword ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Resetting Password...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>
                Reset Password
              </Text>
            )}
          </TouchableOpacity>

        </View>

      </ScrollView>

    </KeyboardAvoidingView>
  );
};

export default ResetPassword;
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EAB676",
  },

  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  card: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 25,
    paddingVertical: 35,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },

  logoWrap: {
    alignItems: "center",
    marginBottom: 10,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
  },

  subtitle: {
    marginTop: 10,
    marginBottom: 30,
    textAlign: "center",
    color: "#666",
    fontSize: 15,
    lineHeight: 22,
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 12,
    backgroundColor: "#FAFAFA",
    paddingHorizontal: 15,
    marginBottom: 20,
  },

  icon: {
    marginRight: 10,
  },

  input: {
    flex: 1,
    fontSize: 16,
    color: "#222",
    paddingVertical: 15,
  },

  button: {
    marginTop: 10,
    backgroundColor: "#EAB676",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 15,
    elevation: 3,
  },

  buttonDisabled: {
    opacity: 0.7,
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  buttonText: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "bold",
  },
});