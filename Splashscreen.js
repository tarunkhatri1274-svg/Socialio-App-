// SplashScreen.js
// Shown for a minimum amount of time on every cold start (like WhatsApp /
// Instagram / Facebook's splash), while we check AsyncStorage in the
// background to decide whether the user is already logged in.
//
// - Logged in (token + user saved)  -> replace with "MainTabs" (Home), no
//   Login/Register screens are ever shown.
// - Not logged in                   -> replace with "AuthPage" as before.
//
// Place this file next to App.js (project root), since it imports Logo
// the same way App.js's sibling files do.

import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated } from "react-native";
import { getAuthToken, getCachedUser } from "./src/api/authToken"; 
import Logo from "./logo";

// Tune this: 2000-3000ms reads as "branded splash", not a stall.
const MIN_SPLASH_TIME = 2500;

function SplashScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    const startedAt = Date.now();

    (async () => {
      let nextRoute = "AuthPage";
      let params;

      try {
        const token = await getAuthToken();
        const user = await getCachedUser();

        // Require BOTH — a token with no cached user (or vice versa)
        // means a half-written/corrupted state, so send them to login
        // instead of bouncing into MainTabs with missing user data.
        // getCachedUser() always resolves to an object (never null), so
        // check for an actual id on it rather than just truthiness.
        if (token && (user?._id || user?.id)) {
          nextRoute = "MainTabs";
          params = { screen: "Home" };
        }
      } catch {
        nextRoute = "AuthPage";
      }

      // Make sure the logo is visible for at least MIN_SPLASH_TIME,
      // even though the AsyncStorage check above usually finishes in
      // a few milliseconds.
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(MIN_SPLASH_TIME - elapsed, 0);

      setTimeout(() => {
        navigation.replace(nextRoute, params);
      }, remaining);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity: fadeAnim }}>
        <Logo />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EAB676", // matches Login/Register brand color
    justifyContent: "center",
    alignItems: "center",
  },
});

export default SplashScreen;