import { TestIds } from 'react-native-google-mobile-ads';
import Config from 'react-native-config';

// Keep true while developing. Set to false only for the Play Store release build.
export const USE_TEST_ADS = true;

// AdMob test IDs for Native Advanced (image) and Native Advanced Video.
// Read from .env (TEST_NATIVE_IMAGE / TEST_NATIVE_VIDEO); the Google test
// IDs are public, so they are also kept here as a fallback in case a
// variable is missing from .env.
// TestIds.GAM_NATIVE is an Ad Manager unit and often returns no media, so don't use it.
const TEST_NATIVE_IMAGE = Config.TEST_NATIVE_IMAGE 
const TEST_NATIVE_VIDEO = Config.TEST_NATIVE_VIDEO 

// Real ad unit IDs come from .env only (never hardcode them here):
//   ADMOB_NATIVE_ID  -> your real native unit (media: image and video)
//   ADMOB_BANNER_ID  -> your real banner unit
const REAL_NATIVE = Config.ADMOB_NATIVE_ID;
const REAL_BANNER = Config.ADMOB_BANNER_ID;

if (!USE_TEST_ADS && (!REAL_NATIVE || !REAL_BANNER)) {
  console.warn('[Socialio Ads] Missing ADMOB_NATIVE_ID or ADMOB_BANNER_ID in .env — real ads will not load.');
}

export const AD_UNIT_IDS = {
  // One native unit serves both image and video ads when created in AdMob
  // with "Media: image and video" allowed.
  native: USE_TEST_ADS
    ? TEST_NATIVE_VIDEO // returns video creatives, so you can test both
    : REAL_NATIVE,

  // Used by Explore Reels / Video page. Same real unit as above (swap in a
  // dedicated video-only unit ID here if you create one in AdMob). The ad
  // component also rejects any creative that has no video.
  nativeVideo: USE_TEST_ADS ? TEST_NATIVE_VIDEO : REAL_NATIVE,

  nativeImage: USE_TEST_ADS ? TEST_NATIVE_IMAGE : REAL_NATIVE,

  banner: USE_TEST_ADS ? TestIds.BANNER : REAL_BANNER,
};