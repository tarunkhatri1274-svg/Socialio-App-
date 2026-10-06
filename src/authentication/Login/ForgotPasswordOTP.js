// src/screens/ForgotPasswordOtp.js

// src/screens/ForgotPasswordOtp.js

// src/screens/ForgotPasswordOtp.js

import React, { useRef, useState, useEffect } from "react";
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
import { useNavigation, useRoute } from "@react-navigation/native";

const API = Config.API_URL;

const ForgotPasswordOtp = () => {
  const navigation = useNavigation();
  const route = useRoute();

  const email = route.params?.email; // ✅ FIX: optional chaining instead of destructuring

  // ✅ FIX: guard against reaching this screen with no email
  useEffect(() => {
    if (!email) {
      Alert.alert(
        "Session expired",
        "Please start the password reset process again."
      );
      navigation.replace("ForgotPassword");
    }
  }, [email, navigation]);

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isVerifying, setIsVerifying] = useState(false);

  const inputs = useRef([]);

  const handleChange = (value, index) => {
    if (!/^[0-9]?$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleBackspace = (value, index) => {
    if (value === "" && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async () => {
    const otpValue = otp.join("");

    if (otpValue.length !== 6) {
      Alert.alert("Error", "Please enter complete OTP");
      return;
    }

    try {
      setIsVerifying(true);

      const response = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          otp: otpValue,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        navigation.navigate("ResetPassword", {
          email,
        });
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsVerifying(false);
    }
  };

  // ✅ FIX: don't render the form at all while redirecting away
  if (!email) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
            Verify OTP
          </Text>

          <Text style={styles.subtitle}>
            Enter the 6-digit OTP sent to your email.
          </Text>

          <View style={styles.otpContainer}>

            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => (inputs.current[index] = ref)}
                style={styles.otpInput}
                value={digit}
                onChangeText={(value) =>
                  handleChange(value, index)
                }
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === "Backspace") {
                    handleBackspace(digit, index);
                  }
                }}
                keyboardType="number-pad"
                maxLength={1}
                textAlign="center"
                editable={!isVerifying}
              />
            ))}

          </View>

          <TouchableOpacity
            style={[styles.button, isVerifying && styles.buttonDisabled]}
            onPress={handleVerifyOtp}
            disabled={isVerifying}
          >
            {isVerifying ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Verifying...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>
                Verify OTP
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            disabled={isVerifying}
          >
            <Text style={styles.backText}>
              Back
            </Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default ForgotPasswordOtp;
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
    backgroundColor: "#FFF",
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
    color: "#666",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },

  otpContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },

  otpInput: {
    width: 48,
    height: 55,
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 12,
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    backgroundColor: "#FAFAFA",
  },

  button: {
    backgroundColor: "#EAB676",
    borderRadius: 12,
    paddingVertical: 15,
    justifyContent: "center",
    alignItems: "center",
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

  backText: {
    marginTop: 25,
    textAlign: "center",
    color: "#EAB676",
    fontSize: 15,
    fontWeight: "bold",
  },
});