// Keeps story comments/likes in sync between FeedStoryPreview (opened by
// clicking a post author's avatar in the home feed) and the full
// StoryViewer (opened from the top StoriesBar) — so an action taken in
// one shows up immediately in the other, and reopening either one after
// closing it still shows the same history instead of resetting to empty.
//
// No RN-specific changes needed — plain JS (two Maps, closures,
// callbacks), no DOM/browser APIs. Copied over verbatim from the web
// version.

const stateByStory = new Map();
const listenersByStory = new Map();

function ensure(storyId) {
  if (!stateByStory.has(storyId)) {
    stateByStory.set(storyId, {
      comments: [],
      likesCount: 0,
      liked: false,
      viewsCount: 0,
      commentsFetched: false,
    });
  }
  return stateByStory.get(storyId);
}

export function getStoryRuntime(storyId) {
  return ensure(storyId);
}

export function subscribeStory(storyId, cb) {
  if (!storyId) return () => {};
  if (!listenersByStory.has(storyId)) listenersByStory.set(storyId, new Set());
  listenersByStory.get(storyId).add(cb);
  return () => listenersByStory.get(storyId)?.delete(cb);
}

function notify(storyId) {
  listenersByStory.get(storyId)?.forEach((cb) => cb(ensure(storyId)));
}

export function pushComment(storyId, comment) {
  if (!storyId) return;
  const s = ensure(storyId);
  s.comments = [...s.comments.slice(-99), comment];
  notify(storyId);
}

export function setRuntimeComments(storyId, comments) {
  if (!storyId) return;
  const s = ensure(storyId);
  s.comments = comments;
  s.commentsFetched = true;
  notify(storyId);
}

export function setLikeState(storyId, { likesCount, liked } = {}) {
  if (!storyId) return;
  const s = ensure(storyId);
  if (likesCount !== undefined) s.likesCount = likesCount;
  if (liked !== undefined) s.liked = liked;
  notify(storyId);
}

export function setRuntimeViews(storyId, viewsCount) {
  if (!storyId) return;
  const s = ensure(storyId);
  s.viewsCount = viewsCount;
  notify(storyId);
}

// Call when a story is deleted / expired so memory doesn't grow forever.
export function clearStoryRuntime(storyId) {
  if (!storyId) return;
  stateByStory.delete(storyId);
  listenersByStory.delete(storyId);
}