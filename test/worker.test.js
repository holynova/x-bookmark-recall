import assert from 'node:assert/strict';
import { test } from 'node:test';

function mockArea() {
  const values = new Map();
  return {
    async get(key) {
      return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {};
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value));
    },
    async remove(key) { values.delete(key); }
  };
}

let handle;
let closeTab;
const local = mockArea();
const session = mockArea();
globalThis.chrome = {
  storage: { local, session },
  runtime: {
    getURL: path => 'chrome-extension://test/' + path,
    onMessage: { addListener(listener) { handle = listener; } }
  },
  tabs: { onRemoved: { addListener(listener) { closeTab = listener; } } }
};
await import('../extension/worker.js');

const site = (path, tab = 1) => ({ url: 'https://x.com' + path, frameId: 0, tab: { id: tab } });
const popup = { url: 'chrome-extension://test/popup.html' };
function send(sender, type, fields = {}) {
  return new Promise(resolve => {
    const listening = handle({ target: 'recall-worker', type, ...fields }, sender, resolve);
    if (!listening) resolve(undefined);
  });
}
function entries(...ids) {
  return ids.map(id => ({ id: String(id), handle: 'author', text: 'Test ' + id }));
}

test('worker gates imports, serializes concurrent updates, and isolates accounts', async () => {
  const owner = 'local_tester';
  const invalid = await send(site('/i/history/likes'), 'import', { owner, path: '/i/history/likes', posts: entries(1) });
  assert.match(invalid.error, /书签页/);
  const fromPopup = await send(popup, 'import', { owner, posts: entries(1) });
  assert.equal(fromPopup, undefined);

  const [first, second] = await Promise.all([
    send(site('/home'), 'import', { owner, path: '/i/history', posts: entries(1, 2, 3) }),
    send(site('/i/bookmarks', 2), 'import', { owner, path: '/i/bookmarks', posts: entries(3, 4) })
  ]);
  assert.deepEqual([first.added, second.added, second.duplicate, second.total], [3, 1, 1, 4]);
  const other = await send(popup, 'summary', { owner: 'different_user' });
  assert.equal(other.total, 0);

  const home = site('/home');
  const initial = await send(home, 'cards', { owner });
  const repeated = await send(home, 'cards', { owner });
  assert.deepEqual(initial.cards, repeated.cards);
  assert.notEqual(initial.cards.top.id, initial.cards.inline.id);

  const args = { owner, slot: 'top', id: initial.cards.top.id };
  const read = await send(home, 'read', args);
  assert.notEqual(read.cards.top.id, args.id);
  assert.equal((await send(popup, 'summary', { owner })).unread, 3);
  const undo = await send(home, 'undo', { ...args, undoAt: read.undoAt });
  assert.equal(undo.cards.top.id, args.id);
  assert.equal((await send(popup, 'summary', { owner })).unread, 4);

  await send(popup, 'settings', { patch: { inline: false } });
  const topOnly = await send(home, 'cards', { owner });
  assert.ok(topOnly.cards.top);
  assert.equal(topOnly.cards.inline, undefined);
  closeTab(1);
  await send(popup, 'summary', { owner });
  assert.deepEqual(await session.get('visit:1'), {});
});
