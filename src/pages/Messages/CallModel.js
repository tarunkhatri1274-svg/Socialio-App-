import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Phone, PhoneOff, Mic, MicOff, Video } from "lucide-react-native";

const CallModal = ({
  open,
  caller,
  callType = "audio",
  isIncoming = false,
  isConnected = false,
  onAccept,
  onReject,
  onEnd,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let timer;

    if (isConnected) {
      timer = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [isConnected]);

  if (!open) return null;

  const formatTime = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <Modal visible={open} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={onEnd}>
      <View style={styles.screen}>

        {/* Avatar */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {caller?.username?.charAt(0)?.toUpperCase() || "U"}
          </Text>
        </View>

        {/* Name */}
        <Text style={styles.name}>{caller?.username || "Unknown User"}</Text>

        {/* Status */}
        {!isConnected && !isIncoming && (
          <Text style={styles.statusText}>Calling...</Text>
        )}

        {isIncoming && (
          <Text style={styles.incomingText}>Incoming {callType} call</Text>
        )}

        {isConnected && (
          <Text style={styles.statusText}>{formatTime(seconds)}</Text>
        )}

        {/* Incoming Call Buttons */}
        {isIncoming && !isConnected && (
          <View style={styles.btnRow}>
            <TouchableOpacity
              onPress={onAccept}
              style={[styles.circleBtn, styles.acceptBtn]}
              activeOpacity={0.8}
            >
              <Phone size={34} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onReject}
              style={[styles.circleBtn, styles.rejectBtn]}
              activeOpacity={0.8}
            >
              <PhoneOff size={34} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Active Call Controls */}
        {isConnected && (
          <View style={[styles.btnRow, { marginTop: 48 }]}>
            <TouchableOpacity
              onPress={() => setMuted(!muted)}
              style={[styles.circleBtn, styles.mutedBtn]}
              activeOpacity={0.8}
            >
              {muted ? <MicOff size={30} color="#fff" /> : <Mic size={30} color="#fff" />}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onEnd}
              style={[styles.circleBtn, styles.rejectBtn]}
              activeOpacity={0.8}
            >
              <PhoneOff size={34} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Ringing Screen */}
        {!isIncoming && !isConnected && (
          <View style={{ marginTop: 48 }}>
            <TouchableOpacity
              onPress={onEnd}
              style={[styles.circleBtn, styles.rejectBtn]}
              activeOpacity={0.8}
            >
              <PhoneOff size={34} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Call Type Badge */}
        <View style={styles.badge}>
          {callType === "video" ? (
            <>
              <Video size={18} color="#fff" />
              <Text style={styles.badgeText}>Video Call</Text>
            </>
          ) : (
            <>
              <Mic size={18} color="#fff" />
              <Text style={styles.badgeText}>Audio Call</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

export default CallModal;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020817",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "#a855f7", // purple-500
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: "700",
    color: "#fff",
  },
  name: {
    fontSize: 34,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  statusText: {
    fontSize: 20,
    color: "#d1d5db", // gray-300
  },
  incomingText: {
    fontSize: 20,
    color: "#4ade80", // green-400
  },
  btnRow: {
    flexDirection: "row",
    gap: 32,
    marginTop: 40,
  },
  circleBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    backgroundColor: "#22c55e", // green-500
  },
  rejectBtn: {
    backgroundColor: "#ef4444", // red-500
  },
  mutedBtn: {
    backgroundColor: "#374151", // gray-700
  },
  badge: {
    position: "absolute",
    top: 24,
    right: 24,
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
});