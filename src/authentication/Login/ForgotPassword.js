// src/screens/ForgotPassword.js

// src/screens/ForgotPassword.js

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import Logo from "../../../logo";
import Config from "react-native-config";
import Icon from "react-native-vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";

const API = Config.API_URL;

const ForgotPassword = () => {
  const navigation = useNavigation();

  const [email, setEmail] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false); // was: loading

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email");
      return;
    }

    try {
      setIsSendingOtp(true);

      const response = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert("Success", "OTP sent successfully.");

        navigation.navigate("ForgotPasswordOtp", {
          email,
        });
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Something went wrong.");
    } finally {
      setIsSendingOtp(false);
    }
  };

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
            Forgot Password
          </Text>

          <Text style={styles.subtitle}>
            Enter your registered email to receive an OTP.
          </Text>

          <View style={styles.inputContainer}>
            <Icon
              name="mail-outline"
              size={22}
              color="#777"
              style={styles.icon}
            />

            <TextInput
              placeholder="Enter Email"
              placeholderTextColor="#888"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              editable={!isSendingOtp}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, isSendingOtp && styles.buttonDisabled]}
            onPress={handleSendOtp}
            disabled={isSendingOtp}
          >
            {isSendingOtp ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Sending OTP...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>
                Send OTP
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            disabled={isSendingOtp}
          >
            <Text style={styles.backText}>
              Back to Login
            </Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default ForgotPassword;
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
    marginBottom: 25,
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
    fontWeight: "bold",
    fontSize: 17,
  },

  backText: {
    marginTop: 25,
    textAlign: "center",
    color: "#EAB676",
    fontWeight: "bold",
    fontSize: 15,
  },
});