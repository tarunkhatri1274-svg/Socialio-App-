// EditRender.js — bakes the Edit screen's result into a real JPEG file WITHOUT
// taking a screenshot.
//
// Why this exists: react-native-view-shot hands back blank (all black / all
// white) or 0-byte images for the edit frame on this device. Instead of reading
// pixels back from the screen, this redraws the edit from its numbers — the same
// ones the preview uses:
//
//   • the image is fitted to the frame with resizeMode="cover" (centred),
//   • then transformed around the frame centre by
//       translate(offsetX, offsetY) → scale(zoom) → rotate(rotation) → flipX,
//   • then the colour-matrix filter is applied to the image pixels,
//   • anything the image doesn't cover shows the frame's #111 background.
//
// Two engines, same result:
//
//   1. SKIA (fast — tens of milliseconds, native, GPU/CPU). Used automatically when
//      @shopify/react-native-skia is installed.
//   2. PURE JS (slow — roughly 20+ seconds per photo on a low-end phone, because
//      decoding, filtering and re-encoding JPEG pixels in JavaScript is slow).
//      Used when Skia isn't installed or fails. Needs: npm install jpeg-js buffer
//
// Output is written at the photo's OWN resolution (1 source pixel → 1 output pixel
// at zoom 1) — never upscaled — so nothing gets blurrier than the original.

import { Buffer } from "buffer";
import jpeg from "jpeg-js";
import ReactNativeBlobUtil from "react-native-blob-util";

// Optional native engine. React Native's Metro config treats a try/catch require as
// optional, so the app still builds and runs if Skia isn't installed.
let SkiaLib = null;
try {
  // eslint-disable-next-line global-require
  SkiaLib = require("@shopify/react-native-skia");
} catch (e) {
  SkiaLib = null;
}

// jpeg-js looks up a global Buffer, which React Native doesn't provide.
if (typeof global !== "undefined" && typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}

// true when the fast native engine is available
export const SKIA_AVAILABLE = !!(SkiaLib && SkiaLib.Skia);

const BG = [17, 17, 17]; // EditPost's styles.frame backgroundColor "#111"
const MAX_OUT_W = 1080;
const MAX_OUT_H = 1920;
const MIN_OUT_W = 540; // protects against tiny output when heavily zoomed
const JPEG_QUALITY = 92;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// sin/cos for the 0/90/180/270 the rotate buttons produce — exact, no float noise.
function sinCos(deg) {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  if (d === 0) return [0, 1];
  if (d === 90) return [1, 0];
  if (d === 180) return [0, -1];
  if (d === 270) return [-1, 0];
  const r = (d * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

/**
 * Output size for a spec, given the decoded source size (iw × ih).
 *
 * Natural scale = 1 / (k * zoom): exactly one output pixel per source pixel, where
 * k is the resizeMode="cover" factor (frame dp per source px). It's clamped so the
 * result is never wider than 1080 / taller than 1920 and never narrower than 540.
 * Returns { scale (output px per frame dp), k, outW, outH }.
 */
export function planOutput(spec, iw, ih) {
  const minW = spec.minOutW != null ? spec.minOutW : MIN_OUT_W;
  const maxW = spec.maxOutW != null ? spec.maxOutW : MAX_OUT_W;
  const maxH = spec.maxOutH != null ? spec.maxOutH : MAX_OUT_H;
  const k = Math.max(spec.frameW / iw, spec.frameH / ih);
  const natural = 1 / (k * (spec.zoom || 1));
  const hi = Math.min(maxW / spec.frameW, maxH / spec.frameH);
  const lo = Math.min(minW / spec.frameW, hi);
  const scale = Math.max(lo, Math.min(natural, hi));
  return {
    k,
    scale,
    outW: Math.max(1, Math.round(spec.frameW * scale)),
    outH: Math.max(1, Math.round(spec.frameH * scale)),
  };
}

const isNearInt = (x, eps = 1e-6) => Math.abs(x - Math.round(x)) < eps;

/**
 * renderPixels(src, spec, matrix, onProgress) → { data, width, height }
 *
 * PURE-JS engine. src: { data: Uint8Array RGBA, width, height };
 * matrix: 20 numbers in Android units (offsets 0–255) or null.
 *
 * Walks every OUTPUT pixel, maps it back through the inverse of the preview's
 * transform to a source point, samples it, applies the colour matrix, writes it.
 * When the mapping is an exact 1:1 pixel lattice (the common "just a filter" case)
 * it skips bilinear sampling and copies pixels directly — both faster and sharper.
 */
export async function renderPixels(src, spec, matrix, onProgress) {
  const { data: sd, width: iw, height: ih } = src;
  const { k, scale: s, outW, outH } = planOutput(spec, iw, ih);
  const { frameW: W, frameH: H, tx, ty, rotation, flip } = spec;
  const zoom = spec.zoom || 1;

  const out = new Uint8Array(outW * outH * 4);
  const [sn, c] = sinCos(rotation);
  const fl = flip ? -1 : 1;
  const g = 1 / (s * zoom * k); // source pixels advanced per output pixel

  const xp0 = (0.5 / s - W / 2 - tx) / zoom;
  const yp0 = (0.5 / s - H / 2 - ty) / zoom;
  const sx0 = (fl * (c * xp0 + sn * yp0)) / k + iw / 2;
  const sy0 = (-sn * xp0 + c * yp0) / k + ih / 2;
  const dsxU = fl * c * g;
  const dsyU = -sn * g;
  const dsxV = fl * sn * g;
  const dsyV = c * g;

  // Exact pixel-lattice mapping? (steps are whole pixels, start is at a pixel centre)
  const lattice =
    isNearInt(dsxU) && isNearInt(dsyU) && isNearInt(dsxV) && isNearInt(dsyV) &&
    isNearInt(sx0 - 0.5, 1e-3) && isNearInt(sy0 - 0.5, 1e-3);
  const idsxU = Math.round(dsxU), idsyU = Math.round(dsyU);
  const idsxV = Math.round(dsxV), idsyV = Math.round(dsyV);
  const ix0 = Math.round(sx0 - 0.5), iy0 = Math.round(sy0 - 0.5);

  const hasM = !!matrix;
  const m = matrix;
  const ALPHA = 255;

  for (let v = 0; v < outH; v++) {
    let o = v * outW * 4;

    if (lattice) {
      // ── fast path: straight pixel copy + colour matrix ──
      const rowX = ix0 + v * idsxV;
      const rowY = iy0 + v * idsyV;
      for (let u = 0; u < outW; u++, o += 4) {
        const x = rowX + u * idsxU;
        const y = rowY + u * idsyU;
        if (x < 0 || y < 0 || x >= iw || y >= ih) {
          out[o] = BG[0]; out[o + 1] = BG[1]; out[o + 2] = BG[2]; out[o + 3] = 255;
          continue;
        }
        const i = (y * iw + x) * 4;
        let r = sd[i], gC = sd[i + 1], b = sd[i + 2];
        if (hasM) {
          const nr = m[0] * r + m[1] * gC + m[2] * b + m[3] * ALPHA + m[4];
          const ng = m[5] * r + m[6] * gC + m[7] * b + m[8] * ALPHA + m[9];
          const nb = m[10] * r + m[11] * gC + m[12] * b + m[13] * ALPHA + m[14];
          r = nr; gC = ng; b = nb;
        }
        out[o] = r < 0 ? 0 : r > 255 ? 255 : (r + 0.5) | 0;
        out[o + 1] = gC < 0 ? 0 : gC > 255 ? 255 : (gC + 0.5) | 0;
        out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : (b + 0.5) | 0;
        out[o + 3] = 255;
      }
    } else {
      // ── general path: bilinear sampling ──
      const rowX = sx0 + v * dsxV;
      const rowY = sy0 + v * dsyV;
      for (let u = 0; u < outW; u++, o += 4) {
        const sx = rowX + u * dsxU;
        const sy = rowY + u * dsyU;
        if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) {
          out[o] = BG[0]; out[o + 1] = BG[1]; out[o + 2] = BG[2]; out[o + 3] = 255;
          continue;
        }
        const fx = sx - 0.5;
        const fy = sy - 0.5;
        let x0 = Math.floor(fx);
        let y0 = Math.floor(fy);
        const wx = fx - x0;
        const wy = fy - y0;
        let x1 = x0 + 1;
        let y1 = y0 + 1;
        if (x0 < 0) x0 = 0;
        if (y0 < 0) y0 = 0;
        if (x1 > iw - 1) x1 = iw - 1;
        if (y1 > ih - 1) y1 = ih - 1;

        const i00 = (y0 * iw + x0) * 4;
        const i10 = (y0 * iw + x1) * 4;
        const i01 = (y1 * iw + x0) * 4;
        const i11 = (y1 * iw + x1) * 4;
        const w00 = (1 - wx) * (1 - wy);
        const w10 = wx * (1 - wy);
        const w01 = (1 - wx) * wy;
        const w11 = wx * wy;

        let r = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        let gC = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        let b = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;

        if (hasM) {
          const nr = m[0] * r + m[1] * gC + m[2] * b + m[3] * ALPHA + m[4];
          const ng = m[5] * r + m[6] * gC + m[7] * b + m[8] * ALPHA + m[9];
          const nb = m[10] * r + m[11] * gC + m[12] * b + m[13] * ALPHA + m[14];
          r = nr; gC = ng; b = nb;
        }
        out[o] = r < 0 ? 0 : r > 255 ? 255 : (r + 0.5) | 0;
        out[o + 1] = gC < 0 ? 0 : gC > 255 ? 255 : (gC + 0.5) | 0;
        out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : (b + 0.5) | 0;
        out[o + 3] = 255;
      }
    }

    // Hand the JS thread back regularly so the app stays responsive.
    if (v % 24 === 23) {
      if (onProgress) onProgress((v + 1) / outH);
      await tick();
    }
  }
  if (onProgress) onProgress(1);
  return { data: out, width: outW, height: outH, lattice };
}

const toPath = (uri) => decodeURIComponent(String(uri).replace(/^file:\/\//, ""));
const newPath = () =>
  `${ReactNativeBlobUtil.fs.dirs.CacheDir}/edited-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;

// ───────────────────────────── engine 1: Skia ─────────────────────────────

// Skia's colour matrix takes the 5th-column offsets as 0–1 fractions; ours are 0–255.
const toSkiaMatrix = (m) => m.map((v, i) => (i % 5 === 4 ? v / 255 : v));

async function renderWithSkia(spec, matrix) {
  const { Skia, ImageFormat, FilterMode, MipmapMode } = SkiaLib;
  const t0 = Date.now();

  let data;
  try {
    data = await Skia.Data.fromURI(spec.uri);
  } catch (e) {
    const b64 = await ReactNativeBlobUtil.fs.readFile(toPath(spec.uri), "base64");
    data = Skia.Data.fromBase64(b64);
  }
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error("Skia could not decode the image");
  const iw = img.width();
  const ih = img.height();

  const { k, scale: s, outW, outH } = planOutput(spec, iw, ih);
  const surface = Skia.Surface.MakeOffscreen(outW, outH);
  if (!surface) throw new Error("Skia could not create an offscreen surface");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("#111111"));

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  if (matrix) paint.setColorFilter(Skia.ColorFilter.MakeMatrix(toSkiaMatrix(matrix)));

  // Same transform chain as the preview: translate → scale → rotate → flipX, about
  // the frame centre, with the image cover-fitted and centred on the origin.
  canvas.save();
  canvas.scale(s, s);
  canvas.translate(spec.frameW / 2 + spec.tx, spec.frameH / 2 + spec.ty);
  canvas.scale(spec.zoom || 1, spec.zoom || 1);
  canvas.rotate(spec.rotation || 0, 0, 0);
  canvas.scale(spec.flip ? -1 : 1, 1);
  const src = Skia.XYWHRect(0, 0, iw, ih);
  const dst = Skia.XYWHRect((-iw * k) / 2, (-ih * k) / 2, iw * k, ih * k);
  if (typeof canvas.drawImageRectOptions === "function") {
    canvas.drawImageRectOptions(img, src, dst, FilterMode.Linear, MipmapMode.None, paint);
  } else {
    canvas.drawImageRect(img, src, dst, paint);
  }
  canvas.restore();

  if (typeof surface.flush === "function") surface.flush();
  const b64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, JPEG_QUALITY);
  if (!b64 || b64.length < 1000) throw new Error("Skia produced an empty image");

  const path = newPath();
  await ReactNativeBlobUtil.fs.writeFile(path, b64, "base64");
  return {
    uri: `file://${path}`,
    type: "image/jpeg",
    name: `edited-${Date.now()}.jpg`,
    width: outW,
    height: outH,
    engine: "skia",
    ms: Date.now() - t0,
  };
}

// ───────────────────────────── engine 2: pure JS ─────────────────────────────

async function renderWithJs(spec, matrix, onProgress) {
  const started = Date.now();
  const srcB64 = await ReactNativeBlobUtil.fs.readFile(toPath(spec.uri), "base64");
  const decoded = jpeg.decode(Buffer.from(srcB64, "base64"), {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 1024,
    maxResolutionInMP: 40,
  });
  const tDecode = Date.now() - started;

  const img = await renderPixels(decoded, spec, matrix, onProgress);
  const tRender = Date.now() - started - tDecode;

  const encoded = jpeg.encode({ data: img.data, width: img.width, height: img.height }, JPEG_QUALITY);
  const outB64 = Buffer.from(encoded.data).toString("base64");
  const path = newPath();
  await ReactNativeBlobUtil.fs.writeFile(path, outB64, "base64");

  console.log(
    `[RENDER] js ${decoded.width}x${decoded.height} -> ${img.width}x${img.height}` +
      `${img.lattice ? " (1:1 copy)" : ""} decode=${tDecode}ms render=${tRender}ms total=${Date.now() - started}ms`
  );
  return {
    uri: `file://${path}`,
    type: "image/jpeg",
    name: `edited-${Date.now()}.jpg`,
    width: img.width,
    height: img.height,
    engine: "js",
    ms: Date.now() - started,
  };
}

/**
 * renderEditedImage(spec, matrix, onProgress) → { uri, type, name, width, height, engine, ms }
 *
 * spec.uri must be a local JPEG (the Edit screen's resized working copy).
 * Throws only if BOTH engines fail, so the caller can fall back to another method.
 */
export async function renderEditedImage(spec, matrix, onProgress) {
  if (SKIA_AVAILABLE) {
    try {
      const res = await renderWithSkia(spec, matrix);
      console.log(`[RENDER] skia -> ${res.width}x${res.height} in ${res.ms}ms`);
      if (onProgress) onProgress(1);
      return res;
    } catch (e) {
      console.log("[RENDER] Skia engine failed, using the slower JS engine:", e?.message);
    }
  } else {
    console.log("[RENDER] Skia not installed — using the slower JS engine");
  }
  return renderWithJs(spec, matrix, onProgress);
}