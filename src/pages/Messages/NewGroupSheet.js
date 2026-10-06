import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  StyleSheet,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import Config from "react-native-config";
import { apiFetch as authApiFetch } from "../../api/authToken";

const API = Config.API_URL;
const GOLDEN = "rgb(234,182,118)";

const apiFetch = async (url, options = {}) => {
  // Uses the shared apiFetch from authToken.js so an expired token is
  // refreshed automatically on a 401 instead of just throwing.
  const res = await authApiFetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const SearchIcon = ({ color = "#bbb", size = 18 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <Circle cx="11" cy="11" r="8" />
    <Line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);
const CloseIcon = ({ color = "#333", size = 16 }) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" width={size} height={size}>
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

const COLORS = ["#e74c3c", "#e67e22", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c", "#e91e63", "#ff5722"];
const getColor = (str) => COLORS[(str?.charCodeAt(0) || 0) % COLORS.length];
const getInitials = (name) => name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";

function Avatar({ user, size = 42 }) {
  const pic = user?.profilePic;
  if (pic) {
    return <Image source={{ uri: pic }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: getColor(user?.username),
      alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ fontWeight: "700", color: "#fff", fontSize: size * 0.38 }}>{getInitials(user?.username)}</Text>
    </View>
  );
}

// Step 1: pick members (any user — following is NOT required for groups).
// Step 2: name the group, then create it. Creating sends a pending invite
// to every selected member; they must accept before they see the group.
export default function NewGroupSheet({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(new Map()); // id -> user
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const data = await apiFetch(`${API}/messages/search-users?q=${encodeURIComponent(search)}`);
        setResults(data.success ? data.users : []);
      } catch (err) { console.error(err); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [search]);

  const toggle = (user) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.has(user._id) ? next.delete(user._id) : next.set(user._id, user);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selected.size === 0 || creating) return;
    setCreating(true);
    try {
      const data = await apiFetch(`${API}/groups/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName.trim(), memberIds: Array.from(selected.keys()) }),
      });

      // FIX: previously, if the server responded with HTTP 200 but
      // { success: false, message: "..." } (e.g. validation failure,
      // duplicate name, member limit, etc.), this whole function
      // silently did nothing — no error shown, no group created, and
      // the sheet just sat there with the "Creating…" button reverting
      // with zero feedback. Now any non-success response surfaces an
      // alert instead of failing silently.
      if (data?.success) {
        // FIX: some server responses may key the group's room id as
        // `_id` instead of `chatId` (or vice versa) — normalize so the
        // parent's onCreated handler always has a `chatId` to work with,
        // regardless of which field the API actually returned.
        const group = data.group || {};
        onCreated({ ...group, chatId: group.chatId || group._id });
      } else {
        Alert.alert(data?.message || "Couldn't create the group. Please try again.");
      }
    } catch (err) {
      console.error("Create group failed", err);
      Alert.alert("Couldn't create the group. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet} onPress={() => {}}>
          <View style={s.header}>
            <Text style={s.title}>{step === 1 ? "Add members" : "Name your group"}</Text>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}><CloseIcon /></TouchableOpacity>
          </View>

          {step === 1 && (
            <>
              {selected.size > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipsRow} contentContainerStyle={{ flexWrap: "wrap", flexDirection: "row" }}>
                  {Array.from(selected.values()).map((u) => (
                    <TouchableOpacity key={u._id} style={s.chip} onPress={() => toggle(u)}>
                      <Avatar user={u} size={22} />
                      <Text style={s.chipText}>{u.username}</Text>
                      <CloseIcon size={12} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <View style={s.searchWrap}>
                <SearchIcon />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search people to add…"
                  placeholderTextColor="#bbb"
                  value={search}
                  onChangeText={setSearch}
                  autoFocus
                />
              </View>

              <ScrollView style={s.list}>
                {searching && <Text style={s.hint}>Searching…</Text>}
                {!searching && results.length === 0 && (
                  <Text style={s.hint}>{search ? "No users found." : "Start typing to find people."}</Text>
                )}
                {!searching && results.map((u) => (
                  <TouchableOpacity key={u._id} style={s.userRow} onPress={() => toggle(u)}>
                    <Avatar user={u} size={44} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.userName}>{u.username}</Text>
                      <Text style={s.userSubtext}>{u.isPrivate ? "🔒 Private" : (u.bio || "")}</Text>
                    </View>
                    <View style={[s.checkbox, selected.has(u._id) && s.checkboxChecked]}>
                      {selected.has(u._id) && <Text style={s.checkboxCheck}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={s.footer}>
                <TouchableOpacity
                  style={[s.primaryBtn, { opacity: selected.size > 0 ? 1 : 0.5 }]}
                  disabled={selected.size === 0}
                  onPress={() => setStep(2)}
                >
                  <Text style={s.primaryBtnText}>Next {selected.size > 0 ? `(${selected.size})` : ""}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                <TextInput
                  style={s.nameInput}
                  placeholder="Group name"
                  placeholderTextColor="#999"
                  value={groupName}
                  onChangeText={setGroupName}
                  maxLength={100}
                  autoFocus
                />
                <Text style={s.inviteHint}>
                  {selected.size} member{selected.size !== 1 ? "s" : ""} will be invited. They'll need to accept before they can see the group.
                </Text>
              </View>

              <ScrollView style={s.list}>
                {Array.from(selected.values()).map((u) => (
                  <View key={u._id} style={s.userRow}>
                    <Avatar user={u} size={40} />
                    <Text style={s.step2UserName}>{u.username}</Text>
                  </View>
                ))}
              </ScrollView>

              <View style={s.footer}>
                <TouchableOpacity style={s.secondaryBtn} onPress={() => setStep(1)}>
                  <Text style={s.secondaryBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.primaryBtn, { opacity: groupName.trim() && !creating ? 1 : 0.5 }]}
                  disabled={!groupName.trim() || creating}
                  onPress={handleCreate}
                >
                  <Text style={s.primaryBtnText}>{creating ? "Creating…" : "Create Group"}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  // FIX: added explicit `height` alongside `maxHeight`. `maxHeight` alone
  // doesn't give this View a real, laid-out height — it only caps it — so
  // the flex:1 results list below (`s.list`) had no bounded parent to
  // expand into and collapsed to almost nothing. Matches the pattern
  // ShareSheet.js already uses successfully (height + maxHeight together).
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "80%", maxHeight: "85%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  title: { fontSize: 16, fontWeight: "700", color: "#111" },
  iconBtn: { padding: 6 },
  chipsRow: { paddingHorizontal: 16, paddingTop: 10, maxHeight: 40 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f2f2f2", borderRadius: 20, paddingVertical: 4, paddingLeft: 4, paddingRight: 10, marginRight: 6, marginBottom: 6 },
  chipText: { fontSize: 12, fontWeight: "600", color: "#333" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  searchInput: { flex: 1, fontSize: 14, color: "#111" },
  nameInput: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ececec", backgroundColor: "#f7f7f7", fontSize: 15, color: "#111" },
  inviteHint: { fontSize: 12, color: "#999", marginTop: 10, marginHorizontal: 2 },
  list: { flex: 1, paddingVertical: 6 },
  hint: { textAlign: "center", color: "#bbb", fontSize: 14, paddingVertical: 24 },
  userRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  userName: { fontWeight: "600", fontSize: 14, color: "#111" },
  userSubtext: { fontSize: 12, color: "#999", marginTop: 2 },
  step2UserName: { marginLeft: 12, fontSize: 14, fontWeight: "600", color: "#111" },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ddd", alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: GOLDEN, borderWidth: 0 },
  checkboxCheck: { color: "#fff", fontSize: 12 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  primaryBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: GOLDEN, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  secondaryBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fff", alignItems: "center" },
  secondaryBtnText: { color: "#111", fontWeight: "700", fontSize: 14 },
});