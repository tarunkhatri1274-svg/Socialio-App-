package com.socialio

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.TextureView

/**
 * The JS-facing <VideoRecorderPreview> native component. This is a plain
 * TextureView — it does NOT open a camera itself. Instead, as soon as its
 * SurfaceTexture is ready, it hands that texture to VideoRecorderModule,
 * which attaches it as a second output target on the SAME Camera2 capture
 * session it uses for MediaRecorder (see createCaptureSession in
 * VideoRecorderModule.kt). That's what makes this safe: there is still
 * only ONE CameraDevice open on camera "0" at a time — this view just
 * receives frames from that single session, it never competes for the
 * device the way VisionCamera's <Camera> did.
 */
class VideoRecorderPreviewView(context: Context) :
    TextureView(context), TextureView.SurfaceTextureListener {

    init {
        surfaceTextureListener = this
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        VideoRecorderModule.instance?.setPreviewSurfaceTexture(surface)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        // no-op — the capture session's buffer size is fixed at 1280x720 in
        // VideoRecorderModule.createCaptureSession regardless of view size
    }

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        VideoRecorderModule.instance?.setPreviewSurfaceTexture(null)
        return true // we're releasing it ourselves via detach, not TextureView
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
        // fires every frame — nothing to do, TextureView draws itself
    }
}