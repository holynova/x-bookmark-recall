(() => {
  let owner;
  let channel = null;
  let cards = {};
  let followups;
  let settings = {};
  let revision = 0;
  let refreshTimer;
  let scheduled = false;
  let feedList;
  let startedAtTop = false;
  let anchorId;
  let placementInterval;
  const feedEntries = new Map();
  const mounts = new Map();
  const trackers = new Map();
  const visibility = new Map();
  let picking = false;
  let notice;
  let noticeTimer;
  let collecting;
  let autoNotice;
  let importTail = Promise.resolve();
  let lastRoute;
  let disposed = false;
  const actionBusy = new Set();
  const followupPrefix = 'followup:';
  const autoImport = RecallAutoImport.create({
    read: RecallX.bookmarkPage,
    scrollToTop: () => window.scrollTo({ top: 0, behavior: 'instant' }),
    scrollBy: pixels => window.scrollBy({ top: pixels, behavior: 'instant' }),
    save: importPosts,
    valid: isBookmarkOwner,
    onChange: showAutoStatus
  });

  function send(type, fields = {}, account = owner) {
    return chrome.runtime.sendMessage({ target: 'recall-worker', type, owner: account, ...fields })
      .then(response => {
        if (!response || response.error) throw new Error(response?.error || '扩展没有响应。');
        return response;
      });
  }

  function remove(slot) {
    mounts.get(slot)?.remove();
    mounts.delete(slot);
    visibility.delete(slot);
  }

  function resetFeed() {
    feedList = undefined;
    startedAtTop = false;
    anchorId = undefined;
    feedEntries.clear();
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    notice?.remove();
    notice = undefined;
  }

  function notify(text, undo) {
    clearNotice();
    notice = RecallCard.toast(text, undo);
    notice.classList.toggle('xbr-dark', RecallX.dark());
    document.body.append(notice);
    noticeTimer = setTimeout(clearNotice, undo ? 11_500 : 3500);
  }

  function showAutoStatus(progress) {
    if (!autoImport.busy()) {
      autoNotice?.remove();
      autoNotice = undefined;
      if (isBookmarkOwner(progress.owner)) notify(RecallAutoImport.description(progress));
      return;
    }
    const text = RecallAutoImport.description(progress);
    if (!autoNotice?.isConnected) {
      clearNotice();
      autoNotice = RecallCard.toast(text, autoImport.stop, '停止');
      autoNotice.classList.toggle('xbr-dark', RecallX.dark());
      document.body.append(autoNotice);
    }
    const label = autoNotice.querySelector('span');
    if (label.textContent !== text) label.textContent = text;
    autoNotice.querySelector('button').disabled = progress.status === 'stopping';
  }

  function setCards(result) {
    if (placementInterval !== result.settings.interval) anchorId = undefined;
    placementInterval = result.settings.interval;
    cards = result.cards;
    followups = result.followups;
    settings = result.settings;
    schedule();
  }

  function refresh() {
    if (!owner || !channel) return;
    const request = ++revision;
    send('cards', { channel }).then(result => {
      if (request === revision) setCards(result);
    }).catch(() => {});
  }

  function deferRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 90);
  }

  async function cardAction(type, slot, id, undoAt) {
    if (actionBusy.has(slot) || !channel || !owner) return;
    const account = owner;
    const actionChannel = channel;
    actionBusy.add(slot);
    const request = ++revision;
    try {
      const result = await send(type, { slot, id, undoAt, channel: actionChannel }, account);
      if (account !== owner || actionChannel !== channel) return;
      if (request === revision) setCards(result);
      if (!result.action) {
        notify(type === 'next' ? '暂时没有其他待读书签' : '这条回看状态已更新');
      } else if (type === 'read') {
        notify('已标为已读', () => cardAction('undo', slot, id, result.undoAt));
      } else if (type === 'undo') {
        notify('已撤销');
      }
    } catch (error) {
      if (account === owner && actionChannel === channel) notify(error.message);
    } finally {
      actionBusy.delete(slot);
    }
  }

  function mount(slot, parent, before, post = cards[slot]) {
    const extra = slot.startsWith(followupPrefix);
    const anchor = extra ? slot.slice(followupPrefix.length) : null;
    if (!parent || !post || !(extra ? settings.inline : settings[slot])) {
      remove(slot);
      return;
    }
    let card = mounts.get(slot);
    const focusAction = card?.contains(document.activeElement) &&
      document.activeElement.getAttribute('data-action');
    if (card?.dataset.xbrPost !== post.id) {
      remove(slot);
      card = RecallCard.card(post, extra ? 'followup' : slot, {
        next: (_, id) => extra ? followupAction('next', anchor, id) : cardAction('next', slot, id),
        read: (_, id) => extra ? followupAction('read', anchor, id) : cardAction('read', slot, id)
      });
      mounts.set(slot, card);
    }
    card.classList.toggle('xbr-dark', RecallX.dark());
    if (card.parentNode !== parent || (before && card.nextSibling !== before)) {
      parent.insertBefore(card, before || null);
    }
    if (focusAction && document.activeElement === document.body) {
      card.querySelector('[data-action="' + focusAction + '"]')?.focus({ preventScroll: true });
    }
    return card;
  }

  async function sendFollowup(type, anchor, id, undoAt) {
    const account = owner;
    const currentChannel = channel;
    const request = ++revision;
    const result = await send('followup-' + type, { channel: currentChannel, anchor, id, undoAt });
    if (account !== owner || currentChannel !== channel) return null;
    if (request === revision) setCards(result);
    return result;
  }

  async function followupAction(type, anchor, id, undoAt) {
    if (!owner || !channel || actionBusy.has(anchor)) return;
    actionBusy.add(anchor);
    try {
      const result = await sendFollowup(type, anchor, id, undoAt);
      if (!result) return;
      if (!result.action) {
        notify(type === 'next' ? '暂时没有其他待读书签' : '这条回看状态已更新');
      } else if (type === 'read') {
        notify('已标为已读', () => followupAction('undo', anchor, id, result.undoAt));
      } else if (type === 'undo') {
        notify('已撤销');
      }
    } catch (error) {
      notify(error.message);
    } finally {
      actionBusy.delete(anchor);
    }
  }

  function observeFollowup(slot, card, entry, viewport) {
    const rect = card.getBoundingClientRect();
    const visibleHeight = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
    if (entry.seen || document.hidden || !rect.height || visibleHeight < Math.min(96, rect.height / 2)) {
      visibility.delete(slot);
      return;
    }
    let exposure = visibility.get(slot);
    if (exposure?.id !== entry.post.id) {
      exposure = { id: entry.post.id, since: performance.now(), pending: false };
      visibility.set(slot, exposure);
      setTimeout(schedule, 650);
      return;
    }
    if (exposure.pending || performance.now() - exposure.since < 650) return;
    exposure.pending = true;
    sendFollowup('seen', entry.anchor, entry.post.id).catch(() => {}).finally(() => {
      exposure.pending = false;
    });
  }

  function removeFollowups(keep = new Set()) {
    for (const slot of mounts.keys()) {
      if (slot.startsWith(followupPrefix) && !keep.has(slot)) remove(slot);
    }
  }

  function placeFollowups(feed, firstCard) {
    if (!followups || !settings.inline) {
      removeFollowups();
      return;
    }
    let tracker = trackers.get(channel);
    if (!tracker) {
      tracker = RecallScroll.create();
      trackers.set(channel, tracker);
    }
    const viewport = window.innerHeight;
    const y = window.scrollY;
    const entries = new Map(feed.entries.map(entry => [entry.id, entry]));
    const kept = new Set();
    let lastCardEnd = null;
    for (const entry of followups.entries) {
      const slot = followupPrefix + entry.anchor;
      const card = mount(slot, entries.get(entry.anchor)?.cell.firstElementChild, null, entry.post);
      if (!card) continue;
      kept.add(slot);
      if (tracker.lastAnchor === entry.anchor) lastCardEnd = card.getBoundingClientRect().bottom + y;
      observeFollowup(slot, card, entry, viewport);
    }
    removeFollowups(kept);
    if (!followups.canInsert || picking || document.hidden) return;

    const existing = new Set(followups.entries.map(entry => entry.anchor));
    const nativePosts = feed.entries.flatMap(entry => {
      if (!entry.id || !entry.article) return [];
      const { top, bottom } = entry.article.getBoundingClientRect();
      return [{ id: entry.id, top, bottom, anchored: entry.id === anchorId || existing.has(entry.id) }];
    });
    const candidate = RecallScroll.advance(tracker, {
      y, viewport, nativePosts, lastCardEnd,
      firstCardEnd: firstCard ? firstCard.getBoundingClientRect().bottom + y : null
    });
    if (!candidate) return;
    picking = true;
    sendFollowup('pick', candidate).then(result => {
      if (result?.action) RecallScroll.inserted(tracker, candidate, y);
    }).catch(() => {}).finally(() => {
      picking = false;
      schedule();
    });
  }

  function place() {
    const feed = RecallX.feed();
    if (!feed) {
      remove('top');
      remove('inline');
      removeFollowups();
      return;
    }
    if (feedList !== feed.list) {
      resetFeed();
      feedList = feed.list;
    }
    if (feed.entries.some(entry => entry.offset < 2)) startedAtTop = true;
    if (startedAtTop && !anchorId) {
      for (const { id, offset } of feed.entries) {
        if (id) feedEntries.set(id, offset);
      }
      anchorId = [...feedEntries.entries()].sort((a, b) => a[1] - b[1])[placementInterval - 1]?.[0];
    }
    mount('top', feed.region.parentElement, feed.region);
    const anchor = feed.entries.find(entry => entry.id && entry.id === anchorId);
    const firstCard = mount('inline', anchor?.cell.firstElementChild, null);
    placeFollowups(feed, firstCard);
  }

  function isBookmarkOwner(account) {
    return !!chrome.runtime?.id && RecallX.route() === 'bookmarks' && RecallX.account() === account;
  }

  function importPosts(posts, account) {
    const task = importTail.then(async () => {
      if (!isBookmarkOwner(account)) {
        throw new Error('请在当前账号的 X 书签页导入。');
      }
      return send('import', { posts, path: location.pathname }, account);
    });
    importTail = task.catch(() => {});
    return task;
  }

  function scanCollection() {
    if (!collecting || collecting.busy || autoImport.busy()) return;
    const collection = collecting;
    const fresh = RecallX.visibleBookmarks().filter(post => !collection.seen.has(post.id));
    if (!fresh.length) return;
    fresh.sort((a, b) => a.publishedAt - b.publishedAt);
    collection.busy = true;
    importPosts(fresh.slice(0, 150), collection.owner).then(result => {
      for (const post of fresh.slice(0, 150)) collection.seen.add(post.id);
      collection.added += result.added;
      collection.duplicate += result.duplicate;
    }).catch(error => {
      collection.error = error.message;
      if (collecting === collection) notify('连续导入已停止。' + error.message);
    }).finally(() => {
      collection.busy = false;
      if (collecting === collection && !collection.error) schedule();
    });
  }

  function context() {
    const route = RecallX.route();
    const account = RecallX.account();
    const active = collecting && collecting.owner === account && route === 'bookmarks';
    const auto = autoImport.snapshot();
    return {
      owner: account,
      route,
      auto: route === 'bookmarks' && auto?.owner === account
        ? { ...auto, text: RecallAutoImport.description(auto) } : null,
      collection: active ? {
        added: collecting.added, duplicate: collecting.duplicate, error: collecting.error
      } : null
    };
  }

  function reconcile() {
    if (disposed) return;
    if (!chrome.runtime?.id) {
      disposed = true;
      observer.disconnect();
      clearInterval(routeTimer);
      remove('top');
      remove('inline');
      removeFollowups();
      clearNotice();
      autoNotice?.remove();
      return;
    }
    const route = RecallX.route();
    const account = RecallX.account();
    const nextChannel = account ? RecallX.homeChannel() : null;
    if (owner && ((lastRoute === 'home' && route !== 'home') || account !== owner)) {
      send('leave', {}, owner).catch(() => {});
      trackers.clear();
    }
    if (channel !== nextChannel || account !== owner) {
      revision += 1;
      clearNotice();
      removeFollowups();
      cards = {};
      followups = undefined;
      resetFeed();
      owner = account;
      channel = nextChannel;
      if (channel) refresh();
    }
    if (route !== 'bookmarks' || (collecting && collecting.owner !== account)) collecting = undefined;
    if (lastRoute === 'bookmarks' && route !== lastRoute) clearNotice();
    lastRoute = route;
    if (channel) place();
    else {
      remove('top');
      remove('inline');
      removeFollowups();
    }
    if (route === 'bookmarks' && !collecting?.error) scanCollection();
  }

  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      reconcile();
    }, 70);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['aria-selected', 'href'] });
  const routeTimer = setInterval(schedule, 800);
  window.addEventListener('popstate', schedule);
  window.addEventListener('scroll', () => {
    if (channel && settings.inline) schedule();
  }, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  for (const eventName of ['wheel', 'touchmove']) {
    window.addEventListener(eventName, event => {
      if (event.isTrusted && !event.ctrlKey) autoImport.stop();
    }, { passive: true });
  }
  window.addEventListener('keydown', event => {
    if (event.isTrusted && /^(Arrow(Up|Down)|Page(Up|Down)|Home|End)$/.test(event.key) &&
      !event.target.closest?.('input, textarea, [contenteditable="true"]')) autoImport.stop();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes['library:' + owner])) deferRefresh();
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'recall-tab') return;
    const active = context();
    if (message.type === 'context') {
      reply(active);
      return;
    }
    if (!['import', 'toggle-collection', 'start-auto', 'stop-auto'].includes(message.type)) return;
    if (!active.owner || active.route !== 'bookmarks') {
      reply({ error: '请在已登录的 X 书签页操作。' });
      return;
    }
    if (message.type === 'stop-auto') {
      autoImport.stop();
      reply(context());
      return;
    }
    if (autoImport.busy()) {
      reply({ error: '请先停止当前的自动导入。' });
      return;
    }
    if (message.type === 'start-auto') {
      try {
        autoImport.start(active.owner, message.options);
        collecting = undefined;
        reply(context());
      } catch (error) {
        reply({ error: error.message });
      }
      return;
    }
    if (message.type === 'toggle-collection') {
      if (collecting && !collecting.error) collecting = undefined;
      else collecting = { owner: active.owner, seen: new Set(), added: 0, duplicate: 0, busy: false, error: '' };
      if (collecting) scanCollection();
      reply(context());
      return;
    }
    const posts = RecallX.visibleBookmarks();
    if (!posts.length) {
      reply({ error: '没有识别到已加载的书签。请等页面加载，或先滚动加载书签。' });
      return;
    }
    importPosts(posts, active.owner).then(reply, error => reply({ error: error.message }));
    return true;
  });

  schedule();
})();
