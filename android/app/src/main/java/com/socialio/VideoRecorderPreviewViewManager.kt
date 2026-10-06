package com.socialio

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class VideoRecorderPreviewViewManager : SimpleViewManager<VideoRecorderPreviewView>() {

    override fun getName() = "VideoRecorderPreview"

    override fun createViewInstance(reactContext: ThemedReactContext): VideoRecorderPreviewView {
        return VideoRecorderPreviewView(reactContext)
    }

    override fun onDropViewInstance(view: VideoRecorderPreviewView) {
        super.onDropViewInstance(view)
        // Screen navigated away / component unmounted mid-recording —
        // don't leave a stale texture reference behind.
        VideoRecorderModule.instance?.setPreviewSurfaceTexture(null)
    }
}