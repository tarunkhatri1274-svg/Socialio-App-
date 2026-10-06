import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, Modal, Switch, StyleSheet } from "react-native";
import FA5Icon from "react-native-vector-icons/FontAwesome5";
import { toggleMuteApi, getMutedMap, subscribeMuted } from "../../components/State/MuteStore";
import Config from "react-native-config";

const GOLDEN = "rgb(234,182,118)";
const EMPTY = { muteStory: false, mutePost: false, muteMessage: false };

export default function MuteMenu({ userId, username }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => getMutedMap()[userId] || EMPTY);

  useEffect(
    () => subscribeMuted((map) => setState(map[userId] || EMPTY)),
    [userId]
  );

  const anyMuted = state.muteStory || state.mutePost || state.muteMessage;

  const handleToggle = async (type) => {
    await toggleMuteApi(userId, type);
  };

  const rows = [
    { key: "muteStory", label: "Stories", type: "story" },
    { key: "mutePost", label: "Posts", type: "post" },
    { key: "muteMessage", label: "Message notifications", type: "message" },
  ];

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: anyMuted ? "#fff0e6" : "#f0f0f0" }]}
        accessibilityLabel={`Mute options for ${username}`}
      >
        {anyMuted
          ? <FA5Icon name="bell-slash" size={13} color={GOLDEN} solid />
          : <FA5Icon name="ellipsis-v" size={13} color="#555" solid />
        }
      </TouchableOpacity>

      {/* ── Dropdown replaced with a Modal + backdrop tap-to-close,
          since RN has no document-level mousedown listener to detect
          "click outside" the way the web version does. */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.menuAnchor}>
            <TouchableOpacity activeOpacity={1} style={styles.menu} onPress={() => {}}>
              <Text style={styles.menuTitle}>Mute {username}</Text>
              {rows.map((row, i) => (
                <View
                  key={row.key}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                >
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Switch
                    value={!!state[row.key]}
                    onValueChange={() => handleToggle(row.type)}
                    trackColor={{ false: "#ddd", true: GOLDEN }}
                    thumbColor="#fff"
                  />
                </View>
              ))}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  // Positions the menu near the top-right, approximating the web
  // version's `position: absolute; right: 0; top: 38px` anchored to
  // the trigger button. True anchor-to-button positioning would need
  // measuring the trigger's on-screen layout (onLayout + measure) —
  // this is a simpler fixed placement; adjust top/right to taste.
  menuAnchor: {
    position: "absolute",
    top: 90,
    right: 15,
  },
  menu: {
    backgroundColor: "#fff",
    borderRadius: 14,
    minWidth: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  menuTitle: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    color: "#999",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#f5f5f5",
  },
  rowLabel: {
    fontSize: 14,
    color: "#111",
  },
});