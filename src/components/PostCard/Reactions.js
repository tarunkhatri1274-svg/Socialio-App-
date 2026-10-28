import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Animated,
  Easing,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import Config from "react-native-config";
import { apiFetch } from "../../api/authToken";

const API = Config.API_URL;

/* ─────────────────────────── Reaction definitions ─────────────────────────── */
export const REACTIONS = [
  { key: "like", emoji: "👍", label: "Like", color: "#1877f2" },
  { key: "love", emoji: "❤️", label: "Love", color: "#f33e58" },
  { key: "haha", emoji: "😆", label: "Haha", color: "#f7b125" },
  { key: "wow", emoji: "😮", label: "Wow", color: "#f7b125" },
  { key: "sad", emoji: "😢", label: "Sad", color: "#f7b125" },
  { key: "angry", emoji: "😡", label: "Angry", color: "#e9710f" },
];

export const REACTION_MAP = REACTIONS.reduce((acc, r) => {
  acc[r.key] = r;
  return acc;
}, {});

export function reactionColor(key, fallback = "#555") {
  return REACTION_MAP[key]?.color || fallback;
}

/* ─────────────────────────── ReactionIcon ───────────────────────────
   Shows the chosen reaction's emoji (with a little pop animation every
   time it changes) or the default thumbs-up outline if nothing is picked. */
export function ReactionIcon({ reaction, size = 17, inactiveColor = "#555" }) {
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!reaction) return;
    scale.setValue(0.3);
    rotate.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 140, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(rotate, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: -1, duration: 130, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: 0, duration: 90, useNativeDriver: true }),
      ]),
    ]).start();
  }, [reaction]);

  const r = REACTION_MAP[reaction];
  if (!r) return <Icon name="thumbs-up" size={size} color={inactiveColor} />;

  return (
    <Animated.View
      style={{
        transform: [
          { scale },
          { rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ["-18deg", "18deg"] }) },
        ],
      }}
    >
      <Text style={{ fontSize: size * 1.2, includeFontPadding: false }}>{r.emoji}</Text>
    </Animated.View>
  );
}

/* ─────────────────────────── One emoji inside the picker ─────────────────────────── */
function ReactionOption({ reaction, index, selected, onPick }) {
  const pop = useRef(new Animated.Value(0)).current; // entrance
  const bounce = useRef(new Animated.Value(0)).current; // idle loop
  const press = useRef(new Animated.Value(1)).current; // finger-down enlarge
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    Animated.spring(pop, {
      toValue: 1,
      delay: index * 45,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 180),
        Animated.timing(bounce, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const grow = (to) =>
    Animated.spring(press, { toValue: to, friction: 5, tension: 160, useNativeDriver: true }).start();

  return (
    <TouchableWithoutFeedback
      onPressIn={() => {
        setShowLabel(true);
        grow(1.55);
      }}
      onPressOut={() => {
        setShowLabel(false);
        grow(1);
      }}
      onPress={() => onPick(reaction.key)}
    >
      <View style={styles.option}>
        {showLabel && (
          <View style={styles.tooltip}>
            <Text style={styles.tooltipText}>{reaction.label}</Text>
          </View>
        )}
        <Animated.View
          style={{
            opacity: pop,
            transform: [
              { scale: Animated.multiply(pop, press) },
              { translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
            ],
          }}
        >
          <Text style={[styles.emoji, selected && { textShadowColor: reaction.color, textShadowRadius: 8 }]}>
            {reaction.emoji}
          </Text>
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

/* ─────────────────────────── The floating picker ─────────────────────────── */
const OPTION_W = 50;
const PICKER_W = REACTIONS.length * OPTION_W + 16;

function ReactionPicker({ pos, current, onPick, onClose }) {
  const W = Dimensions.get("window").width;
  const left = Math.max(8, Math.min(pos.x + pos.w / 2 - PICKER_W / 2, W - PICKER_W - 8));
  const top = Math.max(40, pos.y - 78);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(appear, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, []);

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>
      <Animated.View
        style={[
          styles.picker,
          {
            left,
            top,
            width: PICKER_W,
            opacity: appear,
            transform: [
              { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
              { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
            ],
          },
        ]}
      >
        {REACTIONS.map((r, i) => (
          <ReactionOption key={r.key} reaction={r} index={i} selected={current === r.key} onPick={onPick} />
        ))}
      </Animated.View>
    </Modal>
  );
}

/* ─────────────────────────── ReactionButton ───────────────────────────
   Drop-in replacement for the old like TouchableOpacity:
     tap        -> onQuickPress (like / remove reaction)
     long-press -> opens the picker, picking calls onReact(key)            */
export function ReactionButton({ myReaction, onQuickPress, onReact, style, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const open = () => {
    ref.current?.measureInWindow((x, y, w, h) => setPos({ x, y, w, h }));
  };

  return (
    <>
      <TouchableOpacity
        ref={ref}
        style={style}
        activeOpacity={0.7}
        onPress={onQuickPress}
        onLongPress={open}
        delayLongPress={320}
      >
        {children}
      </TouchableOpacity>
      {pos && (
        <ReactionPicker
          pos={pos}
          current={myReaction}
          onClose={() => setPos(null)}
          onPick={(key) => {
            setPos(null);
            onReact(key);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────── useReaction hook ───────────────────────────
   Keeps `liked` / `setLiked` for backwards-compat with the existing code,
   and adds `myReaction`, `react(key)` and `quickToggle()`.

   Server contract (see notes): POST /auth/like/:postId  body { reaction }
   -> { success, liked, reaction, totalLikes, likedBy:[{_id, username, profilePic, reaction}] } */
export function useReaction({ postId, myId, likedByUsers, setLikesCount, setLikedByUsers, onLiked }) {
  const [myReaction, setMyReaction] = useState(null);

  // Whenever the likers list refreshes (initial fetch / socket), pick up my reaction type from it.
  useEffect(() => {
    if (!myId) return;
    const me = (likedByUsers || []).find((u) => (u?._id ?? u)?.toString() === myId.toString());
    if (me?.reaction && REACTION_MAP[me.reaction]) setMyReaction(me.reaction);
  }, [likedByUsers, myId]);

  // compat with old `setLiked(boolean)` calls
  const setLiked = useCallback((v) => setMyReaction((prev) => (v ? prev || "like" : null)), []);

  const react = async (key) => {
    if (!postId || !REACTION_MAP[key]) return;
    const prev = myReaction;
    setMyReaction(key === prev ? null : key); // optimistic: same reaction again = remove
    try {
      const res = await apiFetch(`${API}/auth/like/${postId}`, {
        method: "POST",
        body: JSON.stringify({ reaction: key }),
      });
      const data = await res.json();
      if (data.success) {
        setMyReaction(data.liked ? (REACTION_MAP[data.reaction] ? data.reaction : key) : null);
        if (data.totalLikes != null) setLikesCount?.(data.totalLikes);
        if (data.likedBy) setLikedByUsers?.(data.likedBy);
        if (data.liked) onLiked?.(postId);
      } else {
        setMyReaction(prev);
      }
    } catch {
      setMyReaction(prev);
    }
  };

  const quickToggle = () => react(myReaction || "like");

  return { liked: !!myReaction, setLiked, myReaction, react, quickToggle };
}

const styles = StyleSheet.create({
  picker: {
    position: "absolute",
    height: 62,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 31,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 14,
  },
  option: { width: OPTION_W, height: 62, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 32, includeFontPadding: false },
  tooltip: {
    position: "absolute",
    top: -22,
    backgroundColor: "rgba(0,0,0,0.78)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tooltipText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});