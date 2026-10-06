// styles/messagesStyles.js
import { StyleSheet, Platform } from "react-native";

// ── Fonts ────────────────────────────────────────────────────────────────
// @import url(fonts.googleapis.com/...) has no RN equivalent. Nunito must
// be bundled as a local font file and linked via react-native.config.js
// (Android: android/app/src/main/assets/fonts, iOS: Info.plist UIAppFonts),
// or loaded with `expo-font` if using Expo. Once linked, reference it by
// its PostScript name below instead of the CSS family string.
const FONT_REGULAR = Platform.select({ ios: "Nunito-Regular", android: "Nunito-Regular" });
const FONT_MEDIUM = Platform.select({ ios: "Nunito-Medium", android: "Nunito-Medium" });
const FONT_SEMIBOLD = Platform.select({ ios: "Nunito-SemiBold", android: "Nunito-SemiBold" });
const FONT_BOLD = Platform.select({ ios: "Nunito-Bold", android: "Nunito-Bold" });

// ── Design tokens (was :root CSS variables) ─────────────────────────────
export const colors = {
  bg: "#fafafa",
  white: "#ffffff",
  border: "#dbdbdb",
  text: "#262626",
  textSecondary: "#737373",
  textMuted: "#a8a8a8",
  accent: "#0095f6",
  bubbleMe: "#3797f0",
  bubbleMeText: "#fff",
  bubbleOther: "#efefef",
  bubbleOtherText: "#262626",
};

export const messagesStyles = StyleSheet.create({
  /* ── Page shell ── */
  messagesPage: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  dmListWrap: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    // paddingBottom: 80 — no longer needed as "clearance for a fixed
    // bottom navbar" the way it was on web; if your RN Navbar sits in a
    // tab bar it's handled by the navigator's own safe-area insets, not
    // manual padding here.
  },

  /* ── DM list header ── */
  // position: sticky + top: 0 has no RN ScrollView equivalent — a
  // sticky header needs `stickyHeaderIndices` on a ScrollView, or to be
  // rendered as a fixed sibling ABOVE the ScrollView entirely (the more
  // common RN pattern, used in the Messages.jsx conversion earlier in
  // this thread).
  dmHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dmHeaderLeft: {
    flexDirection: "column",
  },
  dmHeaderTitle: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    // letterSpacing: -0.4 in CSS is a negative tracking value; RN
    // supports negative letterSpacing directly, no change needed:
    letterSpacing: -0.4,
    color: colors.text,
  },
  dmHeaderUsername: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: colors.textSecondary,
  },
  // .icon-btn:hover { background: #f0f0f0 } has no RN touch equivalent.
  // Use TouchableOpacity's activeOpacity, or TouchableHighlight's
  // underlayColor, to approximate a "pressed" state instead of hover.
  iconBtn: {
    padding: 6,
    borderRadius: 999, // RN has no `50%` for radius; use a large fixed
                        // value or (width/2) once the element has a
                        // known fixed size, whichever is available here.
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── Section label ── */
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    color: colors.text,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
  },

  /* ── DM item ── */
  // transition + :hover both dropped — no CSS transitions in RN.
  dmItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.white,
  },
  dmAvatarWrap: {
    position: "relative",
  },
  dmAvatarBase: {
    width: 56,
    height: 56,
    borderRadius: 28, // 56 / 2, since RN needs an explicit numeric radius
    alignItems: "center",
    justifyContent: "center",
  },
  dmAvatarText: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    color: "#fff",
  },
  onlineDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    backgroundColor: "#26c95f",
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.white,
  },
  dmInfo: {
    flex: 1,
    minWidth: 0,
  },
  dmName: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: FONT_SEMIBOLD,
    color: colors.text,
    // white-space/overflow/text-overflow ellipsis → numberOfLines={1} on
    // the <Text> component in JSX, not a style property here.
  },
  dmLast: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dmLastUnread: {
    color: colors.text,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
  },
  dmMeta: {
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
  },
  dmTime: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: colors.textMuted,
  },
  unreadBadge: {
    width: 8,
    height: 8,
    backgroundColor: colors.accent,
    borderRadius: 4,
  },

  /* ───────────────────────────
     CHAT WINDOW OVERLAY
  ─────────────────────────── */
  // position: fixed + inset: 0 → fill the parent with absoluteFillObject
  // (or render as its own full-screen navigation route, which is the
  // more idiomatic RN pattern instead of an overlay div).
  // The slideUp @keyframes animation needs to be built with
  // react-native-reanimated or the Animated API, driving a translateY
  // on mount — it's not a static style, so it lives in the component
  // (see note below), not this stylesheet.
  chatOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    flexDirection: "column",
    backgroundColor: colors.white,
  },

  /* top bar */
  chatTopbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  backBtn: {
    padding: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  // .back-btn svg { width/height: 24 } → pass size={24} directly to
  // whatever icon component you're rendering (e.g. react-native-svg
  // icon or vector-icons), not a stylesheet entry.
  topbarAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  topbarAvatarText: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    color: "#fff",
  },
  topbarName: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    color: colors.text,
  },
  topbarStatus: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: colors.textSecondary,
  },
  topbarActions: {
    marginLeft: "auto",
    flexDirection: "row",
    gap: 2,
  },

  /* messages area */
  // overflow-y: auto + custom scrollbar-width/scrollbar-color/::-webkit-*
  // all have no RN equivalent — ScrollView scrolls natively and its
  // scrollbar is OS-drawn; there's no way to restyle scrollbar
  // thickness/color from JS/style props. All of that is simply dropped.
  chatMessages: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 16,
    flexDirection: "column",
    gap: 3,
    backgroundColor: colors.white,
  },

  /* time label */
  chatTimeLabel: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    fontFamily: FONT_SEMIBOLD,
    color: colors.textMuted,
    marginTop: 10,
    marginBottom: 4,
  },

  /* bubble row */
  // The bpop @keyframes entrance animation (opacity + scale + translateY)
  // needs Animated/Reanimated driven per-message on mount — not
  // expressible as a static style. See component-level note below.
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  bubbleRowMe: {
    flexDirection: "row-reverse",
  },
  bAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  bAvatarText: {
    fontSize: 8,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    color: "#fff",
  },
  // .bubble-row.chain .b-avatar { visibility: hidden } — RN has no
  // `visibility` style; use `opacity: 0` (keeps layout space, matching
  // CSS visibility:hidden's behavior) instead of conditionally
  // not-rendering the avatar.
  bAvatarHiddenInChain: {
    opacity: 0,
  },
  bubble: {
    maxWidth: "65%",
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    lineHeight: 20, // CSS line-height:1.45 at font-size 14 ≈ 20px fixed
    fontFamily: FONT_REGULAR,
  },
  bubbleMe: {
    backgroundColor: colors.bubbleMe,
    color: colors.bubbleMeText,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 22,
  },
  bubbleOther: {
    backgroundColor: colors.bubbleOther,
    color: colors.bubbleOtherText,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    borderBottomLeftRadius: 4,
  },
  bubbleMeChain: {
    borderTopRightRadius: 4,
  },
  bubbleOtherChain: {
    borderTopLeftRadius: 4,
  },

  /* seen indicator */
  seenRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingRight: 4,
    marginTop: 2,
  },
  seenAv: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  seenAvText: {
    fontSize: 5,
    fontWeight: "700",
    fontFamily: FONT_BOLD,
    color: "#fff",
  },

  /* input bar */
  chatInputBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  emojiIcon: {
    fontSize: 22,
    // user-select: none has no RN meaning — Text isn't selectable by
    // default anyway unless selectable={true} is explicitly set.
  },
  chatTextInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 9,
    fontFamily: FONT_REGULAR,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.bg,
    // :focus { border-color: #b2b2b2 } → apply conditionally via a
    // `focused` state + onFocus/onBlur handlers in the component, e.g.
    // style={[styles.chatTextInput, focused && styles.chatTextInputFocused]}
  },
  chatTextInputFocused: {
    borderColor: "#b2b2b2",
  },
  sendBtn: {
    fontFamily: FONT_BOLD,
    fontSize: 14,
    fontWeight: "700",
    color: colors.accent,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  sendBtnDisabled: {
    color: colors.textMuted,
  },
  // .send-btn:not(:disabled):hover { opacity: 0.65 } — again, no hover;
  // approximate with TouchableOpacity's built-in activeOpacity on press.
});

export default messagesStyles;