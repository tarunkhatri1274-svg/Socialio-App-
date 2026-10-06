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

GoogleSignin.configure({
  webClientId: Config.GOOGLE_CLIENT_ID,
  offlineAccess: true, // merged in from Login.js's old local config
});

// v26 uses the modular API — the old `messaging().setBackgroundMessageHandler(...)`
// default-export pattern no longer exists in this version.
const messagingInstance = getMessaging(getApp());
setBackgroundMessageHandler(messagingInstance, async (remoteMessage) => {
  console.log('FCM background/quit message:', remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);