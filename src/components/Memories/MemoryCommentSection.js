import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, Alert, StyleSheet } from "react-native";
import Icon from "react-native-vector-icons/FontAwesome5";
import { apiFetch, getCachedUser } from "../../api/authToken"; 
import Config from "react-native-config";
import socket from "../../sockets/Sockets";

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

// ── MemoryCommentSection — same behavior as CommentSection.jsx (post
// comments): like, reply, edit, delete on both comments and replies, all
// live via scoped sockets. Only difference is the API base
// (`/memories/items/:itemId/...`) and the socket room
// (`memoryItem:{itemId}:...` instead of `post:{postId}:...`).
// ← NEW — same highlight-on-open behavior as CommentSection.js, for
// memory-item comment/reply notifications.
const HIGHLIGHT_MS = 2200;

const MemoryCommentSection = ({ comments, setComments, currentUser, itemId, disableComments, highlightCommentId = null, highlightReplyId = null, scrollRef = null }) => {
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyingToReplyId, setReplyingToReplyId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [editingReply, setEditingReply] = useState({ commentId: null, replyId: null, text: "" });
  const [newComment, setNewComment] = useState("");
  const [activeHighlight, setActiveHighlight] = useState(highlightReplyId || highlightCommentId || null);
  const itemYRef = React.useRef({});

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

  // ── scoped socket listeners ──────────────────────────────────────────────
  useEffect(() => {
    if (!itemId) return;

    const onNewComment = ({ comment }) => {
      setComments((prev) => (prev.some((c) => c._id === comment._id) ? prev : [...prev, comment]));
    };

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

    socket.on(`memoryItem:${itemId}:newComment`, onNewComment);
    socket.on(`memoryItem:${itemId}:commentEdited`, onCommentEdited);
    socket.on(`memoryItem:${itemId}:commentDeleted`, onCommentDeleted);
    socket.on(`memoryItem:${itemId}:commentLiked`, onCommentLiked);
    socket.on(`memoryItem:${itemId}:newReply`, onNewReply);
    socket.on(`memoryItem:${itemId}:replyEdited`, onReplyEdited);
    socket.on(`memoryItem:${itemId}:replyDeleted`, onReplyDeleted);
    socket.on(`memoryItem:${itemId}:replyLiked`, onReplyLiked);

    return () => {
      socket.off(`memoryItem:${itemId}:newComment`, onNewComment);
      socket.off(`memoryItem:${itemId}:commentEdited`, onCommentEdited);
      socket.off(`memoryItem:${itemId}:commentDeleted`, onCommentDeleted);
      socket.off(`memoryItem:${itemId}:commentLiked`, onCommentLiked);
      socket.off(`memoryItem:${itemId}:newReply`, onNewReply);
      socket.off(`memoryItem:${itemId}:replyEdited`, onReplyEdited);
      socket.off(`memoryItem:${itemId}:replyDeleted`, onReplyDeleted);
      socket.off(`memoryItem:${itemId}:replyLiked`, onReplyLiked);
    };
  }, [itemId, currentUser?._id]);

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    try {
      const res = await apiFetch(`${API}/memories/items/${itemId}/comments`, {
        method: "POST",
       
        body: JSON.stringify({ text: newComment }),
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) => (prev.some((c) => c._id === data.comment._id) ? prev : [...prev, data.comment]));
        setNewComment("");
      }
    } catch (err) {
      console.log(err);
    }
  };

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
      await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}/like`, {
        method: "PUT",
        
      });
    } catch (err) {
      console.log(err);
    }
  };

  const handleReplySubmit = async (commentId) => {
    if (!replyText.trim()) return;
    try {
      // ← NEW — same fix as post comments' CommentSection.js: tells the
      // backend which reply (if any) you tapped "reply" on, so it can
      // notify that person instead of always the top-level commenter.
      const res = await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}/replies`, {
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
      const res = await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}`, {
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
      const res = await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}`, {
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
      await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}/replies/${replyId}/like`, {
        method: "PUT",
        
      });
    } catch (err) {
      console.log(err);
    }
  };

  const handleReplyEditSubmit = async (commentId, replyId) => {
    if (!editingReply.text.trim()) return;
    try {
      const res = await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}/replies/${replyId}`, {
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
      const res = await apiFetch(`${API}/memories/items/${itemId}/comments/${commentId}/replies/${replyId}`, {
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

  const myId = currentUser?._id?.toString();

  return (
    <View style={styles.wrap}>
      {comments?.length === 0 && (
        <Text style={styles.noComments}>
          {disableComments ? "Comments are turned off" : "No comments yet. Be the first!"}
        </Text>
      )}

      {comments?.map((comment) => {
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
              <AvatarCircle user={comment.user} size={40} />
              <View style={styles.commentContent}>
                <View style={styles.commentBox}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentUsername}>{comment.user?.username}</Text>
                    {comment.isEdited && <Text style={styles.editedTag}>edited</Text>}
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
                    <Text style={styles.commentText}>{comment.text}</Text>
                  )}

                  <View style={styles.actionsRow}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleLike(comment._id)}>
                      <Icon name="heart" solid={isLiked} size={13} color={isLiked ? "#e0245e" : "#555"} />
                    </TouchableOpacity>
                    {likesCount > 0 && <Text style={styles.likeCount}>{likesCount}</Text>}

                    {!disableComments && (
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
                    )}

                    {isMyComment && (
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

                                {!disableComments && (
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
                                )}

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

      {!disableComments && (
        <View style={styles.newCommentRow}>
          <AvatarCircle user={currentUser} size={30} />
          <TextInput
            style={styles.newCommentInput}
            placeholder="Add a comment..."
            value={newComment}
            onChangeText={setNewComment}
            onSubmitEditing={handlePostComment}
          />
          <TouchableOpacity style={styles.saveBtn} disabled={!newComment.trim()} onPress={handlePostComment}>
            <Text style={styles.saveBtnText}>Post</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default MemoryCommentSection;

const styles = StyleSheet.create({
  wrap: { width: "100%", gap: 16 },
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

  newCommentRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  newCommentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e2e2",
    backgroundColor: "#f7f7f7",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 13.5,
  },
});