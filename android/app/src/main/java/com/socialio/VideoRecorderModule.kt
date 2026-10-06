package com.socialio

import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.CamcorderProfile
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Surface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

class VideoRecorderModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName() = "VideoRecorderModule"

    private val cameraManager: CameraManager by lazy {
        reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    }

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var mediaRecorder: MediaRecorder? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var outputFilePath: String? = null
    private var previewSurfaceTexture: SurfaceTexture? = null
    private var isRecording = false

    private fun startBackgroundThread() {
        backgroundThread = HandlerThread("VideoRecorderThread").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try {
            backgroundThread?.join()
        } catch (e: InterruptedException) {
            sendEvent("onRecorderError", "Background thread interrupted: ${e.message}")
        }
        backgroundThread = null
        backgroundHandler = null
    }

    private fun sendEvent(eventName: String, message: String? = null) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, message)
    }

    private fun findCameraId(facingBack: Boolean): String? {
        val wantedFacing =
            if (facingBack) CameraCharacteristics.LENS_FACING_BACK
            else CameraCharacteristics.LENS_FACING_FRONT
        for (id in cameraManager.cameraIdList) {
            val chars = cameraManager.getCameraCharacteristics(id)
            if (chars.get(CameraCharacteristics.LENS_FACING) == wantedFacing) return id
        }
        return cameraManager.cameraIdList.firstOrNull()
    }

    @ReactMethod
    fun isSupported(promise: Promise) {
        promise.resolve(cameraManager.cameraIdList.isNotEmpty())
    }

    /**
     * previewTextureId: unused for camera selection (kept for backward JS
     * compatibility with existing startRecording(0, facingBack) calls) —
     * the actual preview surface is supplied by VideoRecorderPreviewView
     * calling setPreviewSurfaceTexture() directly via the companion
     * instance, whenever its TextureView becomes available.
     * facingBack: true for rear camera, false for front camera.
     */
    @ReactMethod
    fun startRecording(previewTextureId: Double, facingBack: Boolean, promise: Promise) {
        if (isRecording) {
            promise.reject("ALREADY_RECORDING", "A recording is already in progress")
            return
        }

        val cameraId = findCameraId(facingBack)
        if (cameraId == null) {
            promise.reject("NO_CAMERA", "No suitable camera device found")
            return
        }

        val dir = reactContext.cacheDir
        val file = File(dir, "story_video_${System.currentTimeMillis()}.mp4")
        outputFilePath = file.absolutePath

        startBackgroundThread()

        try {
            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(reactContext)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setOutputFile(outputFilePath)
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setVideoSize(1280, 720)
            recorder.setVideoFrameRate(30)
            recorder.setVideoEncodingBitRate(6_000_000)
            recorder.setOrientationHint(90)
            recorder.prepare()
            mediaRecorder = recorder

            if (androidx.core.content.ContextCompat.checkSelfPermission(
                    reactContext, android.Manifest.permission.CAMERA
                ) != android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                promise.reject("NO_PERMISSION", "Camera permission not granted")
                return
            }

            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    createCaptureSession(device, recorder, promise)
                }

                override fun onDisconnected(device: CameraDevice) {
                    device.close()
                    cameraDevice = null
                }

                override fun onError(device: CameraDevice, error: Int) {
                    device.close()
                    cameraDevice = null
                    promise.reject("CAMERA_ERROR", "Camera device error: $error")
                }
            }, backgroundHandler)
        } catch (e: Exception) {
            cleanupAfterFailure()
            promise.reject("START_FAILED", e.message, e)
        }
    }

    private fun createCaptureSession(device: CameraDevice, recorder: MediaRecorder, promise: Promise) {
        try {
            val recorderSurface = recorder.surface
            val surfaces = mutableListOf(recorderSurface)

            val texture = previewSurfaceTexture
            if (texture != null) {
                texture.setDefaultBufferSize(1280, 720)
                surfaces.add(Surface(texture))
            }

            device.createCaptureSession(
                surfaces,
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        captureSession = session
                        try {
                            val requestBuilder =
                                device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                            surfaces.forEach { requestBuilder.addTarget(it) }
                            requestBuilder.set(
                                CaptureRequest.CONTROL_MODE,
                                CameraMetadataControlModeAuto
                            )
                            session.setRepeatingRequest(
                                requestBuilder.build(), null, backgroundHandler
                            )
                            recorder.start()
                            isRecording = true
                            sendEvent("onRecordingStarted")
                            promise.resolve(outputFilePath)
                        } catch (e: Exception) {
                            promise.reject("SESSION_START_FAILED", e.message, e)
                        }
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        promise.reject("SESSION_CONFIG_FAILED", "Failed to configure capture session")
                    }
                },
                backgroundHandler
            )
        } catch (e: Exception) {
            promise.reject("SESSION_CREATE_FAILED", e.message, e)
        }
    }

     @ReactMethod
    fun stopRecording(promise: Promise) {
        if (!isRecording) {
            promise.reject("NOT_RECORDING", "No recording in progress")
            return
        }
        try {
            // IMPORTANT: stop the recorder FIRST, while its input surface is
            // still attached to a live capture session. MediaRecorder needs
            // its surface intact to finalize the MP4 container (write the
            // moov atom). Closing the session first tears down that surface
            // and produces a corrupt/unplayable file.
            captureSession?.stopRepeating()

            mediaRecorder?.apply {
                stop()
                reset()
                release()
            }
            mediaRecorder = null

            captureSession?.close()
            captureSession = null

            cameraDevice?.close()
            cameraDevice = null

            isRecording = false
            stopBackgroundThread()

            val finishedPath = outputFilePath
            sendEvent("onRecordingFinished", finishedPath)
            promise.resolve(finishedPath)
        } catch (e: Exception) {
            cleanupAfterFailure()
            promise.reject("STOP_FAILED", e.message, e)
        }
    }


    fun setPreviewSurfaceTexture(texture: SurfaceTexture?) {
        previewSurfaceTexture = texture
    }

    private fun cleanupAfterFailure() {
        try { mediaRecorder?.reset() } catch (_: Exception) {}
        try { mediaRecorder?.release() } catch (_: Exception) {}
        mediaRecorder = null
        try { captureSession?.close() } catch (_: Exception) {}
        captureSession = null
        try { cameraDevice?.close() } catch (_: Exception) {}
        cameraDevice = null
        isRecording = false
        stopBackgroundThread()
    }

    companion object {
        private const val CameraMetadataControlModeAuto =
            android.hardware.camera2.CameraMetadata.CONTROL_MODE_AUTO

        // Lets VideoRecorderPreviewView reach this module directly to hand
        // over its SurfaceTexture, without needing its own bridge lookup.
        @Volatile
        var instance: VideoRecorderModule? = null
            private set
    }
}