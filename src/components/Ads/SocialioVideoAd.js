import React, { useEffect, useState } from 'react';
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';
import { AD_UNIT_IDS } from './AdConfig';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAX_TRIES = 3;

/**
 * Full-screen native ad (Reels / Video page / Stories).
 * Props:
 * - requireVideo (default true): reject creatives without video and retry
 *   up to MAX_TRIES times. Pass false to allow image AND video ads.
 * - unitId: ad unit to request (default: AD_UNIT_IDS.nativeVideo).
 * - onLoaded(): called once an acceptable ad is ready.
 * - onFailed(): called if no acceptable ad could be loaded, so the parent
 *   can drop this slot instead of leaving a blank page.
 * - style: extra style for the page container.
 */
export default function SocialioVideoAd({
  onFailed,
  onLoaded,
  requireVideo = true,
  unitId = AD_UNIT_IDS.nativeVideo,
  style,
}) {
  const [nativeAd, setNativeAd] = useState(null);

  useEffect(() => {
    let active = true;
    let current = null;

    const load = async (attempt) => {
      try {
        const ad = await NativeAd.createForAdRequest(unitId, {
          startVideoMuted: true,
        });
        if (!active) {
          ad.destroy();
          return;
        }
        if (requireVideo && !ad.mediaContent?.hasVideoContent) {
          ad.destroy();
          if (attempt < MAX_TRIES) load(attempt + 1);
          else onFailed?.();
          return;
        }
        current = ad;
        setNativeAd(ad);
        onLoaded?.();
      } catch (e) {
        console.log('[Socialio Ads] Reels video ad failed:', e);
        if (!active) return;
        if (attempt < MAX_TRIES) load(attempt + 1);
        else onFailed?.();
      }
    };
    load(1);

    return () => {
      active = false;
      current?.destroy();
    };
  }, []);

  if (!nativeAd) return <View style={[styles.page, style]} />;

  return (
    <NativeAdView nativeAd={nativeAd} style={[styles.page, style]}>
      <NativeMediaView resizeMode="contain" style={styles.media} />

      <View style={styles.bottom}>
        <View style={styles.header}>
          {nativeAd.icon?.url ? (
            <NativeAsset assetType={NativeAssetType.ICON}>
              <Image source={{ uri: nativeAd.icon.url }} style={styles.icon} />
            </NativeAsset>
          ) : (
            <View style={[styles.icon, { backgroundColor: '#EAB676' }]} />
          )}
          <View style={{ flex: 1 }}>
            <NativeAsset assetType={NativeAssetType.HEADLINE}>
              <Text style={styles.headline} numberOfLines={1}>
                {nativeAd.headline}
              </Text>
            </NativeAsset>
            <Text style={styles.sponsored}>
              Sponsored{nativeAd.advertiser ? ` · ${nativeAd.advertiser}` : ''}
            </Text>
          </View>
        </View>

        {nativeAd.body ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={styles.body} numberOfLines={2}>
              {nativeAd.body}
            </Text>
          </NativeAsset>
        ) : null}

        {nativeAd.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={styles.cta}>
              <Text style={styles.ctaText}>{nativeAd.callToAction}</Text>
            </View>
          </NativeAsset>
        ) : null}
      </View>
    </NativeAdView>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', height: SCREEN_HEIGHT, backgroundColor: '#000' },
  media: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: 'rgba(0,0,0,0.35)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 44 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#333' },
  headline: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sponsored: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 1 },
  body: { color: '#fff', fontSize: 13, marginTop: 10 },
  cta: { backgroundColor: '#EAB676', marginTop: 12, paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  ctaText: { color: '#222', fontWeight: '700', fontSize: 14 },
});