import React from "react";
import { View, Text, TouchableOpacity, FlatList, Dimensions, StyleSheet } from "react-native";
import FeatherIcon from "react-native-vector-icons/Feather";
import LinearGradient from "react-native-linear-gradient";
import { useNavigation, useRoute } from "@react-navigation/native";
import Videopost from "./Video"; // adjust to match your converted RN video.jsx filename

const SCREEN_HEIGHT = Dimensions.get("window").height;

function Reelspage() {
  const navigation = useNavigation();
  const route = useRoute();

  const { video, allVideos = [] } = route.params || {};

  if (!video) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>No reel found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={{ color: "#000", fontWeight: "600" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Arrange reels so the clicked reel appears first — same rotation logic
  // as the web version, just using FlatList's data array instead of
  // scroll-snap div stacking.
  const clickedIndex = allVideos.findIndex((item) => item._id === video._id);
  const orderedVideos =
    allVideos.length > 0
      ? [...allVideos.slice(clickedIndex), ...allVideos.slice(0, clickedIndex)]
      : [video];

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <LinearGradient colors={["rgba(0,0,0,0.7)", "transparent"]} style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <FeatherIcon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.heading}>Reels</Text>
        <View style={{ width: 24 }} />
      </LinearGradient>

      {/* Reels Feed — vertical paging replaces the web version's
          scroll-snap-type: y mandatory / scroll-snap-align: start. */}
      <FlatList
        data={orderedVideos}
        keyExtractor={(v) => v._id}
        renderItem={({ item }) => (
          <View style={{ height: SCREEN_HEIGHT, width: "100%" }}>
            <Videopost p={item} />
          </View>
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * index, index })}
      />
    </View>
  );
}

export default Reelspage;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", width: "100%", maxWidth: 400, alignSelf: "center" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  heading: { color: "#fff", fontSize: 18, fontWeight: "600" },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    backgroundColor: "#000",
  },
  backBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: "#fff" },
});