// LinkifiedText.js
// Put this file in the SAME folder as ProfilePage.js / UserProfileView.js
import React, { useState, useMemo } from "react";
import { Text, Linking, Alert } from "react-native";

// http(s)://..., www.... or bare domains like example.com/page
const URL_REGEX =
  /((?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|io|me|co|app|dev|tv|ly|link|gg|xyz|info|shop|store|online|site)(?:\/[^\s]*)?)/gi;

const TRAILING_PUNCT = /[.,!?;:)\]}'"]+$/;

// Find all links in the text -> [{ start, end, url }]
function findLinks(text) {
  const links = [];
  const re = new RegExp(URL_REGEX.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    let raw = m[0];
    const start = m.index;

    // skip emails (abc@gmail.com) and words glued to a previous character
    const prev = start > 0 ? text[start - 1] : "";
    if (prev === "@" || /[a-z0-9]/i.test(prev)) continue;

    // strip trailing punctuation like "." or ")"
    const trimmed = raw.replace(TRAILING_PUNCT, "");
    if (!trimmed) continue;
    raw = trimmed;

    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    links.push({ start, end: start + raw.length, url });
  }
  return links;
}

async function openLink(url) {
  try {
    // Hands the URL to Android -> opens Chrome / default browser
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert("Can't open link", url);
  }
}

// Turns a string into an array of <Text> pieces (normal text + blue links)
function renderPieces(text, links, linkStyle) {
  const out = [];
  let cursor = 0;
  links.forEach((l, i) => {
    if (l.start > cursor) out.push(text.slice(cursor, l.start));
    out.push(
      <Text key={`l${i}`} style={linkStyle} onPress={() => openLink(l.url)}>
        {text.slice(l.start, l.end)}
      </Text>
    );
    cursor = l.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/**
 * Props:
 *  text       - the bio / caption string
 *  limit      - characters shown before "... more" (default 120)
 *  textStyle  - style of the normal text (e.g. styles.bio)
 *  linkColor  - link colour (default blue)
 *  moreStyle  - style of the more / less button
 */
export default function LinkifiedText({
  text,
  limit = 120,
  textStyle,
  linkColor = "#1a73e8",
  moreStyle,
}) {
  const [expanded, setExpanded] = useState(false);

  const links = useMemo(() => (text ? findLinks(text) : []), [text]);
  if (!text) return null;

  const linkStyle = { color: linkColor, fontWeight: "600" };
  const btnStyle = moreStyle || { color: "#8e8e8e", fontWeight: "700" };
  const isLong = text.length > limit;

  // ── Full text (short bio, or expanded) ──
  if (!isLong || expanded) {
    return (
      <Text style={textStyle}>
        {renderPieces(text, links, linkStyle)}
        {isLong && (
          <Text onPress={() => setExpanded(false)} style={btnStyle}>
            {" "}less
          </Text>
        )}
      </Text>
    );
  }

  // ── Truncated: never cut a link in half ──
  let cut = limit;
  const hit = links.find((l) => l.start < cut && l.end > cut);
  if (hit) cut = hit.start;

  const shown = text.slice(0, cut).trimEnd();
  const shownLinks = links.filter((l) => l.end <= shown.length);

  return (
    <Text style={textStyle}>
      {renderPieces(shown, shownLinks, linkStyle)}...
      <Text onPress={() => setExpanded(true)} style={btnStyle}>
        {" "}more
      </Text>
    </Text>
  );
}