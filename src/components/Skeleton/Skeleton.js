import React, { useEffect, useRef } from "react";
import { View, Animated } from "react-native";

// ── Shared shimmer animation driver ──────────────────────────────────
// RN has no CSS keyframes, so the pulsing effect is done with
// Animated.loop + interpolated opacity, same visual effect as the web
// version's `animation: shimmer 1.4s ease infinite`.
function useShimmer() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return opacity;
}

export function SkelBlock({ w = "100%", h = 14, radius = 8, style = {} }) {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[
        {
          width: w,
          height: h,
          borderRadius: radius,
          backgroundColor: "#e8e8e8",
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkelCircle({ size = 38 }) {
  return <SkelBlock w={size} h={size} radius={size / 2} />;
}

export function FeedCardSkeleton() {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: "#efefef", padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <SkelCircle size={38} />
        <View style={{ flex: 1 }}>
          <SkelBlock w="40%" h={12} style={{ marginBottom: 6 }} />
          <SkelBlock w="25%" h={10} />
        </View>
      </View>
      <SkelBlock w="100%" h={320} radius={12} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <SkelBlock w={60} h={32} radius={10} />
        <SkelBlock w={60} h={32} radius={10} />
        <SkelBlock w={60} h={32} radius={10} />
      </View>
    </View>
  );
}

export function DmRowSkeleton() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, paddingVertical: 10 }}>
      <SkelCircle size={46} />
      <View style={{ flex: 1 }}>
        <SkelBlock w="35%" h={13} style={{ marginBottom: 6 }} />
        <SkelBlock w="55%" h={11} />
      </View>
    </View>
  );
}

export function NotifRowSkeleton() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingVertical: 10 }}>
      <SkelCircle size={46} />
      <View style={{ flex: 1 }}>
        <SkelBlock w="70%" h={12} style={{ marginBottom: 6 }} />
        <SkelBlock w="20%" h={10} />
      </View>
    </View>
  );
}

export function ChatBubbleSkeleton({ me = false }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: me ? "flex-end" : "flex-start", marginBottom: 12 }}>
      <SkelBlock w={Math.floor(Math.random() * 100) + 120} h={38} radius={18} />
    </View>
  );
}

export function ToggleRowSkeleton() {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#f0f0f0",
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <SkelBlock w={90} h={14} />
      <SkelBlock w={50} h={26} radius={13} />
    </View>
  );
}