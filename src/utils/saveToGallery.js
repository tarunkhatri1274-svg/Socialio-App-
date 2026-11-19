import { Platform } from "react-native";
import Config from "react-native-config";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";

const ALBUM = "Socialio";

// Server route that stamps the app logo (bottom-left) on images and videos.
// Must match where you mounted the router: app.use("/auth", downloadWatermarked)
const WATERMARK_ENDPOINT = `${Config.API_URL}/auth/download-watermarked`;

const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
};

async function fetchToCache(url, localPath, timeout) {
  const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true, timeout }).fetch("GET", url);
  const status = res.info().status;
  if (status < 200 || status >= 300) throw new Error(`Server returned ${status}`);
  return res;
}

/**
 * Downloads a remote photo/video, stamps the Socialio logo in the bottom-left
 * corner (done on the server) and saves it to the gallery album "Socialio"
 * (Android: Pictures/Socialio or Movies/Socialio, iOS: "Socialio" album).
 * Throws on failure, so the caller can show its own Alert.
 *
 *   saveMediaToGallery(url, { isVideo: true, name: "abc" })
 *   saveMediaToGallery(url, { isVideo: false, name: "abc", ext: "png" })
 *   saveMediaToGallery(url, { isVideo: false, watermark: false }) // original, no logo
 */
export async function saveMediaToGallery(url, { isVideo = false, name, ext, watermark = true } = {}) {
  let e = (ext || (isVideo ? "mp4" : "jpg")).toLowerCase();
  const canStamp = watermark && e !== "gif" && /^https?:/i.test(url); // animated GIFs can't be stamped
  const base = name || `socialio_${Date.now()}`;
  const paths = [];

  try {
    let res = null;

    if (canStamp) {
      // the server always returns a JPEG (images) or MP4 (videos)
      const stampedExt = isVideo ? "mp4" : "jpg";
      const p = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${base}_wm.${stampedExt}`;
      paths.push(p);
      try {
        const q = `${WATERMARK_ENDPOINT}?type=${isVideo ? "video" : "image"}&url=${encodeURIComponent(url)}`;
        res = await fetchToCache(q, p, 180000); // videos can take a while to process
        e = stampedExt;
      } catch (err) {
        console.log("[download] watermark failed, saving original:", err?.message);
        res = null;
      }
    }

    if (!res) {
      const p = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${base}.${e}`;
      paths.push(p);
      res = await fetchToCache(url, p);
    }

    const fileName = `${base}.${e}`;
    if (Platform.OS === "android") {
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: ALBUM, mimeType: MIME[e] || (isVideo ? "video/mp4" : "image/jpeg") },
        isVideo ? "Video" : "Image",
        res.path()
      );
    } else {
      await CameraRoll.save(`file://${res.path()}`, { type: isVideo ? "video" : "photo", album: ALBUM });
    }
  } finally {
    paths.forEach((p) => ReactNativeBlobUtil.fs.unlink(p).catch(() => {}));
  }
}