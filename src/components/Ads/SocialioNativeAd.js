
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

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function SocialioNativeAd() {
  const [nativeAd, setNativeAd] = useState(null);

  useEffect(() => {
    let active = true;
    let loadedAd = null;

    NativeAd.createForAdRequest(AD_UNIT_IDS.native, {
      startVideoMuted: true,
    })
      .then((ad) => {
        if (active) {
          loadedAd = ad;
          setNativeAd(ad);
        } else {
          ad.destroy();
        }
      })
      .catch((error) => {
        console.log('[Socialio Ads] Native ad failed to load:', error);
      });

    return () => {
      active = false;
      loadedAd?.destroy();
    };
  }, []);

  if (!nativeAd) return null;

  // Size the media like a post image: full width, ratio from the creative,
  // clamped between 4:5 (portrait) and 1.91:1 (landscape).
  const rawRatio = nativeAd.mediaContent?.aspectRatio || 1;
  const ratio = Math.min(Math.max(rawRatio, 0.8), 1.91);
  const mediaHeight = SCREEN_WIDTH / ratio;

  return (
    <NativeAdView nativeAd={nativeAd} style={styles.card}>
      {/* Header: same layout as a post header */}
      <View style={styles.header}>
        {nativeAd.icon?.url ? (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: nativeAd.icon.url }} style={styles.icon} />
          </NativeAsset>
        ) : (
          <View style={[styles.icon, styles.iconFallback]} />
        )}

        <View style={styles.headerText}>
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

      {/* Full-width image or video */}
      <NativeMediaView
        resizeMode="cover"
        style={{ width: SCREEN_WIDTH, height: mediaHeight, backgroundColor: '#000' }}
      />

      {/* Instagram-style CTA bar under the media */}
      {nativeAd.callToAction ? (
        <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
          <View style={styles.ctaBar}>
            <Text style={styles.ctaText}>{nativeAd.callToAction}</Text>
          </View>
        </NativeAsset>
      ) : null}

      {/* Caption */}
      {nativeAd.body ? (
        <NativeAsset assetType={NativeAssetType.BODY}>
          <Text style={styles.body} numberOfLines={3}>
            {nativeAd.body}
          </Text>
        </NativeAsset>
      ) : null}
    </NativeAdView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#efefef',
    paddingBottom: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 44, // leaves room for the AdChoices icon (top right)
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: '#f0f0f0',
  },
  iconFallback: { backgroundColor: '#EAB676' },
  headerText: { flex: 1 },
  headline: { color: '#222222', fontSize: 14, fontWeight: '700' },
  sponsored: { color: '#777777', fontSize: 11, marginTop: 1 },
  ctaBar: {
    backgroundColor: '#EAB676',
    marginHorizontal: 12,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaText: { color: '#222222', fontWeight: '700', fontSize: 14 },
  body: {
    color: '#333333',
    fontSize: 13,
    paddingHorizontal: 12,
    marginTop: 10,
  },
});