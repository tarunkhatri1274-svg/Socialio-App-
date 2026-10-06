import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, Alert, StyleSheet, Switch, ActivityIndicator } from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import Config from "react-native-config";
import socket from "../../sockets/Sockets";
import { apiFetch } from "../../api/authToken"; // adjust relative path — count folders to src/api/authToken.js

const API = Config.API_URL;

function confirmAsync(message) {
  return new Promise((resolve) => {
    Alert.alert("Confirm", message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

const AvatarCircle = ({ user, size }) =>
  user?.profilePic ? (
    <Image source={{ uri: user.profilePic }} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.38 }}>
        {user?.username?.[0]?.toUpperCase() || "?"}
      </Text>
    </View>
  );

// ← NEW — comment/reply id to scroll-to + briefly highlight on mount,
// passed down from the notification-open handoff (see PostCard's
// `pendingSheet` handling). Purely cosmetic: doesn't change any
// like/edit/delete behavior below.
const HIGHLIGHT_MS = 2200;

/* ─── Comment polls ─── */
const POLL_ACCENT = "#1877f2";
const pollVoterId = (v) => String(v?._id || v);
const countPollVoters = (options) =>
  new Set((options || []).flatMap((o) => (o.votes || []).map(pollVoterId))).size;

// Pinned comments first (most recently pinned on top); others keep order.
const sortPinned = (list) => {
  const arr = Array.isArray(list) ? list : [];
  const pinned = arr
    .filter((c) => c.isPinned)
    .sort((a, b) => new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0));
  return [...pinned, ...arr.filter((c) => !c.isPinned)];
};

function CommentPollVoters({ poll, myId }) {
  const options = poll.options || [];
  return (
    <View style={pollStyles.votersBox}>
      {options.map((o) => {
        const voters = o.votes || [];
        return (
          <View key={String(o._id)}>
            <View style={pollStyles.voterOptHeader}>
              <Text style={pollStyles.voterOptTitle}>{o.text}</Text>
              <Text style={pollStyles.voterOptCount}>{voters.length} {voters.length === 1 ? "vote" : "votes"}</Text>
            </View>
            {voters.length === 0 ? (
              <Text style={pollStyles.noVotes}>No votes</Text>
            ) : (
              voters.map((u) => {
                const user = typeof u === "object" && u ? u : { _id: String(u), username: "Someone" };
                return (
                  <View key={String(user._id)} style={pollStyles.voterRow}>
                    <AvatarCircle user={user} size={30} />
                    <Text style={pollStyles.voterName}>
                      {user.username}{String(user._id) === myId ? " (You)" : ""}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        );
      })}
    </View>
  );
}

function CommentPollBody({ poll, myId, onVote }) {
  const [showVoters, setShowVoters] = useState(false);
  const options = poll.options || [];
  const total = countPollVoters(options);
  const myChoices = options
    .filter((o) => (o.votes || []).some((v) => pollVoterId(v) === myId))
    .map((o) => String(o._id));

  const toggle = (optId) => {
    const id = String(optId);
    let next;
    if (poll.allowMultiple) next = myChoices.includes(id) ? myChoices.filter((x) => x !== id) : [...myChoices, id];
    else next = myChoices.includes(id) ? [] : [id];
    onVote(next);
  };

  return (
    <View style={{ marginTop: 5 }}>
      <Text style={pollStyles.question}>{poll.question}</Text>
      <Text style={pollStyles.hint}>{poll.allowMultiple ? "Select one or more" : "Select one"}</Text>

      {options.map((o) => {
        const id = String(o._id);
        const count = o.votes?.length || 0;
        const mine = myChoices.includes(id);
        const pct = total ? (count / total) * 100 : 0;
        return (
          <TouchableOpacity key={id} activeOpacity={0.7} style={pollStyles.optRow} onPress={() => toggle(id)}>
            <View style={pollStyles.optTop}>
              <View style={[pollStyles.circle, { borderColor: mine ? POLL_ACCENT : "#aaa" }, mine && { backgroundColor: POLL_ACCENT }]}>
                {mine && <Icon name="check" size={9} color="#fff" />}
              </View>
              <Text style={pollStyles.optText}>{o.text}</Text>
              <Text style={pollStyles.optCount}>{count}</Text>
            </View>
            <View style={pollStyles.track}>
              <View style={[pollStyles.bar, { width: `${pct}%` }]} />
            </View>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity style={pollStyles.viewVotes} onPress={() => setShowVoters((v) => !v)} disabled={total === 0}>
        <Text style={[pollStyles.viewVotesText, { opacity: total ? 1 : 0.5 }]}>
          {total ? (showVoters ? "Hide votes" : `View votes (${total})`) : "No votes yet"}
        </Text>
      </TouchableOpacity>

      {showVoters && total > 0 && <CommentPollVoters poll={poll} myId={myId} />}
    </View>
  );
}

// Rendered IN PLACE of the comment list (no <Modal>) — the comment sheet is
// already a Modal, and nesting a second Modal inside it is the Android
// failure mode this app has hit before.
function CreateCommentPollForm({ onClose, onCreate }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const cleaned = options.map((o) => o.trim()).filter(Boolean);
  const canSend = question.trim().length > 0 && new Set(cleaned).size >= 2 && !submitting;
  const setOpt = (i, v) => setOptions((p) => p.map((o, idx) => (idx === i ? v : o)));
  const addOpt = () => setOptions((p) => (p.length >= 12 ? p : [...p, ""]));
  const removeOpt = (i) => setOptions((p) => p.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      await onCreate({ question: question.trim(), options: cleaned, allowMultiple });
    } catch (err) {
      Alert.alert("Couldn't create poll", err?.message || "Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <View style={pollStyles.formWrap}>
      <View style={pollStyles.formHeader}>
        <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
          <Icon name="arrow-left" size={16} color="#333" />
        </TouchableOpacity>
        <Text style={pollStyles.sheetTitle}>Create poll</Text>
      </View>

      <Text style={pollStyles.label}>Question</Text>
      <TextInput style={pollStyles.input} placeholder="Ask a question" placeholderTextColor="#999" value={question} onChangeText={setQuestion} maxLength={250} multiline />

      <Text style={pollStyles.label}>Options</Text>
      {options.map((o, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
          <TextInput style={[pollStyles.input, { flex: 1 }]} placeholder={`Option ${i + 1}`} placeholderTextColor="#999" value={o} onChangeText={(v) => setOpt(i, v)} maxLength={100} />
          {options.length > 2 && (
            <TouchableOpacity onPress={() => removeOpt(i)} style={{ padding: 8 }}><Icon name="times" size={14} color="#e53935" /></TouchableOpacity>
          )}
        </View>
      ))}
      {options.length < 12 && (
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10 }} onPress={addOpt}>
          <Icon name="plus" size={13} color={POLL_ACCENT} />
          <Text style={{ color: POLL_ACCENT, fontWeight: "700", fontSize: 14, marginLeft: 8 }}>Add option</Text>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, marginBottom: 18 }}>
        <Text style={{ fontSize: 14, color: "#111", fontWeight: "600" }}>Allow multiple answers</Text>
        <Switch value={allowMultiple} onValueChange={setAllowMultiple} trackColor={{ false: "#ddd", true: "#a9c9fa" }} thumbColor={allowMultiple ? POLL_ACCENT : "#f4f4f4"} />
      </View>

      <TouchableOpacity style={[pollStyles.sendBtn, { opacity: canSend ? 1 : 0.45 }]} onPress={submit} disabled={!canSend}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Post poll</Text>}
      </TouchableOpacity>
    </View>
  );
}

const CommentSection = ({ comments, setComments, currentUser, postId, highlightCommentId = null, highlightReplyId = null, scrollRef = null, postAuthorId = null }) => {
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyingToReplyId, setReplyingToReplyId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [editingReply, setEditingReply] = useState({ commentId: null, replyId: null, text: "" });
  const [activeHighlight, setActiveHighlight] = useState(highlightReplyId || highlightCommentId || null);
  // Top-level comment y-offsets, captured via onLayout — good enough to
  // scroll near a highlighted reply too, since replies render right below
  // their parent comment.
  const itemYRef = React.useRef({});
  const [creatingPoll, setCreatingPoll] = useState(false);

  useEffect(() => {
    const targetCommentId = highlightReplyId
      ? comments?.find((c) => c.replies?.some((r) => r._id === highlightReplyId))?._id
      : highlightCommentId;
    if (!targetCommentId) return;
    const y = itemYRef.current[targetCommentId];
    if (y == null) return;
    const t = setTimeout(() => {
      scrollRef?.current?.scrollTo?.({ y: Math.max(y - 12, 0), animated: true });
    }, 50);
    const clearTimer = setTimeout(() => setActiveHighlight(null), HIGHLIGHT_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, highlightCommentId, highlightReplyId]);

  const highlightStyle = (id) => (activeHighlight === id ? styles.highlighted : null);
  // ✅ scoped socket listeners
  useEffect(() => {
    if (!postId) return;

    const onCommentEdited = ({ commentId, text, isEdited }) => {
      setComments((prev) => prev.map((c) => (c._id === commentId ? { ...c, text, isEdited } : c)));
    };

    const onCommentDeleted = ({ commentId }) => {
      setComments((prev) => prev.filter((c) => c._id !== commentId));
    };

    const onCommentLiked = ({ commentId, totalLikes, userId }) => {
      if (userId?.toString() === currentUser?._id?.toString()) return;
      setComments((prev) =>
        prev.map((c) => (c._id === commentId ? { ...c, likes: Array(totalLikes).fill(null) } : c))
      );
    };

    const onNewReply = ({ commentId, reply }) => {
      setComments((prev) =>
        prev.map((c) => {
          if (c._id !== commentId) return c;
          if (c.replies?.some((r) => r._id === reply._id)) return c;
          return { ...c, replies: [...(c.replies || []), reply] };
        })
      );
    };

    const onReplyEdited = ({ commentId, replyId, text, isEdited }) => {
      setComments((prev) =>
        prev.map((c) => {
          if (c._id !== commentId) return c;
          return { ...c, replies: c.replies.map((r) => (r._id === replyId ? { ...r, text, isEdited } : r)) };
        })
      );
    };

    const onReplyDeleted = ({ commentId, replyId }) => {
      setComments((prev) =>
        prev.map((c) => {
          if (c._id !== commentId) return c;
          return { ...c, replies: c.replies.filter((r) => r._id !== replyId) };
        })
      );
    };

    const onReplyLiked = ({ commentId, replyId, totalLikes, userId }) => {
      if (userId?.toString() === currentUser?._id?.toString()) return;
      setComments((prev) =>
        prev.map((c) => {
          if (c._id !== commentId) return c;
          return {
            ...c,
            replies: c.replies.map((r) => (r._id === replyId ? { ...r, likes: Array(totalLikes).fill(null) } : r)),
          };
        })
      );
    };

    // ✅ all scoped to this postId
    const onCommentPollUpdated = ({ commentId, options }) => {
      setComments((prev) => prev.map((c) => (c._id === commentId && c.poll ? { ...c, poll: { ...c.poll, options } } : c)));
    };

    const onCommentPinned = ({ commentId, isPinned, pinnedAt }) => {
      setComments((prev) => prev.map((c) => (c._id === commentId ? { ...c, isPinned, pinnedAt } : c)));
    };

    socket.on(`post:${postId}:commentPollUpdated`, onCommentPollUpdated);
    socket.on(`post:${postId}:commentPinned`, onCommentPinned);
    socket.on(`post:${postId}:commentEdited`, onCommentEdited);
    socket.on(`post:${postId}:commentDeleted`, onCommentDeleted);
    socket.on(`post:${postId}:commentLiked`, onCommentLiked);
    socket.on(`post:${postId}:newReply`, onNewReply);
    socket.on(`post:${postId}:replyEdited`, onReplyEdited);
    socket.on(`post:${postId}:replyDeleted`, onReplyDeleted);
    socket.on(`post:${postId}:replyLiked`, onReplyLiked);

    return () => {
      socket.off(`post:${postId}:commentPollUpdated`, onCommentPollUpdated);
      socket.off(`post:${postId}:commentPinned`, onCommentPinned);
      socket.off(`post:${postId}:commentEdited`, onCommentEdited);
      socket.off(`post:${postId}:commentDeleted`, onCommentDeleted);
      socket.off(`post:${postId}:commentLiked`, onCommentLiked);
      socket.off(`post:${postId}:newReply`, onNewReply);
      socket.off(`post:${postId}:replyEdited`, onReplyEdited);
      socket.off(`post:${postId}:replyDeleted`, onReplyDeleted);
      socket.off(`post:${postId}:replyLiked`, onReplyLiked);
    };
  }, [postId, currentUser?._id]);

  const handleLike = async (commentId) => {
    const myId = currentUser?._id?.toString();
    setComments((prev) =>
      prev.map((c) => {
        if (c._id !== commentId) return c;
        const alreadyLiked = (c.likes || []).some((id) => id?.toString() === myId);
        return {
          ...c,
          likes: alreadyLiked
            ? (c.likes || []).filter((id) => id?.toString() !== myId)
            : [...(c.likes || []), currentUser._id],
        };
      })
    );
    try {
      await apiFetch(`${API}/auth/comment-like/${postId}/${commentId}`, { method: "POST" });
    } catch (err) {
      console.log(err);
    }
  };

  const handleReplySubmit = async (commentId) => {
    if (!replyText.trim()) return;
    try {
      // ← NEW — parentReplyId tells the backend which reply you tapped
      // "reply" on (if any), so it can notify THAT person specifically
      // instead of always notifying the top-level comment's author.
      const res = await apiFetch(`${API}/auth/reply/${postId}/${commentId}`, {
        method: "POST",
       
        body: JSON.stringify({ text: replyText, parentReplyId: replyingToReplyId || null }),
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) =>
          prev.map((c) => {
            if (c._id !== commentId) return c;
            if (c.replies?.some((r) => r._id === data.reply._id)) return c;
            return { ...c, replies: [...(c.replies || []), data.reply] };
          })
        );
        setReplyingToId(null);
        setReplyingToReplyId(null);
        setReplyText("");
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleEditSubmit = async (commentId) => {
    if (!editingCommentText.trim()) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${postId}/${commentId}`, {
        method: "PUT",
       
        body: JSON.stringify({ text: editingCommentText }),
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) =>
          prev.map((c) => (c._id === commentId ? { ...c, text: editingCommentText, isEdited: true } : c))
        );
        setEditingCommentId(null);
        setEditingCommentText("");
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleDelete = async (commentId) => {
    const ok = await confirmAsync("Delete this comment?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/comment/${postId}/${commentId}`, {
        method: "DELETE",
        
      });
      const data = await res.json();
      if (data.success) setComments((prev) => prev.filter((c) => c._id !== commentId));
    } catch (err) {
      console.log(err);
    }
  };

  const handleReplyLike = async (commentId, replyId) => {
    const myId = currentUser?._id?.toString();
    setComments((prev) =>
      prev.map((c) => {
        if (c._id !== commentId) return c;
        return {
          ...c,
          replies: c.replies.map((r) => {
            if (r._id !== replyId) return r;
            const alreadyLiked = (r.likes || []).some((id) => id?.toString() === myId);
            return {
              ...r,
              likes: alreadyLiked
                ? (r.likes || []).filter((id) => id?.toString() !== myId)
                : [...(r.likes || []), currentUser._id],
            };
          }),
        };
      })
    );
    try {
      await apiFetch(`${API}/auth/reply-like/${postId}/${commentId}/${replyId}`, { method: "POST"});
    } catch (err) {
      console.log(err);
    }
  };

  const handleReplyEditSubmit = async (commentId, replyId) => {
    if (!editingReply.text.trim()) return;
    try {
      const res = await apiFetch(`${API}/auth/reply/${postId}/${commentId}/${replyId}`, {
        method: "PUT",
      
        body: JSON.stringify({ text: editingReply.text }),
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) =>
          prev.map((c) => {
            if (c._id !== commentId) return c;
            return {
              ...c,
              replies: c.replies.map((r) =>
                r._id === replyId ? { ...r, text: editingReply.text, isEdited: true } : r
              ),
            };
          })
        );
        setEditingReply({ commentId: null, replyId: null, text: "" });
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleReplyDelete = async (commentId, replyId) => {
    const ok = await confirmAsync("Delete this reply?");
    if (!ok) return;
    try {
      const res = await apiFetch(`${API}/auth/reply/${postId}/${commentId}/${replyId}`, {
        method: "DELETE",
    
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) =>
          prev.map((c) => {
            if (c._id !== commentId) return c;
            return { ...c, replies: c.replies.filter((r) => r._id !== replyId) };
          })
        );
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleCreatePoll = async ({ question, options, allowMultiple }) => {
    const res = await apiFetch(`${API}/auth/comment-poll/${postId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, options, allowMultiple }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Couldn't create poll");
    setComments((prev) => (prev.some((c) => c._id === data.comment._id) ? prev : [...prev, data.comment]));
    setCreatingPoll(false);
  };

  // optionIds = this user's FULL selection after the tap ([] = remove vote)
  const handleVote = async (comment, optionIds) => {
    const me = String(currentUser?._id);
    const mine = { _id: currentUser?._id, username: currentUser?.username, profilePic: currentUser?.profilePic };
    const prevOptions = comment.poll.options;
    const apply = (opts) =>
      setComments((prev) => prev.map((c) => (c._id === comment._id ? { ...c, poll: { ...c.poll, options: opts } } : c)));

    apply(
      prevOptions.map((o) => {
        const without = (o.votes || []).filter((v) => pollVoterId(v) !== me);
        return { ...o, votes: optionIds.includes(String(o._id)) ? [...without, mine] : without };
      })
    );

    try {
      const res = await apiFetch(`${API}/auth/comment-poll-vote/${postId}/${comment._id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionIds }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      apply(data.options);
    } catch (err) {
      console.log(err);
      apply(prevOptions); // roll back
    }
  };

  const handlePin = async (comment) => {
    try {
      const res = await apiFetch(`${API}/auth/comment-pin/${postId}/${comment._id}`, { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        Alert.alert("Couldn't pin comment", data.message || "Please try again.");
        return;
      }
      setComments((prev) =>
        prev.map((c) => (c._id === comment._id ? { ...c, isPinned: data.isPinned, pinnedAt: data.pinnedAt } : c))
      );
    } catch (err) {
      console.log(err);
    }
  };

  const myId = currentUser?._id?.toString();
  // Post owner id: explicit prop if the parent passes it, otherwise the
  // `postAuthor` field the server now attaches to every comment.
  const postOwnerId = String(postAuthorId || comments?.find((c) => c.postAuthor)?.postAuthor || "");
  const isPostOwner = !!postOwnerId && postOwnerId === myId;
  const sortedComments = sortPinned(comments);

  if (creatingPoll) {
    return <CreateCommentPollForm onClose={() => setCreatingPoll(false)} onCreate={handleCreatePoll} />;
  }

  return (
    <View style={styles.wrap}>
      {!!currentUser?._id && (isPostOwner || !postOwnerId) && (
        <TouchableOpacity style={pollStyles.createBar} onPress={() => setCreatingPoll(true)}>
          <Icon name="poll" size={13} color={POLL_ACCENT} />
          <Text style={pollStyles.createBarText}>Create poll</Text>
        </TouchableOpacity>
      )}
      {comments?.length === 0 && <Text style={styles.noComments}>No comments yet. Be the first!</Text>}

      {sortedComments.map((comment) => {
        const isMyComment = myId === comment.user?._id?.toString();
        const isEditing = editingCommentId === comment._id;
        const isLiked = Array.isArray(comment.likes) && comment.likes.some((id) => id?.toString() === myId);
        const likesCount = comment.likes?.length || 0;

        return (
          <View
            key={comment._id}
            style={[{ marginBottom: 4 }, highlightStyle(comment._id)]}
            onLayout={(e) => { itemYRef.current[comment._id] = e.nativeEvent.layout.y; }}
          >
            <View style={styles.commentRow}>
              {/* ✅ shows commenter's profile pic */}
              <AvatarCircle user={comment.user} size={40} />
              <View style={styles.commentContent}>
                <View style={styles.commentBox}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentUsername}>{comment.user?.username}</Text>
                    {comment.isEdited && <Text style={styles.editedTag}>edited</Text>}
                    {comment.isPinned && (
                      <View style={pollStyles.pinnedTag}>
                        <Icon name="thumbtack" size={10} color="#1877f2" />
                        <Text style={pollStyles.pinnedTagText}>Pinned</Text>
                      </View>
                    )}
                  </View>

                  {isEditing ? (
                    <>
                      <TextInput
                        style={styles.editInput}
                        value={editingCommentText}
                        onChangeText={setEditingCommentText}
                        onSubmitEditing={() => handleEditSubmit(comment._id)}
                        autoFocus
                      />
                      <View style={styles.editActions}>
                        <TouchableOpacity style={styles.saveBtn} onPress={() => handleEditSubmit(comment._id)}>
                          <Text style={styles.saveBtnText}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingCommentId(null)}>
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    comment.poll ? (
                    <CommentPollBody
                      poll={comment.poll}
                      myId={myId}
                      onVote={(ids) => handleVote(comment, ids)}
                    />
                  ) : (
                    <Text style={styles.commentText}>{comment.text}</Text>
                  )
                  )}

                  <View style={styles.actionsRow}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleLike(comment._id)}>
                      <Icon name="heart" solid={isLiked} size={13} color={isLiked ? "#e0245e" : "#555"} />
                    </TouchableOpacity>
                    {likesCount > 0 && <Text style={styles.likeCount}>{likesCount}</Text>}

                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => {
                        setReplyingToId(
                          replyingToId === comment._id && replyingToReplyId === null ? null : comment._id
                        );
                        setReplyingToReplyId(null);
                        setReplyText("");
                      }}
                    >
                      <Icon name="reply" size={13} color="#555" />
                    </TouchableOpacity>

                    {isPostOwner && (
                      <TouchableOpacity
                        style={[styles.iconBtn, comment.isPinned && { backgroundColor: "#e7f0fe" }]}
                        onPress={() => handlePin(comment)}
                      >
                        <Icon name="thumbtack" solid={!!comment.isPinned} size={13} color={comment.isPinned ? "#1877f2" : "#555"} />
                      </TouchableOpacity>
                    )}

                    {isMyComment && !comment.poll && (
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => {
                          setEditingCommentId(comment._id);
                          setEditingCommentText(comment.text);
                        }}
                      >
                        <Icon name="edit" size={13} color="#555" />
                      </TouchableOpacity>
                    )}
                    {isMyComment && (
                      <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(comment._id)}>
                        <Icon name="trash" size={13} color="#e53935" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* ✅ reply input shows current user's pic */}
                {replyingToId === comment._id && replyingToReplyId === null && (
                  <View style={styles.replyInputRow}>
                    <AvatarCircle user={currentUser} size={28} />
                    <TextInput
                      style={styles.replyInput}
                      placeholder={`Reply to ${comment.user?.username}...`}
                      value={replyText}
                      onChangeText={setReplyText}
                      onSubmitEditing={() => handleReplySubmit(comment._id)}
                      autoFocus
                    />
                    <TouchableOpacity onPress={() => handleReplySubmit(comment._id)} disabled={!replyText.trim()}>
                      <Text style={styles.postLink}>Post</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {comment.replies?.length > 0 && (
                  <View style={styles.repliesWrap}>
                    {comment.replies.map((reply) => {
                      const isMyReply = myId === reply.user?._id?.toString();
                      const isReplyLiked = Array.isArray(reply.likes) && reply.likes.some((id) => id?.toString() === myId);
                      const replyLikesCount = reply.likes?.length || 0;
                      const isEditingReply = editingReply.commentId === comment._id && editingReply.replyId === reply._id;
                      const isReplyingToReply = replyingToId === comment._id && replyingToReplyId === reply._id;

                      return (
                        <View key={reply._id} style={highlightStyle(reply._id)}>
                          <View style={styles.replyRow}>
                            {/* ✅ shows replier's profile pic */}
                            <AvatarCircle user={reply.user} size={30} />
                            <View style={styles.replyBox}>
                              <Text style={styles.replyUsername}>
                                {reply.user?.username}
                                {reply.isEdited && <Text style={styles.editedTag}> · edited</Text>}
                              </Text>

                              {isEditingReply ? (
                                <>
                                  <TextInput
                                    style={styles.editInput}
                                    value={editingReply.text}
                                    onChangeText={(t) => setEditingReply((p) => ({ ...p, text: t }))}
                                    onSubmitEditing={() => handleReplyEditSubmit(comment._id, reply._id)}
                                    autoFocus
                                  />
                                  <View style={styles.editActions}>
                                    <TouchableOpacity
                                      style={styles.saveBtn}
                                      onPress={() => handleReplyEditSubmit(comment._id, reply._id)}
                                    >
                                      <Text style={styles.saveBtnText}>Save</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={styles.cancelBtn}
                                      onPress={() => setEditingReply({ commentId: null, replyId: null, text: "" })}
                                    >
                                      <Text style={styles.cancelBtnText}>Cancel</Text>
                                    </TouchableOpacity>
                                  </View>
                                </>
                              ) : (
                                <Text style={styles.replyText}>{reply.text}</Text>
                              )}

                              <View style={styles.actionsRow}>
                                <TouchableOpacity style={styles.iconBtn} onPress={() => handleReplyLike(comment._id, reply._id)}>
                                  <Icon name="heart" solid={isReplyLiked} size={13} color={isReplyLiked ? "#e0245e" : "#555"} />
                                </TouchableOpacity>
                                {replyLikesCount > 0 && <Text style={styles.likeCount}>{replyLikesCount}</Text>}

                                <TouchableOpacity
                                  style={styles.iconBtn}
                                  onPress={() => {
                                    setReplyingToId(comment._id);
                                    setReplyingToReplyId(isReplyingToReply ? null : reply._id);
                                    setReplyText(isReplyingToReply ? "" : `@${reply.user?.username} `);
                                  }}
                                >
                                  <Icon name="reply" size={13} color="#555" />
                                </TouchableOpacity>

                                {isMyReply && (
                                  <TouchableOpacity
                                    style={styles.iconBtn}
                                    onPress={() =>
                                      setEditingReply({ commentId: comment._id, replyId: reply._id, text: reply.text })
                                    }
                                  >
                                    <Icon name="edit" size={13} color="#555" />
                                  </TouchableOpacity>
                                )}
                                {isMyReply && (
                                  <TouchableOpacity
                                    style={styles.iconBtn}
                                    onPress={() => handleReplyDelete(comment._id, reply._id)}
                                  >
                                    <Icon name="trash" size={13} color="#e53935" />
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          </View>

                          {/* ✅ nested reply input also shows current user's pic */}
                          {isReplyingToReply && (
                            <View style={[styles.replyInputRow, { paddingLeft: 38 }]}>
                              <AvatarCircle user={currentUser} size={28} />
                              <TextInput
                                style={styles.replyInput}
                                placeholder={`Reply to ${reply.user?.username}...`}
                                value={replyText}
                                onChangeText={setReplyText}
                                onSubmitEditing={() => handleReplySubmit(comment._id)}
                                autoFocus
                              />
                              <TouchableOpacity onPress={() => handleReplySubmit(comment._id)} disabled={!replyText.trim()}>
                                <Text style={styles.postLink}>Post</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
};

export default CommentSection;

const styles = StyleSheet.create({
  wrap: { width: "100%", gap: 16, paddingVertical: 10 },
  noComments: { textAlign: "center", color: "#bbb", fontSize: 14, paddingVertical: 28 },
  highlighted: { backgroundColor: "#fff6d9", borderRadius: 10 },

  avatar: { overflow: "hidden", borderWidth: 2, borderColor: "#ddd" },
  avatarFallback: { backgroundColor: "#1877f2", alignItems: "center", justifyContent: "center" },

  commentRow: { flexDirection: "row", gap: 10 },
  commentContent: { flex: 1 },
  commentBox: {
    backgroundColor: "#fff",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    elevation: 2,
  },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  commentUsername: { fontSize: 14, fontWeight: "600" },
  editedTag: { fontSize: 11, color: "#bbb", marginLeft: 4 },
  commentText: { marginTop: 5, fontSize: 14, color: "#333", lineHeight: 20 },

  actionsRow: { flexDirection: "row", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#f1f1f1",
    alignItems: "center",
    justifyContent: "center",
  },
  likeCount: { fontSize: 12, color: "#888" },

  replyInputRow: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center", paddingLeft: 40 },
  replyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    fontSize: 13,
  },
  postLink: { color: "#1877f2", fontWeight: "700", fontSize: 13 },

  repliesWrap: {
    marginLeft: 18,
    marginTop: 10,
    borderLeftWidth: 2,
    borderLeftColor: "#f0f0f0",
    paddingLeft: 10,
    gap: 8,
  },
  replyRow: { flexDirection: "row", gap: 8 },
  replyBox: { backgroundColor: "#f7f7f7", padding: 10, borderRadius: 12, flex: 1 },
  replyUsername: { fontSize: 13, fontWeight: "600", marginBottom: 3 },
  replyText: { fontSize: 13, color: "#333" },

  editInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    fontSize: 13,
    marginTop: 5,
  },
  editActions: { flexDirection: "row", gap: 7, marginTop: 5 },
  saveBtn: { paddingHorizontal: 13, paddingVertical: 4, borderRadius: 8, backgroundColor: "#1877f2" },
  saveBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  cancelBtn: { paddingHorizontal: 13, paddingVertical: 4, borderRadius: 8, backgroundColor: "#f0f0f0" },
  cancelBtnText: { color: "#333", fontSize: 12 },
});

const pollStyles = StyleSheet.create({
  createBar: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: "#e7f0fe" },
  createBarText: { color: "#1877f2", fontWeight: "700", fontSize: 13 },
  pinnedTag: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#e7f0fe", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  pinnedTagText: { fontSize: 10.5, fontWeight: "700", color: "#1877f2" },
  question: { fontSize: 14.5, fontWeight: "700", color: "#111", lineHeight: 20 },
  hint: { fontSize: 12, color: "#888", marginTop: 2, marginBottom: 10 },
  optRow: { marginBottom: 10 },
  optTop: { flexDirection: "row", alignItems: "center" },
  circle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 10 },
  optText: { flex: 1, fontSize: 14, color: "#222" },
  optCount: { fontSize: 12, fontWeight: "700", color: "#222", marginLeft: 8 },
  track: { height: 5, borderRadius: 3, marginTop: 5, marginLeft: 30, overflow: "hidden", backgroundColor: "#ececec" },
  bar: { height: 5, borderRadius: 3, backgroundColor: "#1877f2" },
  viewVotes: { alignItems: "center", paddingTop: 6, paddingBottom: 2, borderTopWidth: 1, borderTopColor: "#f0f0f0", marginTop: 2 },
  viewVotesText: { fontSize: 13, fontWeight: "700", color: "#1877f2" },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: "#111" },
  votersBox: { marginTop: 8, borderRadius: 10, overflow: "hidden", backgroundColor: "#fafafa" },
  formWrap: { paddingHorizontal: 16, paddingBottom: 16 },
  formHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  voterOptHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#f0f0f0" },
  voterOptTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111" },
  voterOptCount: { fontSize: 12, fontWeight: "600", color: "#888", marginLeft: 8 },
  voterRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, gap: 10 },
  voterName: { flex: 1, fontSize: 14, color: "#111", fontWeight: "500" },
  noVotes: { paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: "#aaa", fontStyle: "italic" },
  label: { fontSize: 12, fontWeight: "700", color: "#aaa", textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: "#f2f2f2", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: "#111" },
  sendBtn: { backgroundColor: "#1877f2", borderRadius: 24, paddingVertical: 13, alignItems: "center" },
});