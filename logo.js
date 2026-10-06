import React, { useEffect, useRef } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";

const SIZE = 160;
const VIEWBOX = 200;
const center = 100;
const bigR = 38;
const smallR = 6;
const nodes = 7;
const orbitR = bigR + smallR;

const Logo = () => {
  const rotationValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotationValue, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true, // runs on UI thread — smooth, no stutter
      })
    );
    loop.start();
    return () => loop.stop();
  }, [rotationValue]);

  const spin = rotationValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.wrapper}>
      {/* Rotating ring: big circle + orbiting dots */}
      <Animated.View style={[styles.rotatingLayer, { transform: [{ rotate: spin }] }]}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
          <Circle
            cx={center}
            cy={center}
            r={bigR}
            fill="#e3b07a"
            stroke="black"
            strokeWidth={1.5}
          />
          {Array.from({ length: nodes }).map((_, i) => {
            const angle = (-90 + (i * 360) / nodes) * (Math.PI / 180);
            return (
              <Circle
                key={i}
                cx={center + orbitR * Math.cos(angle)}
                cy={center + orbitR * Math.sin(angle)}
                r={smallR}
                fill="#e3b07a"
                stroke="black"
                strokeWidth={1.5}
              />
            );
          })}
        </Svg>
      </Animated.View>

      {/* Static "S" overlay — stays fixed, never rotates */}
      <View style={styles.textLayer} pointerEvents="none">
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
          <SvgTextS />
        </Svg>
      </View>
    </View>
  );
};

// Separated so it's easy to see this is the only static piece
import { Text as SvgText } from "react-native-svg";
const SvgTextS = () => (
  <SvgText
    x={center}
    y={center + 12}
    textAnchor="middle"
    fontSize="42"
    fontWeight="900"
    fill="black"
  >
    S
  </SvgText>
);

const styles = StyleSheet.create({
  wrapper: {
    width: SIZE,
    height: SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  rotatingLayer: {
    width: SIZE,
    height: SIZE,
    position: "absolute",
  },
  textLayer: {
    width: SIZE,
    height: SIZE,
    position: "absolute",
  },
});

export default Logo;