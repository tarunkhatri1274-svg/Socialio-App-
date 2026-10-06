// OtpVerificationPage.js
import React, { useState, useEffect } from "react";
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
import { useNavigation, useRoute } from "@react-navigation/native";
import Config from "react-native-config";
import Logo from "../../../logo"; // adjust path to your RN Logo component

const API = Config.API_URL;

function OtpVerifyPage() {
  const [otp, setOtp] = useState("");
  const [isVerifying, setIsVerifying] = useState(false); // NEW
  const [isResending, setIsResending] = useState(false); // NEW
  const navigation = useNavigation();
  const route = useRoute();
  const email = route.params?.email;

  // ✅ FIX: guard against reaching this screen with no email — same
  // gap that existed on ResetPassword/ForgotPasswordOtp before.
  useEffect(() => {
    if (!email) {
      Alert.alert(
        "Session expired",
        "Please start the verification process again."
      );
      navigation.navigate("VerifyEmail");
    }
  }, [email, navigation]);

  const handleVerifyOtp = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          otp,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        navigation.navigate("RegisterUser", { email });
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    setIsResending(true);
    try {
      await fetch(`${API}/auth/resend-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsResending(false);
    }
  };

  if (!email) {
    return null;
  }

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

          <Text style={styles.title}>Enter OTP</Text>

          <Text style={styles.subText}>OTP sent to {email}</Text>

          <TextInput
            style={styles.otpInput}
            placeholder="Enter 6-digit OTP"
            placeholderTextColor="#999"
            value={otp}
            onChangeText={(text) => setOtp(text.replace(/\D/g, ""))}
            maxLength={6}
            keyboardType="number-pad"
            textAlign="center"
            editable={!isVerifying}
          />

          <TouchableOpacity
            style={[styles.verifyButton, isVerifying && styles.buttonDisabled]}
            onPress={handleVerifyOtp}
            disabled={isVerifying}
          >
            {isVerifying ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.verifyButtonText}>Verifying...</Text>
              </View>
            ) : (
              <Text style={styles.verifyButtonText}>Verify OTP</Text>
            )}
          </TouchableOpacity>

          <View style={styles.resendRow}>
            <Text style={styles.resendText}>Didn't receive OTP? </Text>
            <TouchableOpacity onPress={handleResendOtp} disabled={isResending}>
              <Text style={styles.resendLink}>
                {isResending ? "Resending..." : "Resend"}
              </Text>
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
    marginBottom: 10,
    color: "#333",
  },
  subText: {
    fontSize: 14,
    marginBottom: 20,
    color: "#666",
  },
  otpInput: {
    width: "100%",
    padding: 12,
    marginBottom: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    fontSize: 15,
    letterSpacing: 5,
    color: "#333",
  },
  verifyButton: {
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
  verifyButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  resendRow: {
    flexDirection: "row",
    marginTop: 15,
  },
  resendText: {
    fontSize: 14,
    color: "#333",
  },
  resendLink: {
    fontSize: 14,
    color: "#eab676",
    fontWeight: "bold",
  },
});

export default OtpVerifyPage;