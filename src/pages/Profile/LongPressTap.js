import React, { useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

// Location: src/pages/Profile/LongPressTap.js
//
// Tap + long-press wrapper built on react-native-gesture-handler, so a held
// finger isn't cancelled by the surrounding ScrollView / pan responders.
//   tap        -> onPress
//   long press -> onLongPress (after `delayLongPress` ms)
export default function LongPressTap({
  onPress,
  onLongPress,
  delayLongPress = 350,
  style,
  children,
}) {
  // Always call the latest callbacks without rebuilding the gesture.
  const pressRef = useRef(onPress);
  const longPressRef = useRef(onLongPress);
  pressRef.current = onPress;
  longPressRef.current = onLongPress;

  const gesture = useMemo(() => {
    const longPress = Gesture.LongPress()
      .minDuration(delayLongPress)
      .maxDistance(40)
      .runOnJS(true)
      .onStart(() => {
        console.log("[LongPressTap] long press");
        longPressRef.current?.();
      });

    const tap = Gesture.Tap()
      .maxDistance(40)
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) {
          console.log("[LongPressTap] tap");
          pressRef.current?.();
        }
      });

    // Long press wins if the finger stays down; otherwise it's a tap.
    return Gesture.Exclusive(longPress, tap);
  }, [delayLongPress]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}