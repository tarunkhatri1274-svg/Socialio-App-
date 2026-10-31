import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import notifee, { EventType } from "@notifee/react-native";

import { apiFetch as authApiFetch } from "../../api/authToken";
import Config from "react-native-config";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
} from "react-native-webrtc";
import socket from "../../sockets/Sockets";
import { IncomingCallModal, CallScreen } from "../Call/CallUI";
import { ICE_SERVERS } from "../../sockets/iceServers";

const API = Config.API_URL;

const CALL_NOTIF_ID = "incoming_call";
const AUTO_ACCEPT_TTL_MS = 60000;

const apiFetch = async (url, options = {}) => {
  const res = await authApiFetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const generateCallId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// removes the system "ringing" notification (shown when the app was closed/background)
const dismissRingNotif = () => {
  try {
    notifee.cancelNotification(CALL_NOTIF_ID).catch(() => {});
  } catch {}
};

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext);

/**
 * Mount <CallProvider> ONCE, above your navigator, in App.js.
 * It owns all call sockets/state globally, so an incoming call shows
 * up (and an active call keeps running) no matter which screen the user
 * is currently viewing.
 *
 * Closed-app calls: the server sends a high-priority FCM data push, index.js
 * shows a ringing notification (Accept / Decline). Accept stores
 * "pendingAcceptCall" in AsyncStorage and launches the app; here we pick that
 * up, ask the server to replay the ringing offer ("checkPendingCall"), and
 * accept it automatically once it arrives.
 */
export function CallProvider({ currentUser, children }) {
  const [incomingCall, setIncomingCall] = useState(null);
  const [callSession, setCallSession] = useState(null);

  const answeringRef = useRef(false);
  const answeringFromRef = useRef(null);   // caller id of the call we're accepting
  const offerInFlightRef = useRef(null);   // caller id whose offer is being processed (dedupes replays)
  const callEndedRef = useRef(false);
  const userCacheRef = useRef({});
  const iceHandlerRef = useRef(null);
  const callSessionRef = useRef(null);
  const incomingCallRef = useRef(null);
  const earlyIceRef = useRef([]);          // ICE candidates that arrive while the phone is still ringing
  const bufferingIceRef = useRef(false);   // true from "offer received" until the user taps Accept
  const autoAcceptRef = useRef(null);      // { from, at } — accept this caller automatically when their offer lands
  const handleAcceptRef = useRef(null);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);
  useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  const fetchUser = useCallback(async (id) => {
    if (userCacheRef.current[id]) return userCacheRef.current[id];
    try {
      const data = await apiFetch(`${API}/auth/user/${id}`);
      const u = data.user || { _id: id, username: "Unknown" };
      userCacheRef.current[id] = u;
      return u;
    } catch {
      return { _id: id, username: "Unknown" };
    }
  }, []);

  const resolveChatId = useCallback(
    async (otherUserId) => {
      try {
        const data = await apiFetch(`${API}/messages/chat/${currentUser._id}/${otherUserId}`);
        return data.chatId || null;
      } catch {
        return null;
      }
    },
    [currentUser?._id]
  );

  const saveSystemMessage = useCallback(async (chatId, otherUserId, text) => {
    if (!chatId) return;
    try {
      await apiFetch(`${API}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          text,
          to: otherUserId,
          isSystem: true,
          isEphemeral: true,
        }),
      });
    } catch (err) {
      console.error("saveSystemMessage failed", err);
    }
  }, []);

  // ── Global incoming-call listener ───────────────────────────────────────
  useEffect(() => {
    if (!currentUser?._id) return;

    const onOffer = async ({ offer, from, type, group }) => {
      if (group) return;

      // Same caller again (server replay after reconnect / duplicate delivery):
      // ignore it — never reject, that would kill a call that is ringing or connecting.
      if (
        offerInFlightRef.current === from ||
        incomingCallRef.current?.from === from ||
        callSessionRef.current?.otherUser?._id === from ||
        (answeringRef.current && answeringFromRef.current === from)
      ) {
        return;
      }

      if (answeringRef.current || callSessionRef.current || incomingCallRef.current) {
        socket.emit("callRejected", { to: from });
        return;
      }

      offerInFlightRef.current = from;

      // start buffering BEFORE any await, so no candidate is missed
      earlyIceRef.current = [];
      bufferingIceRef.current = true;

      try {
        const [callerUser, chatId] = await Promise.all([fetchUser(from), resolveChatId(from)]);
        setIncomingCall({ offer, from, type: type || "audio", callerUser, chatId });
      } finally {
        offerInFlightRef.current = null;
      }
    };

    const onIce = ({ candidate, group }) => {
      if (group || !candidate) return;
      if (bufferingIceRef.current) earlyIceRef.current.push(candidate);
    };

    const onCancelled = () => {
      bufferingIceRef.current = false;
      earlyIceRef.current = [];
      offerInFlightRef.current = null;
      autoAcceptRef.current = null;
      dismissRingNotif();
      setIncomingCall(null);
    };

    // Ask the server "is anyone ringing me?" — covers: app opened from a call
    // push, app brought back from background, and socket reconnects.
    const askPending = () => socket.emit("checkPendingCall");

    socket.on("callOffer", onOffer);
    socket.on("iceCandidate", onIce);
    socket.on("callCancelled", onCancelled);
    socket.on("connect", askPending);
    if (socket.connected) askPending();

    return () => {
      socket.off("callOffer", onOffer);
      socket.off("iceCandidate", onIce);
      socket.off("callCancelled", onCancelled);
      socket.off("connect", askPending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?._id, fetchUser, resolveChatId]);

  const handleAcceptCall = async () => {
    if (!incomingCall || answeringRef.current) return;
    answeringRef.current = true;
    const { offer, from, type, callerUser, chatId } = incomingCall;
    answeringFromRef.current = from;
    autoAcceptRef.current = null;
    const callId = generateCallId();
    dismissRingNotif();
    setIncomingCall(null);
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === "video",
      });
      const pc = new RTCPeerConnection(ICE_SERVERS);
      let remoteStream = null;
      pc.ontrack = (event) => {
        if (event.streams?.[0]) remoteStream = event.streams[0];
      };

      pc.onsignalingstatechange = () => console.log("[call][receiver] signalingState:", pc.signalingState);
      pc.onicegatheringstatechange = () => console.log("[call][receiver] iceGatheringState:", pc.iceGatheringState);
      pc.onconnectionstatechange = () => console.log("[call][receiver] connectionState:", pc.connectionState);
      pc.oniceconnectionstatechange = () => console.log("[call][receiver] iceConnectionState:", pc.iceConnectionState);

      socket.once("callCancelled", () => {
        stream.getTracks().forEach((t) => t.stop());
        pc.close();
        if (iceHandlerRef.current) {
          socket.off("iceCandidate", iceHandlerRef.current);
          iceHandlerRef.current = null;
        }
        setCallSession(null);
        answeringRef.current = false;
        answeringFromRef.current = null;
      });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const iceBuf = [...earlyIceRef.current];
      earlyIceRef.current = [];
      bufferingIceRef.current = false;

      // Guarded against group-call ICE candidates, which flow through this
      // same "iceCandidate" event.
      const handleRemoteIce = async ({ candidate, group }) => {
        if (group) return;
        if (!candidate) return;
        if (pc.signalingState === "closed") return;
        try {
          if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
          else iceBuf.push(candidate);
        } catch (e) {
          console.error(e);
        }
      };
      iceHandlerRef.current = handleRemoteIce;
      socket.on("iceCandidate", handleRemoteIce);
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("iceCandidate", { to: from, candidate });
      };
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of iceBuf) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch {}
      }
      iceBuf.length = 0;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("liveAnswer", { to: from, answer });
      setCallSession({ callId, type, isReceiver: true, pc, stream, remoteStream, otherUser: callerUser, chatId });
    } catch (err) {
      console.error("Accept call error:", err);
      answeringRef.current = false;
      answeringFromRef.current = null;
      bufferingIceRef.current = false;
      earlyIceRef.current = [];
      // tell the caller we couldn't pick up, so they don't sit on "Calling…"
      socket.emit("callRejected", { to: from });
    }
  };

  // always points at the latest handleAcceptCall (it closes over `incomingCall`)
  handleAcceptRef.current = handleAcceptCall;

  const handleRejectCall = async () => {
    const { from, type, chatId, callerUser } = incomingCall || {};
    bufferingIceRef.current = false;
    earlyIceRef.current = [];
    autoAcceptRef.current = null;
    dismissRingNotif();
    setIncomingCall(null);
    answeringRef.current = false;
    answeringFromRef.current = null;
    if (iceHandlerRef.current) {
      socket.off("iceCandidate", iceHandlerRef.current);
      iceHandlerRef.current = null;
    }
    if (from) socket.emit("callRejected", { to: from });
    if (chatId)
      await saveSystemMessage(
        chatId,
        callerUser?._id,
        type === "video" ? "📹 Video call declined" : "📞 Call declined"
      );
  };

  const startCall = useCallback(
    async (otherUser, type) => {
      if (callSessionRef.current || incomingCallRef.current) return; // already busy
      const chatId = await resolveChatId(otherUser._id);
      const callId = generateCallId();
      setCallSession({ callId, type, isReceiver: false, otherUser, chatId });
    },
    [resolveChatId]
  );

  const handleEndCall = useCallback(async () => {
    if (callEndedRef.current) return;
    callEndedRef.current = true;
    const session = callSessionRef.current;
    const otherUserId = session?.otherUser?._id;
    const type = session?.type || "audio";
    const chatId = session?.chatId;

    if (!session?.isReceiver && session) socket.emit("callCancelled", { to: otherUserId });
    else socket.emit("callEnded", { to: otherUserId });

    setCallSession((prev) => {
      if (prev?.isReceiver) {
        prev.stream?.getTracks().forEach((t) => t.stop());
        prev.pc?.close();
      }
      return null;
    });

    await saveSystemMessage(chatId, otherUserId, type === "video" ? "📹 Video call ended" : "📞 Call ended");

    answeringRef.current = false;
    answeringFromRef.current = null;
    if (iceHandlerRef.current) {
      socket.off("iceCandidate", iceHandlerRef.current);
      iceHandlerRef.current = null;
    }
    socket.off("liveAnswer");
    socket.off("callRejected");
    socket.off("callNoAnswer");
    setTimeout(() => {
      callEndedRef.current = false;
    }, 1000);
  }, [saveSystemMessage]);

  useEffect(() => {
    const onCallEnded = async () => {
      const session = callSessionRef.current;
      if (!session) return;
      setCallSession((prev) => {
        if (prev) {
          prev.stream?.getTracks().forEach((t) => t.stop());
          prev.pc?.close();
        }
        return null;
      });
      answeringRef.current = false;
      answeringFromRef.current = null;
      if (iceHandlerRef.current) {
        socket.off("iceCandidate", iceHandlerRef.current);
        iceHandlerRef.current = null;
      }
      await saveSystemMessage(
        session.chatId,
        session.otherUser?._id,
        session.type === "video" ? "📹 Video call ended" : "📞 Call ended"
      );
    };
    socket.on("callEnded", onCallEnded);
    return () => socket.off("callEnded", onCallEnded);
  }, [saveSystemMessage]);

  // ── Closed-app / background call handling ──────────────────────────────
  // "Accept" was tapped on the system call notification. If the offer is already
  // here (socket delivered it) accept now; otherwise remember who to accept and
  // ask the server to replay the ringing call.
  const requestAutoAccept = useCallback((from) => {
    if (!from) return;
    if (incomingCallRef.current?.from === from) {
      handleAcceptRef.current?.();
      return;
    }
    autoAcceptRef.current = { from, at: Date.now() };
    if (socket.connected) socket.emit("checkPendingCall");
  }, []);

  // reads the flag index.js's background handler left in AsyncStorage
  const consumePendingAccept = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem("pendingAcceptCall");
      if (!raw) return;
      await AsyncStorage.removeItem("pendingAcceptCall");
      const { from, at } = JSON.parse(raw);
      if (Date.now() - at > AUTO_ACCEPT_TTL_MS) return;
      requestAutoAccept(from);
    } catch {}
  }, [requestAutoAccept]);

  useEffect(() => {
    // app launched (from killed) by tapping Accept
    consumePendingAccept();
    (async () => {
      try {
        const initial = await notifee.getInitialNotification();
        if (
          initial?.pressAction?.id === "accept" &&
          initial.notification?.data?.type === "incoming_call"
        ) {
          requestAutoAccept(initial.notification.data.callerId);
        }
      } catch {}
    })();

    // app was alive in background; Accept tapped → index.js stored the flag → app comes to foreground
    const appStateSub = AppState.addEventListener("change", (s) => {
      if (s === "active") consumePendingAccept();
    });

    // Accept/Decline tapped while the app is in the foreground
    const unsubNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      const d = detail.notification?.data;
      if (d?.type !== "incoming_call" || type !== EventType.ACTION_PRESS) return;

      if (detail.pressAction.id === "accept") {
        dismissRingNotif();
        requestAutoAccept(d.callerId);
      } else if (detail.pressAction.id === "decline") {
        dismissRingNotif();
        if (incomingCallRef.current?.from === d.callerId) {
          // modal is up too — run the normal reject path
          handleRejectRef.current?.();
        } else {
          socket.emit("callRejected", { to: d.callerId });
        }
      }
    });

    return () => {
      appStateSub.remove();
      unsubNotifee();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep a ref to the latest reject handler for the notifee callback above
  const handleRejectRef = useRef(null);
  handleRejectRef.current = handleRejectCall;

  // Once the (replayed) offer lands in state, accept it automatically
  useEffect(() => {
    const auto = autoAcceptRef.current;
    if (
      incomingCall &&
      auto &&
      auto.from === incomingCall.from &&
      Date.now() - auto.at < AUTO_ACCEPT_TTL_MS
    ) {
      autoAcceptRef.current = null;
      handleAcceptRef.current?.();
    }
  }, [incomingCall]);

  return (
    <CallContext.Provider value={{ incomingCall, callSession, startCall, endCall: handleEndCall }}>
      {children}
      {incomingCall && (
        <IncomingCallModal
          callerUser={incomingCall.callerUser}
          callType={incomingCall.type}
          onAccept={handleAcceptCall}
          onReject={handleRejectCall}
        />
      )}
      {callSession && (
        <CallScreen otherUser={callSession.otherUser} callSession={callSession} onEnd={handleEndCall} />
      )}
    </CallContext.Provider>
  );
}