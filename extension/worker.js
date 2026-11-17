import { changeCard, emptyLibrary, mergePosts, selectCards, settingsFrom, showsInChannel, summarize, username } from './model.js';
import { followupsFor, updateFollowups } from './followups.js';

let pending = Promise.resolve();
const local = chrome.storage.local;
const session = chrome.storage.session;
const extensionOrigin = chrome.runtime.getURL('');
const popupTypes = new Set(['settings', 'summary']);
const followupTypes = new Set(['followup-pick', 'followup-seen', 'followup-next', 'followup-read', 'followup-undo']);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'recall-worker') return;
  const location = sender.url || '';
  const fromPopup = location === extensionOrigin + 'popup.html';
  const fromX = sender.frameId === 0 && location.startsWith('https://x.com/');
  if (popupTypes.has(message.type) ? !fromPopup : !fromX) return;

  const request = pending.then(() => handleMessage(message, sender));
  pending = request.catch(() => {});
  request.then(reply, error => {
    console.warn('[X 书签回看]', error.message);
    reply({ error: '无法更新扩展数据，请重试。' });
  });
  return true;
});

async function handleMessage(message, sender) {
  const settings = settingsFrom((await local.get('settings')).settings);
  if (message.type === 'settings') {
    const updated = settingsFrom({ ...settings, ...message.patch });
    await local.set({ settings: updated });
    return { settings: updated };
  }

  const owner = username(message.owner);
  if (message.type === 'summary' && !owner) return { settings, total: 0, unread: 0 };
  if (!owner) return { error: '暂时无法识别当前 X 账号。' };
  const libraryKey = 'library:' + owner;
  const library = (await local.get(libraryKey))[libraryKey] ?? emptyLibrary();

  if (message.type === 'summary') return { settings, ...summarize(library) };
  if (message.type === 'import') {
    // Chrome can report the original document URL after a same-document navigation.
    const path = typeof message.path === 'string' ? message.path.replace(/\/$/, '') : '';
    if (path !== '/i/bookmarks' && path !== '/i/history') return { error: '请打开 X 的书签页。' };
    const rows = Array.isArray(message.posts) ? message.posts.slice(0, 150) : [];
    const result = mergePosts(library, rows, Date.now());
    if (result.added || result.updated) await local.set({ [libraryKey]: library });
    return { ...result, ...summarize(library) };
  }

  const tabId = sender.tab?.id;
  if (tabId == null) return { error: '找不到当前 X 标签页。' };
  const visitKey = 'visit:' + tabId;
  const visit = (await session.get(visitKey))[visitKey];
  if (message.type === 'leave') {
    if (visit?.owner === owner) await session.remove(visitKey);
    return {};
  }
  const isFollowup = followupTypes.has(message.type);
  if (!isFollowup && !['cards', 'next', 'read', 'undo'].includes(message.type)) return { error: '未知操作。' };
  if (!showsInChannel(settings, message.channel)) return { cards: {}, settings, action: false };

  const state = visit?.owner === owner ? visit : { owner, selection: {} };
  const before = JSON.stringify(state);
  const selection = state.selection;
  state.followups ??= { entries: [] };
  const now = Date.now();
  const reserved = () => state.followups.entries.map(entry => entry.postId);
  const result = isFollowup
    ? (settings.inline ? updateFollowups(library, state, message, now) : { action: false })
    : { action: message.type !== 'cards' &&
      changeCard(library, selection, message.slot, message.type, message.id, now, message.undoAt, reserved()) };
  const { cards, changed } = selectCards(library, selection, settings, now, Math.random,
    result.action && message.type === 'next' ? message.id : null, reserved());
  if (changed || result.changed || (!isFollowup && result.action)) await local.set({ [libraryKey]: library });
  if (before !== JSON.stringify(state)) await session.set({ [visitKey]: state });
  return {
    cards, settings,
    followups: settings.inline ? followupsFor(library, state, message.channel, now) : null,
    action: result.action,
    undoAt: result.undoAt ?? (result.action && message.type === 'read' ? now : null)
  };
}

chrome.tabs.onRemoved.addListener(tabId => {
  const cleanup = pending.then(() => session.remove('visit:' + tabId));
  pending = cleanup.catch(() => {});
});
