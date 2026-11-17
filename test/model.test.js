import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeCard, defaults, emptyLibrary, mergePosts, normalizePost, selectCards, settingsFrom, showsInChannel, summarize } from '../extension/model.js';

const now = 1_800_000_000_000;
const day = 86_400_000;
const post = (id, options = {}) => ({
  id: String(id), handle: 'Example', name: 'Example', text: '示例收藏',
  publishedAt: now - (20 - id) * day, ...options
});
function makeLibrary(...ids) {
  const library = emptyLibrary();
  mergePosts(library, ids.map(id => post(id)), now);
  return library;
}

test('normalizes post IDs and restricts remote images to the original X image host', () => {
  assert.equal(normalizePost(post(1, { id: '1/other' })), null);
  assert.equal(normalizePost(post(1, { handle: '@user' })), null);
  const result = normalizePost(post(1, {
    photo: 'https://pbs.twimg.com/media/image?name=small#detail',
    avatar: 'https://other.invalid/profile_images/avatar'
  }));
  assert.equal(result.photo, 'https://pbs.twimg.com/media/image?name=small');
  assert.equal(result.avatar, '');
  assert.equal(result.handle, 'example');
  assert.equal(normalizePost(post(1, { publishedAt: 9e15 })).publishedAt, null);
});

test('imports each post once and preserves local read state on re-import', () => {
  const library = emptyLibrary();
  assert.deepEqual(mergePosts(library, [post(1), post(1), post(2)], now),
    { added: 2, duplicate: 0, updated: 0 });
  const bookmark = library.posts[0];
  bookmark.readAt = now + 100;
  const result = mergePosts(library, [post(1, { text: '更新后的正文。' }), post(3)], now + 200);
  assert.deepEqual(result, { added: 1, duplicate: 1, updated: 1 });
  assert.deepEqual(summarize(library), { total: 3, unread: 2 });
  assert.equal(bookmark.readAt, now + 100);
  assert.equal(bookmark.text, '更新后的正文。');
});

test('keeps a longer previously imported excerpt and a known photo', () => {
  const library = emptyLibrary();
  mergePosts(library, [post(2, { photo: 'https://pbs.twimg.com/media/test', text: '较长的原始帖子正文' })], now);
  mergePosts(library, [post(2, { text: '较短' })], now);
  assert.equal(library.posts[0].photo, 'https://pbs.twimg.com/media/test');
  assert.equal(library.posts[0].text, '较长的原始帖子正文');
});

test('picks distinct cards, favors older posts, and leaves assignments stable', () => {
  const library = makeLibrary(6, 5, 4, 3, 2, 1);
  const selection = {};
  const first = selectCards(library, selection, defaults, now, () => 0);
  assert.deepEqual(selection, { top: '1', inline: '2' });
  const second = selectCards(library, selection, defaults, now + 2000, () => 0.9);
  assert.equal(second.changed, false);
  assert.deepEqual(second.cards, first.cards);
});

test('honors placement independently and single-bookmark queues', () => {
  const library = makeLibrary(1);
  const selection = {};
  assert.deepEqual(Object.keys(selectCards(library, selection, defaults, now).cards), ['top']);
  const inline = selectCards(library, selection, { top: false, inline: true }, now);
  assert.equal(inline.cards.inline.id, '1');
  assert.equal(inline.cards.top, undefined);
  assert.equal(changeCard(library, selection, 'inline', 'next', '1', now + 50), false);
});

test('switches to a different bookmark and avoids replaying a just-skipped item', () => {
  const library = makeLibrary(1, 2, 3, 4, 5);
  const selection = {};
  selectCards(library, selection, defaults, now, () => 0);
  assert.equal(changeCard(library, selection, 'top', 'next', '1', now + 1), true);
  const newCards = selectCards(library, selection, defaults, now + 1, () => 0, '1').cards;
  assert.notEqual(newCards.top.id, '1');
  assert.equal(newCards.inline.id, '2');
});

test('mark read and undo validate the selected post and the operation timestamp', () => {
  const library = makeLibrary(1, 2, 3, 4);
  const selection = {};
  selectCards(library, selection, defaults, now, () => 0);
  assert.equal(changeCard(library, selection, 'top', 'read', '2', now + 1), false);
  assert.equal(changeCard(library, selection, 'top', 'read', '1', now + 1), true);
  assert.equal(summarize(library).unread, 3);
  selectCards(library, selection, defaults, now + 2, () => 0);
  assert.notEqual(selection.top, '1');
  assert.equal(changeCard(library, selection, 'top', 'undo', '1', now + 5, now), false);
  assert.equal(changeCard(library, selection, 'top', 'undo', '1', now + 12_002, now + 1), false);
  assert.equal(changeCard(library, selection, 'top', 'undo', '1', now + 5, now + 1), true);
  assert.equal(selection.top, '1');
  assert.equal(summarize(library).unread, 4);
});

test('chooses the least recently surfaced posts once the fresh pool is exhausted', () => {
  const library = makeLibrary(1, 2, 3, 4, 5);
  library.posts.forEach((item, index) => { item.shownAt = now - index * day; });
  const selection = {};
  selectCards(library, selection, { top: true, inline: false }, now + 1, () => 0);
  assert.equal(selection.top, '5');
});

test('ignores invalid saved settings', () => {
  assert.deepEqual(settingsFrom({ top: false, inline: null, interval: 8 }),
    { top: false, inline: true, interval: 3, channel: 'both' });
});

test('keeps every paragraph of a long imported post', () => {
  const text = '这是可见正文的一段。\n\n'.repeat(650) + '最后一段';
  const library = makeLibrary(1);
  mergePosts(library, [post(1, { text })], now + 1);
  assert.equal(library.posts[0].text, text);
});

test('existing settings default to both home channels; options can select either one', () => {
  const previous = settingsFrom({ top: false, inline: true, interval: 5 });
  assert.equal(previous.interval, 5);
  assert.equal(showsInChannel(previous, 'recommended'), true);
  assert.equal(showsInChannel(previous, 'following'), true);
  assert.equal(showsInChannel(previous, 'list'), false);
  assert.equal(showsInChannel(settingsFrom({ channel: 'following' }), 'recommended'), false);
  assert.equal(showsInChannel(settingsFrom({ channel: 'following' }), 'following'), true);
  assert.equal(showsInChannel(settingsFrom({ channel: 'recommended' }), 'following'), false);
});
