import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, Image, TouchableOpacity, Modal, Animated, StyleSheet, Platform,
  PermissionsAndroid, NativeEventEmitter, NativeModules,
} from "react-native";
import Svg, { Path, Polygon, Rect, Line, Polyline } from "react-native-svg";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  RTCView,
  mediaDevices,
  MediaStream,
} from "react-native-webrtc";
import InCallManager from "react-native-incall-manager";
import socket from "../../sockets/Sockets";
import { ICE_SERVERS } from "../../sockets/iceServers";

const GOLDEN = "rgb(234,182,118)";

/* ─────────────────────────── Icons (react-native-svg) ─────────────────────────── */
export const SpeakerIcon = ({ on, color = "#fff", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {on ? (
      <>
        <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </>
    ) : (
      <Line x1="23" y1="9" x2="17" y2="15" />
    )}
  </Svg>
);

export const BluetoothIcon = ({ on, color = "#fff", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill={on ? color : "none"} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" />
  </Svg>
);

export const VideoIcon = ({ color = "#fff", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Polygon points="23 7 16 12 23 17 23 7" />
    <Rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </Svg>
);

export const MicIcon = ({ color = "#fff", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Rect x="9" y="2" width="6" height="11" rx="3" />
    <Path d="M19 10a7 7 0 0 1-14 0" />
    <Line x1="12" y1="19" x2="12" y2="23" />
    <Line x1="8" y1="23" x2="16" y2="23" />
  </Svg>
);

export const MicOffIcon = ({ color = "#fff", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Line x1="1" y1="1" x2="23" y2="23" />
    <Path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <Path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <Line x1="12" y1="19" x2="12" y2="23" />
    <Line x1="8" y1="23" x2="16" y2="23" />
  </Svg>
);

export const PhoneOffIcon = ({ color = "#fff", size = 26 }) => (
  <View style={{ transform: [{ rotate: "135deg" }] }}>
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path
        fill={color}
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
      />
    </Svg>
  </View>
);

export const PhoneAcceptIcon = ({ color = "#fff", size = 26 }) => (
  <Svg viewBox="0 0 24 24" fill={color} width={size} height={size}>
    <Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </Svg>
);

export const FlipCameraIcon = ({ color = "#fff", size = 22 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Path d="M23 4v6h-6" />
    <Path d="M1 20v-6h6" />
    <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </Svg>
);

/* ─────────────────────────── Avatar ─────────────────────────── */
const COLORS = ["#e74c3c", "#e67e22", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c", "#e91e63", "#ff5722"];
const getColor = (str) => COLORS[(str?.charCodeAt(0) || 0) % COLORS.length];
const getInitials = (name) =>
  name?.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?";

export function Avatar({ user, size = 42, extraStyle = {} }) {
  const bg = getColor(user?.username || user?.name || "");
  const initials = getInitials(user?.username || user?.name || "");
  const pic = user?.profilePic || user?.avatar;

  if (pic) {
    return (
      <Image
        source={{ uri: pic }}
        style={[{ width: size, height: size, borderRadius: size / 2 }, extraStyle]}
      />
    );
  }
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        },
        extraStyle,
      ]}
    >
      <Text style={{ fontWeight: "700", color: "#fff", fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

/* ─────────────────────────── Pulse ring (replaces the CSS ringPulse keyframe) ─────────────────────────── */
function PulseRing({ color }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.55, duration: 1800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      scale.setValue(1);
      opacity.setValue(0.55);
    };
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRing,
        { backgroundColor: color, opacity, transform: [{ scale }] },
      ]}
    />
  );
}

/* ─────────────────────────── Incoming Call Modal ─────────────────────────── */
export function IncomingCallModal({ callerUser, callType, onAccept, onReject }) {
  return (
    <Modal visible transparent={false} animationType="fade">
      <View style={styles.incomingOverlay}>
        <View style={styles.incomingTop}>
          <Avatar user={callerUser} size={104} extraStyle={{ alignSelf: "center", marginBottom: 22 }} />
          <Text style={styles.incomingName}>{callerUser?.username || "Unknown"}</Text>
          <Text style={styles.incomingSubtitle}>{callType === "video" ? "Video calling…" : "is calling"}</Text>
        </View>
        <View style={styles.incomingBottom}>
          <View style={styles.incomingBtns}>
            <View style={styles.incomingBtnCol}>
              <View style={{ alignItems: "center", justifyContent: "center" }}>
                <PulseRing color="#e53935" />
                <TouchableOpacity style={styles.rejectBtn} onPress={onReject}>
                  <PhoneOffIcon />
                </TouchableOpacity>
              </View>
              <Text style={styles.incomingBtnLabel}>Decline</Text>
            </View>
            <View style={styles.incomingBtnCol}>
              <View style={{ alignItems: "center", justifyContent: "center" }}>
                <PulseRing color="#4caf50" />
                <TouchableOpacity style={styles.acceptBtn} onPress={onAccept}>
                  {callType === "video" ? <VideoIcon /> : <PhoneAcceptIcon />}
                </TouchableOpacity>
              </View>
              <Text style={styles.incomingBtnLabel}>Accept</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─────────────────────────── Call Screen ───────────────────────────
   NOTE: this now wraps itself in its own <Modal>, same as
   IncomingCallModal. Previously CallScreen's root was a plain <View>,
   which meant when CallProvider (mounted above the navigator in App.js)
   rendered {callSession && <CallScreen .../>}, it inserted a whole new
   flex sibling next to the navigator inside the same parent — forcing a
   full relayout of the root surface and tearing down/rebuilding the
   gesture handler root view mid-call. Wrapping it in a Modal renders it
   on its own isolated native surface instead, so it no longer disturbs
   the navigator's root view. */
export function CallScreen({ otherUser, callSession, onEnd }) {
  const { type, isReceiver, pc: existingPc, stream: existingStream } = callSession;
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState(isReceiver ? "Connecting…" : "Calling…");
  const [speaker, setSpeaker] = useState(false);
  const [bluetooth, setBluetooth] = useState(false);
  const [btAvailable, setBtAvailable] = useState(false);
  const [facingMode, setFacingMode] = useState("user");
  const [flipping, setFlipping] = useState(false);
  const [localStream, setLocalStream] = useState(existingStream || null);
 const [remoteStream, setRemoteStream] = useState(callSession.remoteStream || null);

  const pcRef = useRef(existingPc || null);
  const streamRef = useRef(existingStream || null);
  const timerRef = useRef(null);
const sentConnectedRef = useRef(false);
const fallbackRef = useRef(null);
  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  // In react-native-webrtc, remote audio plays automatically through the
  // active device audio route once a track lands on a stream — there's no
  // <audio> element to attach to. We just need remoteStream in state so
  // RTCView (video calls) can render it.
  const attachRemoteStream = useCallback((stream) => {
    setRemoteStream((prev) => (prev === stream ? prev : stream));
  }, []);

  const attachRemoteTrack = useCallback(
    (event) => {
      if (event.streams?.[0]) attachRemoteStream(event.streams[0]);
    },
    [attachRemoteStream]
  );

 const monitorConnection = useCallback((pc) => {
  const check = () => {
    const state = pc.iceConnectionState;
    console.log(new Date().toISOString(), `[call][${isReceiver ? "receiver" : "caller"}] iceConnectionState:`, state);
    if (state === "connected" || state === "completed") {
      setStatus("Connected");
      if (isReceiver) {
        // receiver: start timer now and tell the caller to start too
        if (!sentConnectedRef.current) {
          sentConnectedRef.current = true;
          socket.emit("callConnected", { to: otherUser._id });
        }
        startTimer();
      } else if (!fallbackRef.current) {
        // caller: wait for the receiver's signal, but never more than 3s
        fallbackRef.current = setTimeout(startTimer, 3000);
      }
    } else if (state === "failed") {
      setStatus("Connection failed");
    } else if (state === "disconnected") {
      setStatus("Reconnecting…");
    }
  };
  pc.oniceconnectionstatechange = check;
  check();
}, [startTimer, isReceiver, otherUser?._id]);
useEffect(() => {
  const onPeerConnected = () => {
    clearTimeout(fallbackRef.current);
    startTimer();
  };
  socket.on("callConnected", onPeerConnected);
  return () => {
    socket.off("callConnected", onPeerConnected);
    clearTimeout(fallbackRef.current);
  };
}, [startTimer]);

  // InCallManager owns audio routing (speaker/earpiece/bluetooth) and the
  // proximity sensor — this replaces the web version's
  // enumerateDevices()/setSinkId() dance, which has no RN equivalent.
useEffect(() => {
  if (Platform.OS !== "android" || !NativeModules.InCallManager) return;
  const emitter = new NativeEventEmitter(NativeModules.InCallManager);
  const sub = emitter.addListener("onAudioDeviceChanged", (data) => {
    try {
      const list = JSON.parse(data?.availableAudioDeviceList || "[]");
      setBtAvailable(list.includes("BLUETOOTH"));
      if (data?.selectedAudioDevice === "BLUETOOTH") {
        setBluetooth(true);
        setSpeaker(false);
      } else {
        setBluetooth(false);
        setSpeaker(data?.selectedAudioDevice === "SPEAKER_PHONE");
      }
    } catch {}
  });
  return () => sub.remove();
}, []);
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (Platform.OS === "android" && Platform.Version >= 31) {
      try {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
      } catch {}
    }
    if (cancelled) return;
    InCallManager.start({ media: type === "video" ? "video" : "audio" });
   if (type === "audio") {
  InCallManager.setForceSpeakerphoneOn(false);
} else {
  InCallManager.setForceSpeakerphoneOn(true);
  setSpeaker(true);
}
  })();
  return () => {
    cancelled = true;
    InCallManager.stop();
  };
}, [type]);

  useEffect(() => {
    let cancelled = false;
    let handleRemoteIce = null;
    let handleAnswer = null;

    if (isReceiver && existingPc && existingStream) {
      setLocalStream(existingStream);

      existingPc.ontrack = (event) => {
        if (cancelled) return;
        if (event.streams?.[0]) attachRemoteStream(event.streams[0]);
      };

    if (callSession.remoteStream) {
  attachRemoteStream(callSession.remoteStream);
} else {
  const tracks = existingPc.getReceivers().map((r) => r.track).filter(Boolean);
  if (tracks.length > 0) attachRemoteStream(new MediaStream(tracks));
}

      monitorConnection(existingPc);

      return () => {
        cancelled = true;
        clearInterval(timerRef.current);
        timerRef.current = null;
      };
    }

    let pc;
    const startCall = async () => {
      try {
        const stream = await mediaDevices.getUserMedia({
          video: type === "video" ? { facingMode: "user" } : false,
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setLocalStream(stream);

        pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.ontrack = attachRemoteTrack;
        monitorConnection(pc);

        pc.onsignalingstatechange = () => console.log("[call][caller] signalingState:", pc.signalingState);
        pc.onicegatheringstatechange = () => console.log("[call][caller] iceGatheringState:", pc.iceGatheringState);
        pc.onconnectionstatechange = () => console.log("[call][caller] connectionState:", pc.connectionState);

        const iceBuf = [];
        pc.onicecandidate = ({ candidate }) => {
          if (candidate) {
            if (!cancelled) socket.emit("iceCandidate", { to: otherUser._id, candidate });
          }
        };

        // Guarded against group-call candidates — the "iceCandidate" event
        // is shared with GroupCallContext, so without this check a
        // candidate meant for someone's group-call mesh could get fed
        // into this unrelated 1:1 pc.
        handleRemoteIce = async ({ candidate, group }) => {
          if (group) return;
          if (!candidate || cancelled) return;
          try {
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            else iceBuf.push(candidate);
          } catch (e) {
            console.error("ICE", e);
          }
        };
        socket.on("iceCandidate", handleRemoteIce);

        // Same reasoning — "liveAnswer" is shared with group calls too.
        handleAnswer = async ({ answer, group }) => {
          if (group) return;
          if (cancelled) return;
          try {
            if (pc.signalingState !== "have-local-offer") return;
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            for (const c of iceBuf) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
              } catch {}
            }
            iceBuf.length = 0;
          } catch (e) {
            console.error("setRemoteDesc", e);
          }
        };
        socket.once("liveAnswer", handleAnswer);

        const offer = await pc.createOffer();
        if (cancelled) return;
        await pc.setLocalDescription(offer);
        if (cancelled) return;

        socket.emit("callOffer", { to: otherUser._id, offer, type });
        socket.once("callRejected", () => {
          if (cancelled) return;
          setStatus(type === "video" ? "Video call declined" : "Call declined");
          setTimeout(onEnd, 1500);
        });
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setStatus("Failed to access camera/mic");
        }
      }
    };
    startCall();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      if (handleRemoteIce) socket.off("iceCandidate", handleRemoteIce);
      if (handleAnswer) socket.off("liveAnswer", handleAnswer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Audio routing — Android supports InCallManager.chooseAudioRoute()
  // directly; iOS routing is more restricted by the OS and mostly follows
  // setForceSpeakerphoneOn() plus whatever the system picks for Bluetooth.
  const applySpeaker = async (next) => {
    setSpeaker(next);
    InCallManager.setForceSpeakerphoneOn(next);
    if (next) setBluetooth(false);
  };

const applyBluetooth = (next) => {
  if (Platform.OS !== "android") return;

  if (next) {
    InCallManager.setForceSpeakerphoneOn(false);
    InCallManager.chooseAudioRoute("BLUETOOTH");
    setBluetooth(true);
    setSpeaker(false);
  } else {
    // leave Bluetooth, then go to speaker (video) or earpiece (audio)
    const useSpeaker = type === "video" || speaker;
    InCallManager.chooseAudioRoute(useSpeaker ? "SPEAKER_PHONE" : "EARPIECE");
    InCallManager.setForceSpeakerphoneOn(useSpeaker ? true : null);
    setBluetooth(false);
    setSpeaker(useSpeaker);
  }
};

  const switchCamera = async () => {
    if (flipping || type !== "video") return;
    setFlipping(true);
    try {
      const videoTrack = streamRef.current?.getVideoTracks?.()[0];
      if (videoTrack && typeof videoTrack._switchCamera === "function") {
        // react-native-webrtc's built-in camera flip — swaps the physical
        // camera in place without renegotiating the peer connection.
        videoTrack._switchCamera();
        setFacingMode((f) => (f === "user" ? "environment" : "user"));
      }
    } catch (e) {
      console.error("switchCamera failed", e);
    }
    setFlipping(false);
  };

  const isVideo = type === "video";
  const isConnected = status === "Connected";

  return (
    <Modal visible transparent={false} animationType="fade">
      <View style={styles.callScreen}>
        {isVideo && (
          <>
            {isConnected && remoteStream && (
              <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
            )}
            {localStream && (
              <RTCView
                streamURL={localStream.toURL()}
                style={isConnected ? styles.localVideo : styles.localVideoFull}
                objectFit="cover"
                // FIX: only mirror the front ("user") camera. Previously this
                // was hardcoded to `mirror` (always true), so flipping to
                // the back camera still mirrored the feed, which looks
                // wrong to the other person (e.g. any text in view would
                // appear backwards).
                mirror={facingMode === "user"}
                zOrder={isConnected ? 2 : 1}
              />
            )}
          </>
        )}
        {!isVideo && (
          <View style={styles.callBg}>
            <Avatar user={otherUser} size={120} extraStyle={{ opacity: 0.12, transform: [{ scale: 2.2 }] }} />
          </View>
        )}

        <View style={isVideo ? styles.callTopOverlay : styles.callCenter}>
          {!isVideo && <Avatar user={otherUser} size={92} />}
          <Text style={isVideo ? styles.callNameOnVideo : styles.callName}>{otherUser?.username}</Text>
          <Text style={isVideo ? styles.callStatusOnVideo : styles.callStatus}>
            {isConnected ? fmt(seconds) : status}
          </Text>
        </View>

        {isVideo && !isConnected ? (
          <View style={styles.callControls}>
            <TouchableOpacity style={styles.callCtrlBtnEnd} onPress={onEnd}>
              <PhoneOffIcon />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.callControls}>
            {isVideo && (
              <TouchableOpacity style={styles.callCtrlBtnPlain} onPress={switchCamera} disabled={flipping}>
                <FlipCameraIcon />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.callCtrlBtnEnd} onPress={onEnd}>
              <PhoneOffIcon />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.callCtrlBtnPlain}
              onPress={() => {
                streamRef.current?.getAudioTracks().forEach((t) => {
                  t.enabled = !t.enabled;
                });
                setMuted((m) => !m);
              }}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </TouchableOpacity>
            {/* FIX: speaker/bluetooth toggles are now available in video
                calls too (previously gated behind `!isVideo`, so there was
                no way to manually switch audio route during a video call). */}
            <TouchableOpacity
              style={[styles.callCtrlBtnPlain, speaker && styles.callCtrlBtnActive]}
              onPress={() => applySpeaker(!speaker)}
            >
              <SpeakerIcon on={speaker} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.callCtrlBtnPlain, bluetooth && styles.callCtrlBtnActive, !btAvailable && { opacity: 0.4 }]}
              onPress={() => applyBluetooth(!bluetooth)}
            >
              <BluetoothIcon on={bluetooth} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

/* ─────────────────────────── Styles ─────────────────────────── */
const styles = StyleSheet.create({
  pulseRing: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  incomingOverlay: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "space-between",
    paddingTop: 90,
    paddingBottom: 56,
    paddingHorizontal: 24,
  },
  incomingTop: { alignItems: "center" },
  incomingName: { fontSize: 30, fontWeight: "600", color: "#fff", textAlign: "center", letterSpacing: 0.2 },
  incomingSubtitle: { fontSize: 16, color: "rgba(255,255,255,0.55)", marginTop: 6, textAlign: "center" },
  incomingBottom: { width: "100%" },
  incomingBtns: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18 },
  incomingBtnCol: { alignItems: "center", gap: 10 },
  incomingBtnLabel: { fontSize: 13, color: "rgba(255,255,255,0.75)", fontWeight: "500" },
  rejectBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#e53935",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#e53935",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  acceptBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#4caf50",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4caf50",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },

  callScreen: {
    flex: 1,
    backgroundColor: "#0d1117",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 50,
    paddingBottom: 44,
    paddingHorizontal: 20,
  },
  remoteVideo: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000" },
  localVideo: {
    position: "absolute",
    top: 54,
    right: 16,
    width: 92,
    height: 130,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  localVideoFull: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  callBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  callCenter: { alignItems: "center", gap: 12 },
  callName: { fontSize: 24, fontWeight: "700", color: "#fff" },
  callStatus: { fontSize: 15, color: "rgba(255,255,255,0.6)" },
  callTopOverlay: { alignSelf: "flex-start" },
  callNameOnVideo: { fontSize: 19, fontWeight: "700", color: "#fff" },
  callStatusOnVideo: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  callControls: { flexDirection: "row", gap: 14, alignItems: "center", justifyContent: "center" },
  callCtrlBtnPlain: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 27,
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  callCtrlBtnActive: { backgroundColor: "rgba(255,255,255,0.35)" },
  callCtrlBtnEnd: {
    backgroundColor: "#e53935",
    borderRadius: 32,
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#e53935",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
});