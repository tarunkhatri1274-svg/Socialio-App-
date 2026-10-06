import React from "react";
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import { useNavigation } from "@react-navigation/native";

function StoriesBar({ stories, setStories, openStory, userProfile, currentUserId }) {
  const navigation = useNavigation();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.barContent}>
      {/* YOUR STORY — a fixed, always-plus "add story" button. It never
          changes appearance, even after a story has been added — the
          user's own story shows up as its own separate circle in the
          list below instead (same treatment as everyone else's story),
          exactly like it already looks to other users. */}
      <TouchableOpacity style={styles.item} onPress={() => navigation.navigate("CreateStory")}>
        <View style={styles.plusCircle}>
          <Icon name="plus" size={22} color="#fff" />
        </View>
        <Text style={styles.name} numberOfLines={1}>Your Story</Text>
      </TouchableOpacity>

      {/* STORIES LIST — includes the owner's own story (if any) as a
          normal entry, labeled "Your Story" so it's still recognizable,
          instead of being folded into the add-button above. */}
      {stories.map((story, index) => {
        const isLive = story.slides?.some((s) => s.type === "live" || s.isLive);

        // Belt-and-suspenders ownership check: trust story.isOwn if it's
        // set, but ALSO fall back to comparing story.id against the live
        // currentUserId prop. This guards against exactly the bug seen
        // in testing — one account's own story showing a grey "seen"
        // ring instead of always staying gold — which happens if
        // story.isOwn was ever wrong/stale for any reason. Either signal
        // being true is enough to treat it as your own.
        const isOwnStory = story.isOwn || (currentUserId && story.id?.toString() === currentUserId);

        // "Seen" (grey ring) once EVERY current slide from this author
        // has been viewed by you — driven by the persisted `viewedByMe`
        // flag that getAllStories() returns per story, not local-only
        // state, so it survives a refresh. Your own story is NEVER shown
        // as "seen/unseen" — it always keeps the normal gold ring.
        const isSeen = !isOwnStory && story.slides?.length > 0 && story.slides.every((s) => s.viewedByMe);

        const ringColor = isLive
          ? "rgb(234,182,118)" // live story always gold, never grey, regardless of isSeen
          : story.id === "local"
          ? "#aaa"
          : isOwnStory
          ? "rgb(234,182,118)" // own story always gold, never grey, regardless of isSeen
          : isSeen
          ? "#c7c7c7"
          : "rgb(234,182,118)";

        return (
          <TouchableOpacity key={story._id || story.id || index} style={styles.item} onPress={() => openStory(index)}>
            <View style={[styles.ring, { backgroundColor: ringColor }]}>
              <Image source={{ uri: story.userProfile || story.slides?.[0]?.image }} style={styles.img} />
              {/* LIVE badge */}
              {isLive && (
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>LIVE</Text>
                </View>
              )}
              {/* video badge — only for non-live */}
              {!isLive && story.slides?.[0]?.type === "video" && (
                <View style={styles.videoBadge}>
                  <Icon name="video" size={7} color="#fff" />
                </View>
              )}
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {isOwnStory ? "Your Story" : story.username || "User"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default StoriesBar;

/* ─── styles — same as the web version ────────────────────────────────────── */
const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: "#efefef", backgroundColor: "#fff" },
  barContent: { flexDirection: "row", gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  item: { alignItems: "center", gap: 4 },
  ring: { padding: 3, borderRadius: 35 },
  img: { width: 64, height: 64, borderRadius: 32, borderWidth: 2.5, borderColor: "#fff" },
  name: { fontSize: 11, color: "#262626", maxWidth: 70, textAlign: "center" },
  videoBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 18,
    height: 18,
    backgroundColor: "#e53935",
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  liveBadge: {
    position: "absolute",
    bottom: 0,
    left: "50%",
    transform: [{ translateX: -14 }],
    backgroundColor: "#ff3b30",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  liveBadgeText: { color: "#fff", fontSize: 8, fontWeight: "800", letterSpacing: 0.5 },
  // Plain "+" circle for "Your Story" — no ring, no photo, just a solid
  // golden circle with a plus. Same footprint (70x70) as the ring+avatar
  // combo below so the bar doesn't jump when a story is added. This is
  // permanent — it no longer swaps to an avatar once a story exists.
  plusCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "rgb(234,182,118)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
  },
});