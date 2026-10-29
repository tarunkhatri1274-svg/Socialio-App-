import React, {
  useState,
  useRef,
  useMemo,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { View, Text, PanResponder, StyleSheet } from "react-native";

/**
 * Instagram-style video seek bar.
 *
 * - A thin progress line sits at the bottom of the video and fills as it plays.
 * - Touch it and drag LEFT / RIGHT to reverse / forward the video. While
 *   dragging, the line thickens, a thumb appears and a "0:12 / 0:45" label
 *   is shown. The video is paused while scrubbing and resumes on release.
 *
 * Usage (inside the video card):
 *
 *   const videoRef = useRef(null);
 *   const seekBarRef = useRef(null);
 *   const [scrubbing, setScrubbing] = useState(false);
 *
 *   <Video
 *     ref={videoRef}
 *     paused={!isVisible || paused || scrubbing}
 *     progressUpdateInterval={100}
 *     onLoad={(e) => seekBarRef.current?.setDuration(e.duration)}
 *     onProgress={(e) => seekBarRef.current?.setProgress(e.currentTime)}
 *     ...
 *   />
 *   <VideoSeekBar ref={seekBarRef} videoRef={videoRef}
 *                 onScrubChange={setScrubbing} bottom={0} />
 *
 * Progress is pushed in through the ref (not props) so the big video card
 * does NOT re-render on every progress tick — only this tiny component does.
 */

const fmt = (sec) => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const SEEK_THROTTLE_MS = 60;

const VideoSeekBar = forwardRef(function VideoSeekBar(
  { videoRef, onScrubChange, bottom = 0, left = 0, right = 0 },
  ref
) {
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const durationRef = useRef(0);
  const widthRef = useRef(1);
  const startXRef = useRef(0);
  const scrubbingRef = useRef(false);
  const lastSeekRef = useRef(0);
  const currentRef = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      setDuration: (d) => {
        durationRef.current = d || 0;
        setDuration(d || 0);
        currentRef.current = 0;
        setCurrent(0);
      },
      setProgress: (t) => {
        if (scrubbingRef.current) return; // finger is in control while dragging
        currentRef.current = t || 0;
        setCurrent(t || 0);
      },
    }),
    []
  );

  const timeAt = useCallback((x) => {
    const ratio = Math.min(Math.max(x / (widthRef.current || 1), 0), 1);
    return ratio * durationRef.current;
  }, []);

  const seekTo = useCallback(
    (t, force = false) => {
      const now = Date.now();
      if (!force && now - lastSeekRef.current < SEEK_THROTTLE_MS) return;
      lastSeekRef.current = now;
      videoRef?.current?.seek(t);
    },
    [videoRef]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => durationRef.current > 0,
        onStartShouldSetPanResponderCapture: () => durationRef.current > 0,
        onMoveShouldSetPanResponder: () => durationRef.current > 0,
        onMoveShouldSetPanResponderCapture: () => scrubbingRef.current,
        // Never let a parent (tab-swipe, FlatList pager, etc.) steal the drag.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (evt) => {
          startXRef.current = evt.nativeEvent.locationX;
          scrubbingRef.current = true;
          setScrubbing(true);
          onScrubChange?.(true);
          const t = timeAt(startXRef.current);
          currentRef.current = t;
          setCurrent(t);
          seekTo(t, true);
        },
        onPanResponderMove: (_, g) => {
          const t = timeAt(startXRef.current + g.dx);
          currentRef.current = t;
          setCurrent(t);
          seekTo(t);
        },
        onPanResponderRelease: (_, g) => {
          const t = timeAt(startXRef.current + g.dx);
          seekTo(t, true);
          currentRef.current = t;
          setCurrent(t);
          scrubbingRef.current = false;
          setScrubbing(false);
          onScrubChange?.(false);
        },
        onPanResponderTerminate: () => {
          scrubbingRef.current = false;
          setScrubbing(false);
          onScrubChange?.(false);
        },
      }),
    [onScrubChange, seekTo, timeAt]
  );

  if (!duration) return null;

  const progress = Math.min(current / duration, 1);

  return (
    <View
      style={[styles.hitArea, { bottom, left, right }]}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width || 1;
      }}
      {...panResponder.panHandlers}
    >
      {scrubbing && (
        <View style={styles.timeWrap} pointerEvents="none">
          <Text style={styles.timeText}>
            {fmt(current)}
            <Text style={styles.timeTotal}>{`  /  ${fmt(duration)}`}</Text>
          </Text>
        </View>
      )}

      <View pointerEvents="none" style={styles.trackArea}>
        <View style={[styles.track, scrubbing && styles.trackActive]}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        {scrubbing && (
          <View style={[styles.thumb, { left: `${progress * 100}%` }]} />
        )}
      </View>
    </View>
  );
});

export default VideoSeekBar;

const styles = StyleSheet.create({
  // tall invisible touch target so the thin line is easy to grab
  hitArea: {
    position: "absolute",
    height: 20,
    justifyContent: "flex-end",
    zIndex: 30,
    elevation: 30,
  },
  trackArea: { height: 12, justifyContent: "flex-end" },
  track: {
    height: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  trackActive: { height: 6 },
  fill: { height: "100%", backgroundColor: "#fff" },
  thumb: {
    position: "absolute",
    bottom: -2,
    marginLeft: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
  },
  timeWrap: {
    position: "absolute",
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  timeText: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  timeTotal: { color: "rgba(255,255,255,0.7)", fontSize: 18, fontWeight: "600" },
});