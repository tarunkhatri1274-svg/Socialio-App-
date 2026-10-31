/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Config from 'react-native-config';
import { getApp } from '@react-native-firebase/app';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, AndroidCategory, EventType } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './src/api/authToken';

GoogleSignin.configure({
  webClientId: Config.GOOGLE_CLIENT_ID,
  offlineAccess: true,
});

const CALL_CHANNEL = 'incoming_calls_v1';
const CALL_NOTIF_ID = 'incoming_call';

async function showIncomingCall(d) {
  await notifee.createChannel({
    id: CALL_CHANNEL,
    name: 'Incoming calls',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    vibrationPattern: [300, 500, 300, 500],
  });
  await notifee.displayNotification({
    id: CALL_NOTIF_ID,
    title: d.callerName || 'Incoming call',
    body: d.callType === 'video' ? 'Incoming video call' : 'Incoming call',
    data: d,
    android: {
      channelId: CALL_CHANNEL,
      smallIcon: 'ic_launcher',
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      ongoing: true,
      autoCancel: false,
      loopSound: true,
      timeoutAfter: 45000,
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        { title: 'Decline', pressAction: { id: 'decline' } },
        { title: 'Accept', pressAction: { id: 'accept', launchActivity: 'default' } },
      ],
    },
  });
}

const messagingInstance = getMessaging(getApp());
setBackgroundMessageHandler(messagingInstance, async (remoteMessage) => {
  const d = remoteMessage?.data || {};
  try {
    if (d.type === 'incoming_call') await showIncomingCall(d);
    else if (d.type === 'call_cancelled') await notifee.cancelNotification(CALL_NOTIF_ID);
  } catch (e) {
    console.log('[call-bg] error', e?.message);
  }
});

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const d = detail.notification?.data;
  if (d?.type !== 'incoming_call' || type !== EventType.ACTION_PRESS) return;

  if (detail.pressAction.id === 'decline') {
    await notifee.cancelNotification(CALL_NOTIF_ID);
    try {
      await apiFetch(`${Config.API_URL}/calls/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: d.callerId }),
      });
    } catch {}
  } else if (detail.pressAction.id === 'accept') {
    await AsyncStorage.setItem('pendingAcceptCall', JSON.stringify({ from: d.from, at: Date.now() }));
    await notifee.cancelNotification(CALL_NOTIF_ID);
  }
});

AppRegistry.registerComponent(appName, () => App);