import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { followupBudget, followupsFor, pickOlder, updateFollowups } from '../extension/followups.js';

const now = 2_000_000_000_000;
const day = 86_400_000;
const scrollSource = readFileSync(new URL('../extension/scroll-recall.js', import.meta.url), 'utf8');
const scroll = vm.runInNewContext(scrollSource + '\nRecallScroll;');

function fixture(count) {
  const library = { posts: Array.from({ length: count }, (_, i) => ({
    id: String(i + 1), publishedAt: now - (count - i) * day, shownAt: 0, readAt: 0, skippedAt: 0
  })) };
  const visit = { selection: {}, followups: { entries: [] } };
  function request(type, channel, anchor, fields = {}) {
    return updateFollowups(library, visit, { type: 'followup-' + type, channel, anchor, ...fields },
      now + (fields.elapsed || 0), () => 0);
  }
  return { library, visit, request };
}

test('budget adapts to eligible collection size, and age weighting leaves newer posts a chance', () => {
  assert.deepEqual([0, 1, 5, 6, 20, 21, 500].map(followupBudget), [0, 1, 1, 2, 2, 3, 3]);
  const posts = [{ id: 'b', publishedAt: 400 }, { id: 'a', publishedAt: 200 }, { id: 'c', publishedAt: null }];
  assert.equal(pickOlder(posts, () => 0).id, 'a');
  assert.equal(pickOlder(posts, () => 0.9).id, 'c');
});

test('unseen placements keep their original post and spend no shared budget until exposed', () => {
  const { library, visit, request } = fixture(5);
  visit.selection = { top: '1', inline: '2' };
  library.posts[2].shownAt = now - 2 * day;
  library.posts[3].skippedAt = now - day;
  assert.equal(request('pick', 'recommended', '100').action, true);
  assert.equal(request('pick', 'recommended', '100').action, true);
  assert.equal(request('pick', 'following', '101').action, false);
  assert.equal(visit.followups.entries.length, 1);
  const [entry] = followupsFor(library, visit, 'recommended', now).entries;
  assert.equal(entry.post.id, '5');
  assert.equal(entry.seen, false);
  assert.equal(entry.post.shownAt, 0);
  assert.equal(request('seen', 'following', '100', { id: '5' }).action, false);
  assert.equal(request('seen', 'recommended', '100', { id: '5' }).changed, true);
  assert.equal(request('seen', 'recommended', '100', { id: '5' }).changed, false);
  library.posts[2].shownAt = 0;
  assert.equal(request('pick', 'following', '101').action, false);
  assert.equal(followupsFor(library, visit, 'recommended', now).entries[0].post.id, '5');
});

test('both channels can reserve before the first view, but only the shared count survives', () => {
  const { library, visit, request } = fixture(4);
  request('pick', 'recommended', '100');
  request('pick', 'following', '101');
  assert.equal(visit.followups.entries.length, 2);
  request('seen', 'following', '101', { id: '2' });
  assert.equal(library.posts[0].shownAt, 0);
  assert.equal(library.posts[1].shownAt, now);
  assert.equal(visit.followups.entries.length, 1);
  assert.equal(request('pick', 'recommended', '100').action, false);
});

test('swap, read and undo preserve one counted placement', () => {
  const { library, visit, request } = fixture(10);
  request('pick', 'recommended', '100');
  assert.equal(request('next', 'recommended', '100', { id: '1' }).action, true);
  assert.equal(library.posts[0].skippedAt, now);
  assert.equal(library.posts[1].shownAt, 0);
  const read = request('read', 'recommended', '100', { id: '2' });
  assert.equal(read.undoAt, now);
  assert.equal(followupsFor(library, visit, 'recommended', now).entries.length, 0);
  assert.equal(request('undo', 'recommended', '100', { id: '2', undoAt: now, elapsed: 100 }).action, true);
  assert.equal(followupsFor(library, visit, 'recommended', now).entries[0].post.id, '2');
  assert.equal(visit.followups.entries.filter(entry => entry.counted).length, 1);
});

test('scroll placement requires native posts and three additional screens, ignores backscroll and duplicate IDs', () => {
  const tracker = scroll.create(() => 0);
  const frame = (y, ids, firstCardEnd = null, lastCardEnd = null) => ({
    y, viewport: 600, firstCardEnd, lastCardEnd,
    nativePosts: ids.map(id => ({ id: String(id), top: 80, bottom: 420 }))
  });
  assert.equal(scroll.advance(tracker, frame(0, [1, 2], 500)), null);
  assert.equal(scroll.advance(tracker, frame(700, [4, 5, 6], 500)), null);
  assert.equal(scroll.advance(tracker, frame(1100, [6, 7, 8, 9], 500)), null);
  assert.equal(scroll.advance(tracker, frame(1900, [10, 11, 12], 500)), null);
  assert.equal(scroll.advance(tracker, frame(1000, [20, 21], 500)), null);
  assert.equal(scroll.advance(tracker, frame(2300, [13], 500)), '13');
  scroll.inserted(tracker, '13', 2300, () => 0.99);
  assert.equal(tracker.target, 15);
  assert.equal(scroll.advance(tracker, frame(3500, [14, 15], null, 4000)), null);
  assert.equal(scroll.advance(tracker, frame(5950, [14, 15, 16, 17], null, 4000)), null);
});
