// ── Shared runtime store for Memories — same pattern as
// components/state/syncStoryStore.js, kept separate so a like/comment
// made in one open MemoryViewer/CommentsSheet/LikesSheet instantly shows
// up in any other instance looking at the same memory, without a refetch.
//
// No RN-specific changes were needed here — this file is plain JS (a Map,
// closures, callbacks), with no DOM/browser APIs to swap out. Copied over
// verbatim from the web version.

const store = new Map();

function getEntry(id) {
  if (!store.has(id)) {
    store.set(id, {
      comments: [],
      commentsFetched: false,
      likesCount: 0,
      liked: false,
      listeners: new Set(),
    });
  }
  return store.get(id);
}

function notify(id) {
  const entry = getEntry(id);
  const snapshot = { comments: entry.comments, likesCount: entry.likesCount, liked: entry.liked };
  entry.listeners.forEach((cb) => cb(snapshot));
}

export function getMemoryRuntime(id) {
  const entry = getEntry(id);
  return {
    comments: entry.comments,
    commentsFetched: entry.commentsFetched,
    likesCount: entry.likesCount,
    liked: entry.liked,
  };
}

export function subscribeMemory(id, cb) {
  const entry = getEntry(id);
  entry.listeners.add(cb);
  return () => entry.listeners.delete(cb);
}

export function setMemoryRuntimeComments(id, comments) {
  const entry = getEntry(id);
  entry.comments = comments || [];
  entry.commentsFetched = true;
  notify(id);
}

export function pushMemoryComment(id, comment) {
  const entry = getEntry(id);
  entry.comments = [...entry.comments, { ...comment, replies: comment.replies || [] }];
  notify(id);
}

export function pushMemoryReply(id, commentId, reply) {
  const entry = getEntry(id);
  entry.comments = entry.comments.map((c) =>
    (c._id?.toString() === commentId?.toString())
      ? { ...c, replies: [...(c.replies || []), reply] }
      : c
  );
  notify(id);
}

export function setMemoryLikeState(id, { likesCount, liked } = {}) {
  const entry = getEntry(id);
  if (likesCount !== undefined) entry.likesCount = likesCount;
  if (liked !== undefined) entry.liked = liked;
  notify(id);
}