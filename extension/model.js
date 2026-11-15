export const defaults = { top: true, inline: true, interval: 3 };
export const emptyLibrary = () => ({ posts: [] });
export const slots = ['top', 'inline'];
const DAY = 86_400_000;
const UNDO_WINDOW = 12_000;

export function username(value) {
  return typeof value === 'string' && /^[a-z0-9_]{1,15}$/i.test(value) ? value.toLowerCase() : null;
}

export function settingsFrom(value) {
  return {
    top: typeof value?.top === 'boolean' ? value.top : defaults.top,
    inline: typeof value?.inline === 'boolean' ? value.inline : defaults.inline,
    interval: [2, 3, 5].includes(value?.interval) ? value.interval : defaults.interval
  };
}

function imageUrl(value, directory) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://pbs.twimg.com' && !url.username && !url.password && url.pathname.startsWith(directory)) {
      url.hash = '';
      return url.href;
    }
  } catch {}
  return '';
}

export function normalizePost(value) {
  const id = value?.id;
  const handle = username(value?.handle);
  if (typeof id !== 'string' || !/^\d{1,22}$/.test(id) || !handle) return null;
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, 6000) : '';
  const photo = imageUrl(value.photo, '/media/');
  const hasMedia = value.hasMedia === true;
  return {
    id, handle, text, photo, hasMedia,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 120) : '@' + handle,
    avatar: imageUrl(value.avatar, '/profile_images/'),
    publishedAt: Number.isFinite(value.publishedAt) && value.publishedAt > 0 && value.publishedAt <= 8.64e15
      ? value.publishedAt : null
  };
}

export function mergePosts(library, rows, now) {
  const seen = new Set();
  const stored = new Map(library.posts.map(post => [post.id, post]));
  let added = 0;
  let duplicate = 0;
  let updated = 0;
  for (const row of rows) {
    const post = normalizePost(row);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    const existing = stored.get(post.id);
    if (!existing) {
      stored.set(post.id, { ...post, importedAt: now, shownAt: 0, skippedAt: 0, readAt: 0 });
      added += 1;
      continue;
    }
    duplicate += 1;
    const patch = { ...post, text: post.text.length >= existing.text.length ? post.text : existing.text };
    patch.photo ||= existing.photo;
    patch.avatar ||= existing.avatar;
    patch.hasMedia ||= existing.hasMedia;
    patch.publishedAt ||= existing.publishedAt;
    if (Object.keys(patch).some(key => existing[key] !== patch[key])) {
      Object.assign(existing, patch);
      updated += 1;
    }
  }
  library.posts = [...stored.values()];
  return { added, duplicate, updated };
}

export function summarize(library) {
  const total = library.posts.length;
  return { total, unread: library.posts.filter(post => !post.readAt).length };
}

function candidates(posts, excludedIds, now) {
  const unread = posts.filter(post => !post.readAt && !excludedIds.has(post.id));
  const available = unread.filter(post => !post.skippedAt || now - post.skippedAt >= 3 * DAY);
  const fresh = available.filter(post => !post.shownAt || now - post.shownAt >= 7 * DAY);
  const pool = fresh.length ? fresh : available.length ? available : unread;
  if (!pool.length) return [];
  if (fresh.length) {
    return pool.sort((a, b) => (a.publishedAt || a.importedAt) - (b.publishedAt || b.importedAt))
      .slice(0, Math.max(1, Math.ceil(pool.length / 2)));
  }
  return pool.sort((a, b) => a.shownAt - b.shownAt).slice(0, Math.min(3, pool.length));
}

export function selectCards(library, selection, settings, now, random = Math.random, except = null) {
  const chosen = new Set(except ? [except] : []);
  const posts = new Map(library.posts.map(post => [post.id, post]));
  const cards = {};
  for (const slot of slots) {
    const post = posts.get(selection[slot]);
    if (!settings[slot] || !post || post.readAt || chosen.has(post.id)) {
      delete selection[slot];
      continue;
    }
    chosen.add(post.id);
    cards[slot] = post;
  }
  let changed = false;
  for (const slot of slots) {
    if (!settings[slot] || cards[slot]) continue;
    const pool = candidates(library.posts, chosen, now);
    if (!pool.length) continue;
    const post = pool[Math.floor(random() * pool.length)];
    post.shownAt = now;
    changed = true;
    chosen.add(post.id);
    selection[slot] = post.id;
    cards[slot] = post;
  }
  return { cards, changed };
}

export function changeCard(library, selection, slot, action, id, now, undoAt) {
  if (!slots.includes(slot)) return false;
  const post = library.posts.find(item => item.id === id);
  if (!post) return false;
  if (action === 'undo') {
    if (!post.readAt || post.readAt !== undoAt || now - undoAt > UNDO_WINDOW) return false;
    post.readAt = 0;
    selection[slot] = post.id;
    return true;
  }
  if (selection[slot] !== id || post.readAt) return false;
  if (action === 'read') post.readAt = now;
  else if (action === 'next') {
    if (library.posts.every(item => item.readAt || item.id === id || item.id === selection[slots.find(key => key !== slot)])) return false;
    post.skippedAt = now;
  } else return false;
  delete selection[slot];
  return true;
}
