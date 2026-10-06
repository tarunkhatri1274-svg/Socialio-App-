import { Platform } from "react-native";
import { getApp } from "@react-native-firebase/app";
import {
  getMessaging,
  requestPermission,
  AuthorizationStatus,
  getToken,
  onTokenRefresh,
  onMessage,
} from "@react-native-firebase/messaging";
import notifee,{AndroidImportance} from "@notifee/react-native";
import Config from "react-native-config";
import { apiFetch, getAuthToken } from "../../api/authToken"; // adjust relative path
const API = Config.API_URL;
const messagingInstance = getMessaging(getApp());
export const CHANNEL_ID = "socialio-default-v2";
export async function requestNotificationPermission() {
  const authStatus = await requestPermission(messagingInstance);
  return (
    authStatus === AuthorizationStatus.AUTHORIZED ||
    authStatus === AuthorizationStatus.PROVISIONAL
  );
}
export async function createNotificationChannel() {
  if (Platform.OS !== "android") return;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: "Socialio notifications",
    importance:AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    // FIX — notifee requires every value in vibrationPattern to be
    // strictly positive; [0, 80] threw "expected an array containing
    // an even number of positive values" on every call, which meant
    // this createChannel() never actually succeeded — the channel
    // never got created, so every notification targeting CHANNEL_ID
    // (messages, likes, comments, everything routed through
    // AlertSound.js) silently failed with no sound and no status-bar
    // icon. Using a small positive delay instead of 0 fixes it while
    // keeping the same "short/subtle buzz" intent.
    vibrationPattern: [100, 80],
  });
}

// ── 3. Get the current FCM token, send it to the backend, and keep it
// in sync if Firebase ever rotates it. Call once after login. ──
export async function registerDeviceToken() {
  try {
    const fcmToken = await getToken(messagingInstance);
    await sendTokenToServer(fcmToken);
  } catch (err) {
    console.log("registerDeviceToken failed:", err.message);
  }

  return onTokenRefresh(messagingInstance, async (newToken) => {
    await sendTokenToServer(newToken);
  });
}

async function sendTokenToServer(fcmToken) {
  try {
    const authToken = await getAuthToken();
    if (!authToken || !fcmToken) return;

    await apiFetch(`${API}/auth/device-token`, {
      method: "PUT",
      body: JSON.stringify({ fcmToken, platform: Platform.OS }),
    });
  } catch (err) {
    console.log("sendTokenToServer failed:", err.message);
  }
}

// ── NEW — call this from logout/delete-account flows, BEFORE clearing
// the auth token from AsyncStorage (it needs a valid token to
// authenticate the request). Without this, the backend keeps this
// device's fcmToken saved against the account that just logged out —
// so if a different person logs into a different account on this same
// phone afterward, the OLD account's likes/comments/messages could
// still push a real system notification to THIS device, since FCM
// tokens are tied to the physical device/app install, not to whichever
// account happens to be logged in at the time.
//
// ASSUMPTION: this PUTs fcmToken: null to the same /auth/device-token
// route used to register it, on the assumption your backend controller
// either clears the field on a null value or you add that handling.
// If your backend instead expects a dedicated DELETE route for this,
// swap the fetch call below accordingly.
export async function clearDeviceToken() {
  try {
    const authToken = await getAuthToken();
    if (!authToken) return;

    await apiFetch(`${API}/auth/device-token`, {
      method: "PUT",
      body: JSON.stringify({ fcmToken: null, platform: Platform.OS }),
    });
  } catch (err) {
    console.log("clearDeviceToken failed:", err.message);
  }
}

// ── 4. Foreground handler. Your existing socket.io + Vibration.vibrate(80)
// already covers "app open" — this just logs so FCM doesn't double-fire
// anything visible while you're using the app. ──
export function registerForegroundHandler() {
  return onMessage(messagingInstance, async (remoteMessage) => {
    console.log("FCM foreground message (ignored, socket.io already handled it):", remoteMessage);
  });
}

// ── Call this whole bundle once, after login/registration succeeds
// (see App.js snippet in the setup guide). ──
export async function initPushNotifications() {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await createNotificationChannel();
  await registerDeviceToken();
  registerForegroundHandler();
}



export async function testNotification() {
  try {
    await notifee.createChannel({
      id: "socialio-test-v2",
      name: "Socialio Test",
      importance: AndroidImportance.HIGH,
      sound: "default",
      vibration: true,
    });

    await notifee.displayNotification({
      title: "Socialio Test",
      body: "If you hear this, notification sound works.",
      android: {
        channelId: "socialio-test-v2",
        smallIcon: "ic_stat_notify",
        pressAction: {
          id: "default",
        },
      },
    });

    console.log("TEST NOTIFICATION SUCCESS");
  } catch (e) {
    console.log("TEST NOTIFICATION ERROR:", e);
  }
}