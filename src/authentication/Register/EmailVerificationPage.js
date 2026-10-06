// EmailVerificationPage.js
// EmailVerificationPage.js
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import { initPushNotifications } from "../../pages/Activity/PushNotifications"
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { saveAuthSession, useAuth } from "../../api/authToken"
import Logo from "../../../logo"; // adjust path to your RN Logo component
import Config from "react-native-config"; // For environment variables
import { initSocket } from "../../sockets/Sockets";
const API = Config.API_URL;

// ── GoogleSignin.configure() was removed from here — it used to run at
// module-load time (as soon as this file was imported, even if the user
// never visited this screen). Configuration now happens exactly once,
// in index.js, before any screen mounts. This file just calls
// GoogleSignin.signIn() directly.

function EmailVerifyPage() {
  const { refreshAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isGoogleSigningUp, setIsGoogleSigningUp] = useState(false);
  const navigation = useNavigation();

  const handleSendOtp = async () => {
    setIsSendingOtp(true);
    try {
      const response = await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        navigation.navigate("VerifyOtp", { email });
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (error) {
      console.error("Error sending OTP:", error);
      Alert.alert("Error", "Failed to send OTP. Please try again.");
    } finally {
      setIsSendingOtp(false);
    }
  };

const handleGoogleSignup = async () => {
    setIsGoogleSigningUp(true);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken || userInfo.idToken;

      const response = await fetch(`${API}/auth/google-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.registered) {
          // Existing full account -> log straight in
          await saveAuthSession(data);
          await refreshAuth();

          // Connect socket with the token before navigating to Home.
await initSocket();
await initPushNotifications();

navigation.reset({
  index: 0,
  routes: [{ name: "MainTabs", params: { screen: "Home" } }],
});
        } else {
          // Email verified via Google, but still needs username/password
          navigation.navigate("RegisterUser", { email: data.email });
        }
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (error) {
      console.error("Google signup error:", error);
      Alert.alert("Error", "Google signup failed. Please try again.");
    } finally {
      setIsGoogleSigningUp(false);
    }
  };

  return (
    <LinearGradient
      colors={["#eab676", "#f5d3a2"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.background}
    >
      <SafeAreaView style={styles.centerWrap}>
        <View style={styles.card}>
          <View style={styles.logoWrap}>
            <Logo />
          </View>

          <Text style={styles.title}>Verify Email</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!isSendingOtp}
          />

          <TouchableOpacity
            style={[styles.sendButton, isSendingOtp && styles.buttonDisabled]}
            onPress={handleSendOtp}
            disabled={isSendingOtp}
          >
            {isSendingOtp ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.sendButtonText}>Sending OTP...</Text>
              </View>
            ) : (
              <Text style={styles.sendButtonText}>Send OTP</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Signup — creates account if none exists */}
          <TouchableOpacity
            style={[styles.googleButton, isGoogleSigningUp && styles.buttonDisabled]}
            onPress={handleGoogleSignup}
            disabled={isGoogleSigningUp}
          >
            {isGoogleSigningUp ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#333" style={{ marginRight: 8 }} />
                <Text style={styles.googleButtonText}>Signing up...</Text>
              </View>
            ) : (
              <Text style={styles.googleButtonText}>Sign up with Google</Text>
            )}
          </TouchableOpacity>

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("Login")}>
              <Text style={styles.loginLink}>Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    padding: 30,
    borderRadius: 15,
    backgroundColor: "white",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
    elevation: 6,
  },
  logoWrap: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 25,
    color: "#333",
  },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    fontSize: 15,
    color: "#333",
  },
  sendButton: {
    width: "100%",
    paddingVertical: 12,
    backgroundColor: "#eab676",
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sendButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
    width: "100%",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#ddd",
  },
  dividerText: {
    marginHorizontal: 10,
    color: "#999",
    fontSize: 13,
  },
  googleButton: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
    backgroundColor: "white",
  },
  googleButtonText: {
    color: "#333",
    fontSize: 15,
    fontWeight: "500",
  },
  loginRow: {
    flexDirection: "row",
    marginTop: 15,
  },
  loginText: {
    fontSize: 14,
    color: "#333",
  },
  loginLink: {
    fontSize: 14,
    color: "#eab676",
    fontWeight: "bold",
  },
});

export default EmailVerifyPage;