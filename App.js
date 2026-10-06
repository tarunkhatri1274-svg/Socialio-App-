/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// NEW — needed for MainTabs below. Install if not already present:
//   npm install @react-navigation/bottom-tabs
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { CallProvider } from './src/components/Context/CallContext';
import { AuthProvider, useAuth, getAuthToken, setUnauthorizedHandler } from './src/api/authToken'; // adjust path if authToken.js lives elsewhere
import { initSocket } from './src/sockets/Sockets';
// Loads the saved posts/videos in-memory cache from AsyncStorage. Must
// resolve before any screen calls isPostSaved()/toggleSavedPost(), or the
// cache starts empty and the next save overwrites the stored list.
import { initSavedPostsCache } from './src/components/State/SavedPostStore';
// Off-screen host that bakes CSS-style filters into edited images on
// Android/iOS (no <canvas> there) — see the big comment at the top of
// CropImage.js for why this needs to be mounted once, near the app
// root, rather than inside AddImagePost/EditPost themselves. Without
// this mounted, getEditedImage() falls back to returning crops
// unfiltered and logs a warning instead of failing.
import { FilterCaptureHost } from './src/components/PostCard/CropImage';

// ── Push notifications (FCM + Notifee) — permission request, Android
// channel creation (silent, vibrate-only), and device token
// registration with the backend. Only called once a token already
// exists in AsyncStorage (i.e. the user is logged in), same gate as
// initSocket() right below it.
import { initPushNotifications, requestNotificationPermission } from './src/pages/Activity/PushNotifications'

/* ── Splash — new. Shown for ~2.5s on cold start and decides whether
   to land on AuthPage or skip straight into MainTabs, based on
   whether a token/user is already saved in AsyncStorage. ── */
import SplashScreen from './Splashscreen';

/* ── Auth screens ── */
import AuthPage from './Auth';
import Login from './src/authentication/Login/Login';
import ForgotPassword from './src/authentication/Login/ForgotPassword';
import ForgotPasswordOtp from './src/authentication/Login/ForgotPasswordOTP';
import ResetPassword from './src/authentication/Login/ResetPassword';
import EmailVerifyPage from './src/authentication/Register/EmailVerificationPage';
import OtpVerifyPage from './src/authentication/Register/OtpVerificationPage';
import RegisterForm from './src/authentication/Register/RegisterUser';

/* ── Navbar-level screens ── */
import Homepage from './src/pages/Home/HomePage'; // TODO: point this at your actual Home screen
import Explore from './src/pages/Explore/ExplorePage'; // TODO: convert Explore.jsx if not already RN
import ActivityPage from './src/pages/Activity/ActivityPage'; // TODO: convert if not already RN
import Messages from './src/pages/Messages/Message';
import VideoPage from './src/pages/VideoPage/VideoPage'; // TODO: convert if not already RN

/* ── Profile screens (converted earlier in this thread) ── */
import SavedPage from './src/pages/SavedPage/SavedPage';
import Profilepage from './src/pages/Profile/ProfilePage';
import EditProfile from './src/pages/Profile/EditProfile';
import UserProfileView from './src/pages/Profile/UserProfileView';
import UserProfileVideoPost from './src/pages/Profile/UserProfileVideoPost';
import ExploreReels from './src/pages/Explore/ExploreReels'; // TODO: convert if not already RN

/* ── Post screens — TODO: convert these if not already RN.
   Only Videopost.jsx (the reel card component used inside
   UserProfileVideoPost) has been converted in this thread so far. */
import Post from './src/components/PostCard/Post';
import CreateTextPost from './src/components/PostCard/CreateTextPost';
import CreateImagePost from './src/components/PostCard/AddImagePost';
import EditImagePage from './src/components/PostCard/EditPost';
import CreateVideoPost from './src/components/PostCard/VideoPostFormat';
import Reelspage from './src/components/PostCard/ReelsPage';
import TextPostView from './src/components/PostCard/TextPostView';
import Videopost from './src/components/PostCard/Video';

/* ── Story screens — TODO: convert if not already RN ── */
import StoryViewer from './src/components/StoryBar/StoryViewer';
import CreateStory from './src/components/StoryBar/CreateStory';
import StoryPreview from './src/components/StoryBar/StoryPreview';

/* ── Settings screens — TODO: convert if not already RN ── */
import Settings from './src/pages/Settings/Settings';
import DeleteAccount from './src/pages/Settings/DeleteAccount';
import ChangePassword from './src/pages/Settings/ChangePassword';
import PrivacyToggle from './src/pages/Settings/PrivacyToggle';
import NotificationSettings from './src/pages/Settings/NotificationSettings';
import BlockedAccounts from './src/pages/Settings/BlockedAccounts';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Module-level nav ref so code outside any component (e.g. the
// unauthorized-session handler wired up in AppInner below) can still
// trigger navigation — this is the standard React Navigation pattern
// for navigating from outside the component tree.
const navigationRef = createNavigationContainerRef();

// ── MainTabs ──────────────────────────────────────────────────
// Home / Search / Notifications / Messages / VideoPage / Profile used
// to be six separate <Stack.Screen>s living in the SAME flat stack as
// every detail screen (PostDetail, UserProfile, Settings, ...). That's
// what was causing "Home reloads when I come back to it": with 20+
// screens sharing one history array, navigate()'s pop-to-existing-route
// behavior gets fragile, and nothing guaranteed these six screens
// stayed mounted while you were a few screens deep elsewhere.
//
// Grouping them into their own Tab.Navigator fixes this at the root:
// a Tab.Navigator keeps every tab's screen instance mounted for the
// life of the app (state, scroll position, fetched data — all of it),
// completely independent of whatever gets pushed on top of MainTabs in
// the outer Stack.Navigator below. Pushing PostDetail/Settings/etc. on
// top no longer touches Home (or any other tab) at all — it's just
// sitting there, still mounted, underneath.
//
// tabBar={() => null} hides the built-in tab bar entirely because
// Navbar.js already renders its own custom bottom pill on every one of
// these screens — we still want that, not a second native tab bar.
//
// IMPORTANT: every navigation.navigate("Home") / "Search" / "Profile" /
// etc. call anywhere else in the app (Navbar.js, ExplorePage.js, ...)
// keeps working completely unchanged — React Navigation resolves a
// screen name to whichever navigator (nested or not) contains it, as
// long as the name is unique across the whole tree, which these are.
// No other file needs to change.
function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={() => null}
      screenOptions={{ headerShown: false, lazy: false }}
    >
      <Tab.Screen name="Home" component={Homepage} />
      <Tab.Screen name="Search" component={Explore} />
      <Tab.Screen name="Notifications" component={ActivityPage} />
      <Tab.Screen name="Messages" component={Messages} />
      <Tab.Screen name="VideoPage" component={VideoPage} />
      <Tab.Screen name="Profile" component={Profilepage} />
    </Tab.Navigator>
  );
}

// ── CallProvider now wraps the ENTIRE app (all screens, auth included)
// instead of being repeated per-screen. currentUser comes from
// AuthContext (via useAuth() below) instead of being read from
// AsyncStorage locally — AuthContext is the single source of truth for
// "who's logged in", resolved once from AsyncStorage on mount and kept
// in sync after login/logout by whoever calls refreshAuth()/clearAuth().
// While on auth screens (or before that resolves), currentUser stays
// {} (AuthContext's default) — CallProvider treats a missing _id as
// "nothing to listen for" via optional chaining, so {} behaves the
// same as the old null did.
//
// NOTE: GroupCallProvider was removed on the web side too — group
// audio/video calling isn't part of this app. If a GroupCallContext or
// groupcall component exists in your RN project, it's unused and safe
// to delete, matching the web app's note.
function AppInner() {
  const isDarkMode = useColorScheme() === 'dark';
  const { user: currentUser, refreshAuth } = useAuth();

  // Gate the whole UI until SavedPostStore's cache is loaded (two quick
  // AsyncStorage reads). initSavedPostsCache() never throws — it always
  // resolves, falling back to empty lists on error.
  const [storesReady, setStoresReady] = useState(false);

  useEffect(() => {
    (async () => {
      await initSavedPostsCache();
      setStoresReady(true);
    })();
  }, []);

  // Wired once: whenever apiFetch (in authToken.js) gets a 401 that a
  // refresh-token retry can't fix, it clears AsyncStorage and calls
  // this — so we sync AuthContext's state and kick the user back to
  // Login, no matter which screen they were on.
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      await refreshAuth(); // AuthContext now reflects the cleared session
      if (navigationRef.isReady()) {
        navigationRef.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    });
  }, [refreshAuth]);

  useEffect(() => {
    (async () => {
      try {
        // If a token already exists (returning user who never logged
        // out), connect the socket here too — Login.js only handles
        // the fresh-login case, this handles app-reopen/cold-start.
        // NOTE: SplashScreen also reads AsyncStorage on its own, in
        // parallel, to decide which route to land on — that's a
        // separate, intentionally duplicated read so Splash doesn't
        // have to wait on this effect or on CallProvider at all.
        const token = await getAuthToken();
        if (token) {
          await initSocket();
          // Push notification permission + Android channel + FCM
          // token registration. Same gate as initSocket() — only for
          // an already-logged-in / returning user. Login.js and
          // RegisterUser.js should call this too right after they set
          // the token, so a brand-new login/signup also registers for
          // push without needing an app restart.
          const granted = await requestNotificationPermission();
          console.log('[push] notification permission granted:', granted);
          await initPushNotifications();
        }
      } catch {
        // AuthContext already defaults to token: null, user: {} on failure
      }
    })();
  }, []);

  // All hooks are declared above, so this early return is safe.
  if (!storesReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <CallProvider currentUser={currentUser}>
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator
              initialRouteName="Splash"
              screenOptions={{ headerShown: false }}
            >
              {/* ── Splash — always first. Decides Auth vs MainTabs. ── */}
              <Stack.Screen name="Splash" component={SplashScreen} />

              {/* ── Auth routes ── */}
              <Stack.Screen name="AuthPage" component={AuthPage} />
              <Stack.Screen name="Login" component={Login} />
              <Stack.Screen name="ForgotPassword" component={ForgotPassword} />
              <Stack.Screen name="ForgotPasswordOtp" component={ForgotPasswordOtp} />
              <Stack.Screen name="ResetPassword" component={ResetPassword} />
              <Stack.Screen name="VerifyEmail" component={EmailVerifyPage} />
              <Stack.Screen name="VerifyOtp" component={OtpVerifyPage} />
              <Stack.Screen name="RegisterUser" component={RegisterForm} />

              {/* navbar — now ONE screen (a persistent Tab.Navigator)
                  instead of six separate flat Stack.Screens. See the
                  big comment on MainTabs above for why.

                  gestureEnabled: false — createNativeStackNavigator
                  gives every screen a native, OS-level "swipe from the
                  edge to go back" gesture on iOS. That gesture lives
                  outside the JS PanResponder system entirely, so it
                  was winning every LEFT-TO-RIGHT drag on Home/Explore/
                  Messages/VideoPage/etc. before Navbar.js's custom
                  useSwipeToChangeTab hook ever saw the touch — RIGHT-
                  TO-LEFT drags don't match any built-in gesture, so
                  those always reached the custom hook fine. Turning
                  this off here frees up left-to-right swipes on every
                  tab screen for the custom tab-switch gesture. */}
              <Stack.Screen
                name="MainTabs"
                component={MainTabs}
                options={{ gestureEnabled: false }}
              />

              {/* Profile */}
              <Stack.Screen name="Saved" component={SavedPage} />
              <Stack.Screen name="EditProfile" component={EditProfile} />
              {/* was /profile/:userId — now navigation.navigate("UserProfile", { userId }) */}
              <Stack.Screen name="UserProfile" component={UserProfileView} />
              {/* was /profile-reel/:videoId — now navigation.navigate("ProfileReel", { videoId, ... }) */}
              <Stack.Screen name="ProfileReel" component={UserProfileVideoPost} />
              {/* was /explore-reels/:videoId */}
              <Stack.Screen name="ExploreReels" component={ExploreReels} />

              {/* Posts */}
              {/* was /post/:id — now navigation.navigate("PostDetail", { post, allPosts }) */}
              <Stack.Screen name="PostDetail" component={Post} />
              <Stack.Screen name="CreateText" component={CreateTextPost} />
              <Stack.Screen name="EditImage" component={EditImagePage} />
              <Stack.Screen name="CreateImagePost" component={CreateImagePost} />
              <Stack.Screen name="CreateVideo" component={CreateVideoPost} />
              <Stack.Screen name="Reel" component={Reelspage} />
              {/* was /text-post/:id — now navigation.navigate("TextPost", { post, allPosts }) */}
              <Stack.Screen name="TextPost" component={TextPostView} />
              <Stack.Screen name="VideoPostDetail" component={Videopost} />
              <Stack.Screen name="Story" component={StoryViewer} />
              <Stack.Screen name="CreateStory" component={CreateStory} />
              <Stack.Screen name="StoryPreview" component={StoryPreview} />

              {/* Settings */}
              <Stack.Screen name="Settings" component={Settings} />
              <Stack.Screen name="DeleteAccount" component={DeleteAccount} />
              <Stack.Screen name="ChangePassword" component={ChangePassword} />
              <Stack.Screen name="Privacy" component={PrivacyToggle} />
              <Stack.Screen name="NotificationSettings" component={NotificationSettings} />
              <Stack.Screen name="Blocked" component={BlockedAccounts} />
            </Stack.Navigator>
          </NavigationContainer>
          {/* Mounted once here (off-screen, renders nothing visible) so
              it's always ready by the time any screen calls
              getEditedImage() with a filter. Must live inside the same
              tree that ends up rendering it — CallProvider is a plain
              wrapper here, so placement relative to it doesn't matter,
              it just needs to be mounted for the app's lifetime. */}
          <FilterCaptureHost />
        </CallProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

export default App;