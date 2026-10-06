import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { initPushNotifications } from "../../pages/Activity/PushNotifications"
import Icon from "react-native-vector-icons/Ionicons";
import Config from "react-native-config";
import { saveAuthSession, useAuth } from "../../api/authToken"
import { useNavigation } from "@react-navigation/native";
import Logo from "../../../logo";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { initSocket } from "../../sockets/Sockets";

const API = Config.API_URL;

const Login = () => {
  const navigation = useNavigation();
  const { refreshAuth } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleLoggingIn, setIsGoogleLoggingIn] = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  // ── GoogleSignin.configure() was removed from here — it now runs
  // once at app boot in index.js, so this screen just calls
  // GoogleSignin.signIn() directly, trusting that setup already happened.

  // ===========================
  // Normal Login
  // ===========================

  const handleLogin = async () => {
    if (!username.trim()) {
      Alert.alert("Error", "Please enter username");
      return;
    }

    if (!password.trim()) {
      Alert.alert("Error", "Please enter password");
      return;
    }

    try {
      setIsLoggingIn(true);

      const response = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        await saveAuthSession(data);
        await refreshAuth();

        // Connect the socket with the freshly saved token before
        // navigating — screens on Home mount immediately and expect
        // socket to already be authenticated.
       await initSocket();
await initPushNotifications();

navigation.replace("MainTabs", { screen: "Home" });
      } else {
        Alert.alert("Login Failed", data.message);
      }
    } catch (error) {
      console.log(error);
      Alert.alert("Error", "Something went wrong");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // ===========================
  // Google Login
  // ===========================

  const handleGoogleLogin = async () => {
    try {
      setIsGoogleLoggingIn(true);

      await GoogleSignin.hasPlayServices();

      const userInfo = await GoogleSignin.signIn();

      const idToken = userInfo.data?.idToken || userInfo.idToken;

      const response = await fetch(
        `${API}/auth/google-login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            idToken,
          }),
        }
      );

      const data = await response.json();

           if (response.ok) {
        await saveAuthSession(data);
        await refreshAuth();

        // Same as above — connect socket with the new token before
        // navigating to Home. FIX — this was missing initPushNotifications(),
        // unlike the regular username/password login just above and the
        // Google/normal signup flows in EmailVerificationPage.js and
        // RegisterUser.js, so a user who logs in via Google never got
        // permission requested / channel created / device token registered
        // until their next app restart.
        await initSocket();
        await initPushNotifications();

        navigation.replace("MainTabs", { screen: "Home" });
      } else if (data.notRegistered) {
        Alert.alert(
          "Account Not Found",
          "Please register first."
        );

        navigation.navigate("VerifyEmail");
      } else {
        Alert.alert("Error", data.message);
      }
    } catch (error) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log("Cancelled");
      } else if (
        error.code === statusCodes.IN_PROGRESS
      ) {
        console.log("In Progress");
      } else if (
        error.code ===
        statusCodes.PLAY_SERVICES_NOT_AVAILABLE
      ) {
        Alert.alert(
          "Google Play Services not available"
        );
      } else {
        console.log(error);
        Alert.alert(
          "Google Login",
          "Login failed."
        );
      }
    } finally {
      setIsGoogleLoggingIn(false);
    }
  };

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

          {/* Logo */}
          <View style={styles.logoWrap}>
            <Logo />
          </View>

          <Text style={styles.title}>Login</Text>

          {/* Username */}

          <View style={styles.inputContainer}>
            <Icon
              name="person-outline"
              size={22}
              color="#777"
              style={styles.icon}
            />

            <TextInput
              placeholder="Enter Username"
              placeholderTextColor="#888"
              value={username}
              onChangeText={setUsername}
              style={styles.input}
              autoCapitalize="none"
              editable={!isLoggingIn}
            />
          </View>

          {/* Password */}

          <View style={styles.inputContainer}>
            <Icon
              name="lock-closed-outline"
              size={22}
              color="#777"
              style={styles.icon}
            />

            <TextInput
              placeholder="Enter Password"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              style={styles.input}
              editable={!isLoggingIn}
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

          {/* Forgot Password */}

          <TouchableOpacity
            onPress={() =>
              navigation.navigate("ForgotPassword")
            }
          >
            <Text style={styles.forgotText}>
              Forgot Password?
            </Text>
          </TouchableOpacity>

          {/* Login Button */}

          <TouchableOpacity
            style={[styles.loginButton, isLoggingIn && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.loginText}>Logging in...</Text>
              </View>
            ) : (
              <Text style={styles.loginText}>
                Login
              </Text>
            )}
          </TouchableOpacity>

          {/* Divider */}

          <View style={styles.dividerContainer}>

            <View style={styles.line} />

            <Text style={styles.orText}>
              OR
            </Text>

            <View style={styles.line} />

          </View>

          {/* Google Button */}

          <TouchableOpacity
            style={[styles.googleButton, isGoogleLoggingIn && styles.buttonDisabled]}
            onPress={handleGoogleLogin}
            disabled={isGoogleLoggingIn}
          >
            {isGoogleLoggingIn ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#000" style={{ marginRight: 8 }} />
                <Text style={styles.googleText}>Signing in...</Text>
              </View>
            ) : (
              <>
                <Icon
                  name="logo-google"
                  size={22}
                  color="#DB4437"
                />

                <Text style={styles.googleText}>
                  Login with Google
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Register */}

          <View style={styles.bottomRow}>

            <Text style={styles.bottomText}>
              Don't have an account?
            </Text>

            <TouchableOpacity
              onPress={() =>
                navigation.navigate("VerifyEmail")
              }
            >
              <Text style={styles.registerText}>
                Register
              </Text>
            </TouchableOpacity>

          </View>

        </View>

      </ScrollView>

    </KeyboardAvoidingView>

  );

};

export default Login;
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EAB676",
  },

  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
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
    marginBottom: 30,
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    paddingHorizontal: 15,
    marginBottom: 18,
    backgroundColor: "#FAFAFA",
  },

  icon: {
    marginRight: 10,
  },

  input: {
    flex: 1,
    fontSize: 16,
    color: "#222",
    paddingVertical: 14,
  },

  forgotText: {
    color: "#EAB676",
    alignSelf: "flex-end",
    fontWeight: "600",
    marginBottom: 25,
  },

  loginButton: {
    backgroundColor: "#EAB676",
    paddingVertical: 15,
    borderRadius: 12,
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

  loginText: {
    color: "#FFF",
    fontWeight: "bold",
    fontSize: 18,
  },

  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 30,
  },

  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#DDD",
  },

  orText: {
    marginHorizontal: 15,
    color: "#888",
    fontWeight: "600",
  },

  googleButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: "#FFF",
  },

  googleText: {
    marginLeft: 10,
    fontWeight: "600",
    color: "#333",
    fontSize: 16,
  },

  bottomRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 30,
  },

  bottomText: {
    color: "#555",
    fontSize: 15,
  },

  registerText: {
    color: "#EAB676",
    fontWeight: "bold",
    marginLeft: 5,
    fontSize: 15,
  },
});