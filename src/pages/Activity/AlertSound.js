// src/notifications/alertSound.js
import { Platform } from "react-native";
import notifee, { AndroidImportance } from "@notifee/react-native";
import { CHANNEL_ID } from "./PushNotifications";

export async function playAlertSound({ title, body } = {}) {
  try {
    if (Platform.OS === "android") {
      await notifee.displayNotification({
        title, body,
        android: {
          channelId: CHANNEL_ID,
          importance: AndroidImportance.HIGH,
          // FIX — "ic_stat_notify" doesn't exist as a drawable resource
          // in this project, which threw java.lang.IllegalArgumentException
          // ("no valid small icon") on every call, silently swallowed by
          // the catch block below — that was the actual root cause of no
          // sound/no status-bar icon. Using "ic_launcher" here because
          // it's confirmed to exist (testNotification() already uses it
          // successfully). Swap in a dedicated white/transparent status-
          // bar icon later (see note below) — the launcher icon works but
          // may render as a solid block/wrong color in the status bar on
          // some Android versions.
          smallIcon: "ic_stat_notify",
          pressAction: { id: "default" },
          autoCancel: true,
        },
      });
    } else {
      await notifee.displayNotification({ title, body, ios: { sound: "default" } });
    }
  } catch (err) { console.log("playAlertSound failed:", err?.message); }
}