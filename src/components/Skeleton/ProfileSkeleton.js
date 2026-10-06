import React from "react";
import { View, Dimensions } from "react-native";
import { SkelBlock, SkelCircle } from "./Skeleton";

const SCREEN_WIDTH = Dimensions.get("window").width;

export function ProfileHeaderSkeleton() {
  return (
    <View style={{ paddingHorizontal: 18, paddingVertical: 16 }}>
      <SkelBlock w="100%" h={170} radius={16} style={{ marginBottom: 16 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <SkelCircle size={90} />
        <View style={{ flex: 1, flexDirection: "row", gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ alignItems: "center", gap: 6 }}>
              <SkelBlock w={30} h={16} />
              <SkelBlock w={50} h={11} />
            </View>
          ))}
        </View>
      </View>
      <SkelBlock w="70%" h={13} style={{ marginBottom: 8 }} />
      <SkelBlock w="50%" h={12} style={{ marginBottom: 18 }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SkelBlock w={SCREEN_WIDTH ? undefined : "100%"} h={40} radius={12} style={{ flex: 1 }} />
        <SkelBlock h={40} radius={12} style={{ flex: 1 }} />
        <SkelBlock h={40} radius={12} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export function ProfileGridSkeleton() {
  const cellSize = (SCREEN_WIDTH - 20 - 8) / 3; // padding 10*2 + gap approximation
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        padding: 10,
        gap: 4,
      }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <SkelBlock key={i} w={cellSize} h={cellSize} radius={6} />
      ))}
    </View>
  );
}