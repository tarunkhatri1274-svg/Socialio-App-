import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken"; // adjust relative path

const API = Config.API_URL;

function ChangePassword() {
  const navigation = useNavigation();
  const [CurrentPassword, SetCurrentPassword] = useState("");
  const [Newpassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState(0); // 0=change password, 1=email, 2=otp, 3=reset
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");

  // loading states for each async action
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const handleChangePassword = async () => {
    if (Newpassword !== confirmPassword) {
      Alert.alert("", "New password and confirm password do not match.");
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await apiFetch(`${API}/auth/change-password`, {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: CurrentPassword,
          newPassword: Newpassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("", data.message);
        return;
      }

      Alert.alert("", data.message);
      SetCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      navigation.navigate("Settings");
    } catch (error) {
      console.error("Error changing password:", error);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSendOtp = async () => {
    if (!email) {
      Alert.alert("", "Please enter your email");
      return;
    }

    setIsSendingOtp(true);
    try {
      const response = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();

      if (response.ok) {
        setStep(2);
      } else {
        Alert.alert("", data.message);
      }
    } catch (error) {
      console.error("Error sending OTP:", error);
      Alert.alert("", "Failed to send OTP. Please try again.");
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp) {
      Alert.alert("", "Please enter the OTP");
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const response = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: String(otp) }),
      });
      const data = await response.json();
      if (response.ok) {
        setStep(3);
      } else {
        Alert.alert("", data.message);
      }
    } catch (error) {
      console.error("Error verifying OTP:", error);
      Alert.alert("", "Failed to verify OTP. Please try again.");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleResetPassword = async () => {
    if (!password) {
      Alert.alert("", "Please enter a new password");
      return;
    }

    setIsResettingPassword(true);
    try {
      const response = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newPassword: password }),
      });
      const data = await response.json();

      if (response.ok) {
        Alert.alert("", data.message);
        navigation.navigate("Settings");
      } else {
        Alert.alert("", data.message);
      }
    } catch (error) {
      console.error("Error resetting password:", error);
      Alert.alert("", "Failed to reset password. Please try again.");
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Reset Password</Text>

        {/* STEP 0: password */}
        {step === 0 && (
          <>
            <TextInput
              placeholder="Enter your current password"
              placeholderTextColor="#999"
              secureTextEntry
              value={CurrentPassword}
              onChangeText={SetCurrentPassword}
              style={styles.input}
              editable={!isChangingPassword}
            />
            <TextInput
              placeholder="Enter your new password"
              placeholderTextColor="#999"
              secureTextEntry
              value={Newpassword}
              onChangeText={setNewPassword}
              style={styles.input}
              editable={!isChangingPassword}
            />
            <TextInput
              placeholder="Confirm your new password"
              placeholderTextColor="#999"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              style={styles.input}
              editable={!isChangingPassword}
            />

            <TouchableOpacity
              style={[styles.button, isChangingPassword && styles.buttonDisabled]}
              onPress={handleChangePassword}
              disabled={isChangingPassword}
              activeOpacity={0.8}
            >
              {isChangingPassword ? (
                <ActivityIndicator size="small" color="#333" />
              ) : (
                <Text style={styles.buttonText}>Change Password</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.forgotText} onPress={() => setStep(1)}>
              Forgot Password?
            </Text>
          </>
        )}

        {/* STEP 1: EMAIL */}
        {step === 1 && (
          <>
            <TextInput
              placeholder="Enter your email"
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              editable={!isSendingOtp}
            />

            <TouchableOpacity
              style={[styles.button, isSendingOtp && styles.buttonDisabled]}
              onPress={handleSendOtp}
              disabled={isSendingOtp}
              activeOpacity={0.8}
            >
              {isSendingOtp ? (
                <ActivityIndicator size="small" color="#333" />
              ) : (
                <Text style={styles.buttonText}>Send OTP</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* STEP 2: OTP */}
        {step === 2 && (
          <>
            <TextInput
              placeholder="Enter OTP"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
              style={styles.input}
              editable={!isVerifyingOtp}
            />

            <TouchableOpacity
              style={[styles.button, isVerifyingOtp && styles.buttonDisabled]}
              onPress={handleVerifyOtp}
              disabled={isVerifyingOtp}
              activeOpacity={0.8}
            >
              {isVerifyingOtp ? (
                <ActivityIndicator size="small" color="#333" />
              ) : (
                <Text style={styles.buttonText}>Verify OTP</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* STEP 3: NEW PASSWORD */}
        {step === 3 && (
          <>
            <TextInput
              placeholder="Enter new password"
              placeholderTextColor="#999"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              editable={!isResettingPassword}
            />

            <TouchableOpacity
              style={[styles.button, isResettingPassword && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={isResettingPassword}
              activeOpacity={0.8}
            >
              {isResettingPassword ? (
                <ActivityIndicator size="small" color="#333" />
              ) : (
                <Text style={styles.buttonText}>Change Password</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default ChangePassword;

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
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    alignItems: "center",
  },
  title: {
    marginBottom: 20,
    fontSize: 22,
    fontWeight: "600",
    color: "#222",
    textAlign: "center",
  },
  input: {
    width: "100%",
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    fontSize: 14,
    color: "#333",
    backgroundColor: "#fafafa",
  },
  button: {
    width: "100%",
    paddingVertical: 12,
    marginTop: 6,
    backgroundColor: "#e8e8e8",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 15,
    color: "#333",
    fontWeight: "500",
  },
  forgotText: {
    marginTop: 14,
    fontSize: 14,
    color: "#555",
    textDecorationLine: "underline",
  },
};