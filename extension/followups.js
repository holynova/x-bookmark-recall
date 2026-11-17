import { changeCard } from './model.js';

const DAY = 86_400_000;

export function followupBudget(candidateCount) {
  if (candidateCount <= 0) return 0;
  if (candidateCount <= 5) return 1;
  if (candidateCount <= 20) return 2;
  return 3;
}

function candidates(library, visit, now) {
  const assigned = new Set([...Object.values(visit.selection), ...visit.followups.entries.map(entry => entry.postId)]);
  return library.posts.filter(post => !assigned.has(post.id) && !post.readAt &&
    (!post.shownAt || now - post.shownAt >= 7 * DAY) &&
    (!post.skippedAt || now - post.skippedAt >= 3 * DAY));
}

export function pickOlder(posts, random = Math.random) {
  if (posts.length < 2) return posts[0];
  const ordered = [...posts].sort((a, b) => (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity));
  const middle = Math.ceil(ordered.length / 2);
  const group = random() < 0.7 ? ordered.slice(0, middle) : ordered.slice(middle);
  return group[Math.floor(random() * group.length)];
}

function remaining(followups) {
  return (followups.budget ?? 3) - followups.entries.filter(entry => entry.counted).length;
}

function expose(entry, post, now) {
  if (entry.exposedId === post.id) return false;
  entry.exposedId = post.id;
  entry.counted = true;
  post.shownAt = now;
  return true;
}

function pruneUnseen(followups) {
  if (remaining(followups) <= 0) {
    followups.entries = followups.entries.filter(entry => entry.counted);
  }
}

export function updateFollowups(library, visit, message, now, random = Math.random) {
  const { type, channel, anchor } = message;
  if (typeof anchor !== 'string' || !/^\d{1,22}$/.test(anchor)) return { action: false };
  const followups = visit.followups;
  const entry = followups.entries.find(item => item.channel === channel && item.anchor === anchor);
  if (type === 'followup-pick') {
    if (entry || remaining(followups) <= 0) return { action: !!entry };
    const pool = candidates(library, visit, now);
    const post = pickOlder(pool, random);
    if (!post) return { action: false };
    followups.budget ??= followupBudget(pool.length);
    followups.entries.push({ channel, anchor, postId: post.id, counted: false });
    return { action: true };
  }

  if (!entry || entry.postId !== message.id) return { action: false };
  const post = library.posts.find(item => item.id === entry.postId);
  if (!post) return { action: false };
  if (type === 'followup-undo') {
    const action = changeCard(library, {}, 'inline', 'undo', post.id, now, message.undoAt);
    return { action, changed: action };
  }
  if (post.readAt || (!entry.counted && remaining(followups) <= 0)) return { action: false };
  if (type === 'followup-seen') {
    const changed = expose(entry, post, now);
    pruneUnseen(followups);
    return { action: true, changed };
  }
  if (type === 'followup-read') {
    expose(entry, post, now);
    pruneUnseen(followups);
    post.readAt = now;
    return { action: true, changed: true, undoAt: now };
  }
  if (type === 'followup-next') {
    const changed = expose(entry, post, now);
    pruneUnseen(followups);
    const next = pickOlder(candidates(library, visit, now), random);
    if (!next) return { action: false, changed };
    post.skippedAt = now;
    entry.postId = next.id;
    return { action: true, changed: true };
  }
  return { action: false };
}

export function followupsFor(library, visit, channel, now) {
  const posts = new Map(library.posts.map(post => [post.id, post]));
  const entries = visit.followups.entries.flatMap(entry => {
    const post = posts.get(entry.postId);
    return entry.channel === channel && post && !post.readAt
      ? [{ anchor: entry.anchor, post, seen: entry.exposedId === post.id }]
      : [];
  });
  const canInsert = remaining(visit.followups) > 0 && candidates(library, visit, now).length > 0;
  return { entries, canInsert };
}
