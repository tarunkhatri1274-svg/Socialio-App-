import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";

import { apiFetch as authApiFetch }  from "../../api/authToken"
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

/* ─── localStorage.getItem("token") is synchronous on web; AsyncStorage
   isn't, so we cache the token in memory the same way the other converted
   files in this project do. Call refreshTokenCache() once near app start
   (e.g. in App.js after login) and whenever the token changes. ─── */
const apiFetch = async (url, options = {}) => {
  const res = await authApiFetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

// crypto.randomUUID() has no built-in RN equivalent without extra native
// setup (react-native-get-random-values + uuid). This id is only used as a
// local call-session key, not for anything security-sensitive, so a plain
// timestamp+random fallback is enough — same pattern used elsewhere in
// this app's socket-event ids.
const generateCallId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext);

/**
 * Mount <CallProvider> ONCE, above your navigator, in App.js.
 * It owns all call sockets/state globally, so an incoming call shows
 * up (and an active call keeps running) no matter which screen the user
 * is currently viewing — Profile, some other user's profile, etc.
 */
export function CallProvider({ currentUser, children }) {
  const [incomingCall, setIncomingCall] = useState(null);
  const [callSession, setCallSession] = useState(null);

  const answeringRef = useRef(false);
  const callEndedRef = useRef(false);
  const userCacheRef = useRef({});
  const iceHandlerRef = useRef(null);
  const callSessionRef = useRef(null);
  const incomingCallRef = useRef(null);
  const earlyIceRef = useRef([]);       // ICE candidates that arrive while the phone is still ringing
const bufferingIceRef = useRef(false); // true from "offer received" until the user taps Accept
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

    if (answeringRef.current || callSessionRef.current || incomingCallRef.current) {
      socket.emit("callRejected", { to: from });
      return;
    }

    // start buffering BEFORE any await, so no candidate is missed
    earlyIceRef.current = [];
    bufferingIceRef.current = true;

    const [callerUser, chatId] = await Promise.all([fetchUser(from), resolveChatId(from)]);
    setIncomingCall({ offer, from, type: type || "audio", callerUser, chatId });
  };

  const onIce = ({ candidate, group }) => {
    if (group || !candidate) return;
    if (bufferingIceRef.current) earlyIceRef.current.push(candidate);
  };

  const onCancelled = () => {
    bufferingIceRef.current = false;
    earlyIceRef.current = [];
    setIncomingCall(null);
  };

  socket.on("callOffer", onOffer);
  socket.on("iceCandidate", onIce);
  socket.on("callCancelled", onCancelled);
  return () => {
    socket.off("callOffer", onOffer);
    socket.off("iceCandidate", onIce);
    socket.off("callCancelled", onCancelled);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentUser?._id, fetchUser, resolveChatId]);
  const handleAcceptCall = async () => {
    if (!incomingCall) return;
    answeringRef.current = true;
    const { offer, from, type, callerUser, chatId } = incomingCall;
    const callId = generateCallId();
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
      });
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const iceBuf = [...earlyIceRef.current];
earlyIceRef.current = [];
bufferingIceRef.current = false;

      // Guarded against group-call ICE candidates, which flow through this
      // same "iceCandidate" event — without the check, a candidate meant
      // for someone's group-call peer connection could get fed into this
      // unrelated 1:1 pc and throw/corrupt negotiation.
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
  bufferingIceRef.current = false;
  earlyIceRef.current = [];
}
  };

  const handleRejectCall = async () => {
    const { from, type, chatId, callerUser } = incomingCall || {};
    bufferingIceRef.current = false;
earlyIceRef.current = [];
    setIncomingCall(null);
    answeringRef.current = false;
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
    if (iceHandlerRef.current) {
      socket.off("iceCandidate", iceHandlerRef.current);
      iceHandlerRef.current = null;
    }
    socket.off("liveAnswer");
    socket.off("callRejected");
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