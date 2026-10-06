// RegisterUser.js
// RegisterUser.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { useNavigation, useRoute } from "@react-navigation/native";
import { saveAuthSession, useAuth } from "../../api/authToken"
import Config from "react-native-config";
import Logo from "../../../logo"; // adjust path to your RN Logo component
import { initSocket } from "../../sockets/Sockets";
import { initPushNotifications } from "../../pages/Activity/PushNotifications"
const API = Config.API_URL;

const GENDER_OPTIONS = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Other", value: "other" },
];

function RegisterForm() {
  const { refreshAuth } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [error, setError] = useState("");
  const [isRegistering, setIsRegistering] = useState(false); // NEW

  const navigation = useNavigation();
  const route = useRoute();
  const email = route.params?.email;

  useEffect(() => {
    if (!email) {
      navigation.navigate("VerifyEmail");
    }
  }, [email, navigation]);
const handleregister = async () => {
    setError("");

    if (password.length < 6) {
      return setError("Password must be at least 6 characters");
    }

    if (password !== confirmPassword) {
      return setError("Passwords do not match");
    }

    if (!age) {
      return setError("Please enter your age");
    }

    const numericAge = Number(age);
    if (isNaN(numericAge) || numericAge <= 0) {
      return setError("Please enter a valid age");
    }

    if (numericAge < 18) {
      return setError("You are not eligible to use Socialio");
    }

    if (!gender) {
      return setError("Please select your gender");
    }

    setIsRegistering(true);
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          password,
          age: numericAge,
          gender,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        await saveAuthSession(data);
        await refreshAuth();

        // Connect socket with the new token before landing on Home.
await initSocket();
await initPushNotifications();

navigation.reset({
  index: 0,
  routes: [{ name: "MainTabs", params: { screen: "Home" } }],
});
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setIsRegistering(false);
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

          <Text style={styles.title}>Register</Text>

          <Text style={styles.subText}>Registering with: {email}</Text>

          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(text) => setUsername(text.toLowerCase())}
            placeholder="Username (lowercase, no spaces)"
            placeholderTextColor="#999"
            autoCapitalize="none"
            editable={!isRegistering}
          />

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            placeholderTextColor="#999"
            secureTextEntry
            editable={!isRegistering}
          />

          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm password"
            placeholderTextColor="#999"
            secureTextEntry
            editable={!isRegistering}
          />

          <TextInput
            style={styles.input}
            value={age}
            onChangeText={(text) => setAge(text.replace(/[^0-9]/g, ""))}
            placeholder="Age"
            placeholderTextColor="#999"
            keyboardType="numeric"
            maxLength={3}
            editable={!isRegistering}
          />

          <Text style={styles.genderLabel}>Gender</Text>
          <View style={styles.genderRow}>
            {GENDER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.genderOption,
                  gender === option.value && styles.genderOptionSelected,
                ]}
                onPress={() => setGender(option.value)}
                disabled={isRegistering}
              >
                <Text
                  style={[
                    styles.genderOptionText,
                    gender === option.value && styles.genderOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.registerButton, isRegistering && styles.buttonDisabled]}
            onPress={handleregister}
            disabled={isRegistering}
          >
            {isRegistering ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.registerButtonText}>Creating Account...</Text>
              </View>
            ) : (
              <Text style={styles.registerButtonText}>Register</Text>
            )}
          </TouchableOpacity>

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("Login")} disabled={isRegistering}>
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
    marginBottom: 15,
    color: "#333",
  },
  subText: {
    fontSize: 14,
    marginBottom: 15,
    color: "#666",
  },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    fontSize: 15,
    color: "#333",
  },
  genderLabel: {
    alignSelf: "flex-start",
    fontSize: 13,
    color: "#666",
    marginBottom: 8,
  },
  genderRow: {
    flexDirection: "row",
    width: "100%",
    marginBottom: 15,
    justifyContent: "space-between",
  },
  genderOption: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
  },
  genderOptionSelected: {
    backgroundColor: "#eab676",
    borderColor: "#eab676",
  },
  genderOptionText: {
    fontSize: 14,
    color: "#333",
  },
  genderOptionTextSelected: {
    color: "white",
    fontWeight: "600",
  },
  errorText: {
    color: "red",
    marginBottom: 10,
    fontSize: 14,
  },
  registerButton: {
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
  registerButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
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

export default RegisterForm;