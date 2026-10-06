import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import Logo from "./logo"; // adjust path to your RN Logo component

function AuthPage() {
  const navigation = useNavigation();

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

          <Text style={styles.title}>Welcome</Text>

          <TouchableOpacity
            style={styles.loginButton}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={styles.loginButtonText}>Login</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => navigation.navigate("RegisterUser")}
          >
            <Text style={styles.registerButtonText}>New User</Text>
          </TouchableOpacity>
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
    marginBottom: 30,
    color: "#333",
  },
  loginButton: {
    width: "100%",
    paddingVertical: 12,
    marginBottom: 15,
    backgroundColor: "#eab676",
    borderRadius: 8,
    alignItems: "center",
  },
  loginButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  registerButton: {
    width: "100%",
    paddingVertical: 12,
    backgroundColor: "#333",
    borderRadius: 8,
    alignItems: "center",
  },
  registerButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default AuthPage;