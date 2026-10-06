import React from "react";
import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet } from "react-native";
import Video from "react-native-video";

// ── Horizontal row of memory-group ("Highlight") bubbles, shown below
// Edit Profile on your own profile (with a leading "+ Add memory"
// button that creates a NEW group) and below the Follow/Message/Block
// row on other profiles (view-only). Each bubble opens that group's
// MemoryViewer, which itself fetches and pages through all items inside
// that one group.
function MemoriesRow({ groups, onOpenGroup, onAdd, showAdd }) {
  if (!showAdd && (!groups || groups.length === 0)) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap}>
      {showAdd && (
        <TouchableOpacity style={styles.item} onPress={onAdd}>
          <View style={styles.addCircle}>
            <Text style={{ fontSize: 26, lineHeight: 26, color: "#333" }}>+</Text>
          </View>
          <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
            Add memory
          </Text>
        </TouchableOpacity>
      )}
      {groups.map((g) => (
        <TouchableOpacity key={g._id} style={styles.item} onPress={() => onOpenGroup(g._id)}>
          <View style={styles.ring}>
            <View style={styles.ringInner}>
              {g.coverType === "video" ? (
                // Wrapped in a plain View with pointerEvents="none" rather
                // than setting the prop on <Video> directly — third-party
                // native components like react-native-video's <Video> don't
                // reliably forward/respect the pointerEvents prop the way a
                // core RN <View> does, so it could be silently ignored on
                // device. A plain View's pointerEvents="none" is a
                // guaranteed RN core behavior and makes its whole subtree
                // (the video included) pass touches straight through to the
                // TouchableOpacity above — which is all this cover needs,
                // since it's purely decorative (paused + muted).
                <View style={styles.thumb} pointerEvents="none">
                  <Video
                    source={{ uri: g.coverUrl }}
                    style={styles.thumb}
                    muted
                    paused
                    resizeMode="cover"
                  />
                </View>
              ) : (
                <Image source={{ uri: g.coverUrl }} style={styles.thumb} />
              )}
            </View>
            {g.itemsCount > 1 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{g.itemsCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
            {g.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default MemoriesRow;

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 16, paddingVertical: 4, paddingHorizontal: 18 },
  item: { alignItems: "center", gap: 6, width: 66 },
  addCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: "#ccc",
    borderStyle: "dashed",
    backgroundColor: "#fafafa",
    alignItems: "center",
    justifyContent: "center",
  },
  // ← Ring color changed from the rainbow Instagram gradient to a solid
  // gold — rgb(234,182,118) — to match the story ring used everywhere
  // else in the app (Profilepage's own-story ring, UserProfileView's
  // unseen-story ring).
  ring: {
    position: "relative",
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "rgb(234,182,118)",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  ringInner: {
    width: "100%",
    height: "100%",
    borderRadius: 29,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%", borderRadius: 27 },
  label: { fontSize: 11, color: "#444", fontWeight: "500", textAlign: "center", width: "100%" },
  countBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: "#111",
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 2,
    borderColor: "#fff",
  },
  countBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});