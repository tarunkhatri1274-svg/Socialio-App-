import React, { useRef, useState, useCallback } from "react";
import { View, Image, StyleSheet } from "react-native";
import ImageEditor from "@react-native-community/image-editor";
import ViewShot from "react-native-view-shot";
import {
  ColorMatrix,
  concatColorMatrices,
  contrast as contrastMatrix,
  saturate as saturateMatrix,
  brightness as brightnessMatrix,
  hueRotate as hueRotateMatrix,
  grayscale as grayscaleMatrix,
  sepia as sepiaMatrix,
  invert as invertMatrix,
} from "react-native-color-matrix-image-filters";

/**
 * getEditedImage(imageSrc, crop, filter)
 * ─────────────────────────────────────────────────────────────────────
 * Web version drew the source image onto a <canvas> with a crop
 * rectangle and a CSS `filter` string, then exported a Blob via
 * canvas.toBlob(). RN has neither <canvas> nor Blob, so this is split
 * into two real steps instead of one draw call:
 *
 *  1. CROP — @react-native-community/image-editor's ImageEditor.cropImage
 *     does the same job as ctx.drawImage(image, crop.x, crop.y,
 *     crop.width, crop.height, 0, 0, crop.width, crop.height): given a
 *     source uri and an { offset, size } rect, it returns a new cropped
 *     image uri. This part needs no visible UI and runs as a plain
 *     async call, same call shape as before.
 *
 *  2. FILTER (only if a filter string was passed) — there's no
 *     canvas-style ctx.filter in RN. Baking a CSS filter into a real
 *     output file means: render the cropped image through
 *     react-native-color-matrix-image-filters' <ColorMatrix> (GPU color
 *     matrix, same math category as CSS filters), then flatten that to
 *     a file with react-native-view-shot's captureRef. Both of those
 *     need an actual mounted React tree to work from — so this file
 *     exports a <FilterCaptureHost /> component that you mount ONCE,
 *     off-screen, near your app's root (e.g. in App.js next to
 *     <CallProvider>). getEditedImage() talks to it through a small
 *     registration callback instead of taking a ref directly, so call
 *     sites don't need to know it exists.
 *
 * Return shape changed from Blob → { uri, type, name } to match the
 * { uri, type, name } file-part shape RN's fetch/FormData expects
 * everywhere else in this app (see CreateImagePost.js / CreateTextPost.js).
 */

let _captureFilter = null; // registered by <FilterCaptureHost/> below

export function registerFilterCapture(fn) {
  _captureFilter = fn;
}

// ── Some versions of @react-native-community/image-editor resolve
// ImageEditor.cropImage() to a plain URI string; others resolve to an
// object shaped like { uri, width, height, size, name }. Always unwrap
// to a plain string here so every caller downstream (getEditedImage,
// the filter capture host, and ultimately the FormData upload in
// CreateImagePost.js/AddImagePost.js) can safely treat the result as a
// string. Without this, a raw object got interpolated into a template
// string as "[object Object]" — producing an unreadable
// "file://[object Object]" uri and a generic upload failure.
function unwrapImageEditorResult(result) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && typeof result.uri === "string") {
    return result.uri;
  }
  throw new Error(
    `ImageEditor.cropImage() returned an unexpected shape: ${JSON.stringify(result)}`
  );
}

// ── Parse a CSS filter string like "brightness(1.2) contrast(1.1)
// saturate(1.3) grayscale(0.5)" into one combined color matrix. Only the
// functions with a real color-matrix equivalent are supported — this
// covers everything cropimage.js's callers actually pass (brightness /
// contrast / saturate / grayscale / sepia / invert / hue-rotate). Drop-
// shadow, blur, and opacity have no color-matrix equivalent and are
// silently ignored if present, since none of this app's filter presets
// use them.
export function parseCssFilterToMatrix(filterString) {
  if (!filterString) return null;
  const matrices = [];
  const fnRegex = /([a-z-]+)\(([^)]+)\)/g;
  let match;
  while ((match = fnRegex.exec(filterString))) {
    const [, name, rawArg] = match;
    const arg = parseFloat(rawArg);
    switch (name) {
      case "brightness":
        matrices.push(brightnessMatrix(arg));
        break;
      case "contrast":
        matrices.push(contrastMatrix(arg));
        break;
      case "saturate":
        matrices.push(saturateMatrix(arg));
        break;
      case "grayscale":
        matrices.push(grayscaleMatrix(arg));
        break;
      case "sepia":
        matrices.push(sepiaMatrix(arg));
        break;
      case "invert":
        matrices.push(invertMatrix(arg));
        break;
      case "hue-rotate": {
        const deg = parseFloat(rawArg); // e.g. "90deg" -> 90
        matrices.push(hueRotateMatrix(deg));
        break;
      }
      default:
        break; // blur()/drop-shadow()/opacity() — no matrix equivalent, skip
    }
  }
  if (matrices.length === 0) return null;
  return matrices.length === 1 ? matrices[0] : concatColorMatrices(...matrices);
}

/**
 * Mount this once, off-screen, near your app root. It renders nothing
 * visible (positioned far off the actual viewport) but stays mounted so
 * getEditedImage() can hand it a { uri, matrix, width, height } job at
 * any time and get back a flattened file uri.
 */
export function FilterCaptureHost() {
  const shotRef = useRef(null);
  const [job, setJob] = useState(null); // { uri, matrix, width, height, resolve, reject }

  const runCapture = useCallback((uri, matrix, width, height) => {
    return new Promise((resolve, reject) => {
      setJob({ uri, matrix, width, height, resolve, reject });
    });
  }, []);

  registerFilterCapture(runCapture);

  const handleImageReady = async () => {
    if (!job || !shotRef.current) return;
    try {
      const capturedUri = await shotRef.current.capture();
      job.resolve(capturedUri);
    } catch (e) {
      job.reject(e);
    } finally {
      setJob(null);
    }
  };

  if (!job) return null;

  return (
    <View style={styles.offscreen} pointerEvents="none">
      <ViewShot
        ref={shotRef}
        options={{ format: "jpg", quality: 0.92, width: job.width, height: job.height }}
        style={{ width: job.width, height: job.height }}
      >
        <ColorMatrix matrix={job.matrix}>
          <Image
            source={{ uri: job.uri }}
            style={{ width: job.width, height: job.height }}
            resizeMode="cover"
            onLoadEnd={handleImageReady}
          />
        </ColorMatrix>
      </ViewShot>
    </View>
  );
}

const styles = StyleSheet.create({
  // Kept mounted (not `display: none`, which some capture libraries skip)
  // but pushed far outside any visible scroll area.
  offscreen: { position: "absolute", top: -10000, left: -10000 },
});

export default async function getEditedImage(imageSrc, crop, filter) {
  // Need the source image's native dimensions to default the crop rect
  // when none was passed in, same as the web version falling back to
  // image.naturalWidth/naturalHeight.
  const { width: naturalWidth, height: naturalHeight } = await new Promise((resolve, reject) => {
    Image.getSize(
      imageSrc,
      (w, h) => resolve({ width: w, height: h }),
      (err) => reject(err)
    );
  });

  const cropRect =
    crop && crop.width && crop.height
      ? crop
      : { x: 0, y: 0, width: naturalWidth, height: naturalHeight };

  const rawCropResult = await ImageEditor.cropImage(imageSrc, {
    offset: { x: cropRect.x, y: cropRect.y },
    size: { width: cropRect.width, height: cropRect.height },
  });
  // ← FIX: cropImage() can resolve to a plain string OR an
  // { uri, width, height } object depending on the installed version —
  // always normalize to a plain string before it's used anywhere else.
  const croppedUri = unwrapImageEditorResult(rawCropResult);

  if (!filter) {
    return { uri: croppedUri, type: "image/jpeg", name: `edited-${Date.now()}.jpg` };
  }

  const matrix = parseCssFilterToMatrix(filter);
  if (!matrix) {
    // Filter string had nothing we can represent as a color matrix
    // (e.g. only blur()/opacity()) — fall back to the unfiltered crop
    // rather than failing the whole post.
    return { uri: croppedUri, type: "image/jpeg", name: `edited-${Date.now()}.jpg` };
  }

  if (!_captureFilter) {
    console.warn(
      "getEditedImage: a filter was requested but <FilterCaptureHost/> isn't mounted — returning the unfiltered crop. Mount <FilterCaptureHost/> once near your app root to enable filters."
    );
    return { uri: croppedUri, type: "image/jpeg", name: `edited-${Date.now()}.jpg` };
  }

  const rawFilteredResult = await _captureFilter(croppedUri, matrix, cropRect.width, cropRect.height);
  // ← Same normalization here — react-native-view-shot's capture() is
  // consistently a string in practice, but this keeps both steps
  // symmetric/defensive in case that ever changes too.
  const filteredUri = unwrapImageEditorResult(rawFilteredResult);
  return { uri: filteredUri, type: "image/jpeg", name: `edited-${Date.now()}.jpg` };
}