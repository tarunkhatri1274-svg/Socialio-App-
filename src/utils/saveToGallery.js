import { Platform } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";
import { CameraRoll } from "@react-native-camera-roll/camera-roll";

const ALBUM = "Socialio";

export async function saveMediaToGallery(url, { isVideo = false, name } = {}) {
  const fileName = `${name || `socialio_${Date.now()}`}.${isVideo ? "mp4" : "jpg"}`;
  const localPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;
  try {
    const res = await ReactNativeBlobUtil.config({ path: localPath, fileCache: true }).fetch("GET", url);
    const status = res.info().status;
    if (status < 200 || status >= 300) throw new Error(`Server returned ${status}`);

    if (Platform.OS === "android") {
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
        { name: fileName, parentFolder: ALBUM, mimeType: isVideo ? "video/mp4" : "image/jpeg" },
        isVideo ? "Video" : "Image",
        res.path()
      );
    } else {
      await CameraRoll.save(`file://${res.path()}`, { type: isVideo ? "video" : "photo", album: ALBUM });
    }
  } finally {
    ReactNativeBlobUtil.fs.unlink(localPath).catch(() => {});
  }
}