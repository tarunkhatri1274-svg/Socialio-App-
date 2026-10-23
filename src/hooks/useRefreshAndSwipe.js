import { useRef, useState, useCallback } from "react";
import { Animated, PanResponder, Dimensions } from "react-native";
import { isCarouselTouchActive } from "../components/carouselTouch";

const W = Dimensions.get("window").width;

/* Pull-to-refresh + re-tap refresh share this */
export function useRefresh(fn) {
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await fnRef.current(); } catch {} finally { setRefreshing(false); }
  }, []);
  return { refreshing, onRefresh };
}

/* Smooth swipe between sub-tabs (Profile, Saved) */
export function useSwipeTabs({ order, activeTab, setActiveTab }) {
  const x = useRef(new Animated.Value(0)).current;
  const activeRef = useRef(activeTab);
  activeRef.current = activeTab;
  const busy = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !busy.current && !isCarouselTouchActive() &&
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_, g) => {
        const i = order.indexOf(activeRef.current);
        const atEdge = (g.dx > 0 && i === 0) || (g.dx < 0 && i === order.length - 1);
        x.setValue(atEdge ? g.dx * 0.2 : g.dx);
      },
      onPanResponderRelease: (_, g) => {
        const i = order.indexOf(activeRef.current);
        const dir = g.dx < 0 ? 1 : -1;
        const next = i + dir;
        const passed = Math.abs(g.dx) > W * 0.25 || Math.abs(g.vx) > 0.5;
        if (!passed || next < 0 || next >= order.length) {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
          return;
        }
        busy.current = true;
        Animated.timing(x, { toValue: -dir * W, duration: 160, useNativeDriver: true }).start(() => {
          setActiveTab(order[next]);
          x.setValue(dir * W);
          Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true })
            .start(() => { busy.current = false; });
        });
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  return { panHandlers: panResponder.panHandlers, x };
}