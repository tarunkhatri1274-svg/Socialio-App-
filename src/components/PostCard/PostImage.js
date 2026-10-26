// PostImage.js — lets post images show IN FULL instead of being cropped to a fixed box.
//
// Problem: feeds and the post card drew every photo in a fixed-height box
// (420 / 460 / 350) with resizeMode="cover", which crops anything that isn't
// that exact shape — a wide photo lost its sides, a tall one lost top and bottom.
//
// Fix: look up each photo's real width/height once (cached), size the box from
// that shape, and draw with resizeMode="contain" so nothing is ever cut off.
// For a carousel, the FIRST photo sets the box height for every slide (like
// Instagram), so swiping doesn't make the post jump around.

import { useEffect, useState } from "react";
import { Image, Dimensions } from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;

// Shapes outside this range are letterboxed (centred with bars) rather than
// making the post absurdly tall or thin.
const MIN_RATIO = 0.56; // 9:16 portrait
const MAX_RATIO = 2.0; // 2:1 landscape

const aspectCache = new Map(); // url -> width / height
const pending = new Map(); // url -> Promise<number|null>

export const clampRatio = (r) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));

/** Box height for a photo of shape `ratio` shown `width` wide (pure, testable). */
export function ratioToHeight(ratio, width, fallbackHeight = 420) {
  if (!ratio || !isFinite(ratio) || ratio <= 0) return fallbackHeight;
  return Math.round(Math.min(width / clampRatio(ratio), SCREEN_HEIGHT * 0.8));
}

/** Resolves a photo's width / height (null if it can't be read). Cached per URL. */
export function getImageAspect(url) {
  if (!url) return Promise.resolve(null);
  if (aspectCache.has(url)) return Promise.resolve(aspectCache.get(url));
  if (!pending.has(url)) {
    pending.set(
      url,
      new Promise((resolve) => {
        Image.getSize(
          url,
          (w, h) => {
            const r = w > 0 && h > 0 ? w / h : null;
            if (r) aspectCache.set(url, r);
            pending.delete(url);
            resolve(r);
          },
          () => {
            pending.delete(url);
            resolve(null);
          }
        );
      })
    );
  }
  return pending.get(url);
}

/** width / height of the photo at `url`, or null until it's known. */
export function useImageAspect(url) {
  const [ratio, setRatio] = useState(() => (url ? aspectCache.get(url) || null : null));
  useEffect(() => {
    let alive = true;
    if (!url) {
      setRatio(null);
      return undefined;
    }
    const cached = aspectCache.get(url);
    if (cached) {
      setRatio(cached);
      return undefined;
    }
    getImageAspect(url).then((r) => {
      if (alive && r) setRatio(r);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return ratio;
}

/**
 * Height for a whole carousel, taken from its first photo.
 * A video first slide (or an unreadable photo) keeps `fallbackHeight`.
 */
export function useCarouselHeight(media, width, fallbackHeight = 420) {
  const first = media && media[0];
  const url = first && first.type !== "video" ? first.url : null;
  const ratio = useImageAspect(url);
  return ratioToHeight(ratio, width, fallbackHeight);
}