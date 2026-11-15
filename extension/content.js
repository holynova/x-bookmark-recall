(() => {
  let owner;
  let recommended = false;
  let cards = {};
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
  let notice;
  let noticeTimer;
  let collecting;
  let importTail = Promise.resolve();
  let lastRoute;
  let disposed = false;
  const actionBusy = new Set();

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

  function setCards(result) {
    if (placementInterval !== result.settings.interval) anchorId = undefined;
    placementInterval = result.settings.interval;
    cards = result.cards;
    settings = result.settings;
    schedule();
  }

  function refresh() {
    if (!owner || !recommended) return;
    const request = ++revision;
    send('cards').then(result => {
      if (request === revision) setCards(result);
    }).catch(() => {});
  }

  function deferRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 90);
  }

  async function cardAction(type, slot, id, undoAt) {
    if (actionBusy.has(slot) || !recommended || !owner) return;
    const account = owner;
    actionBusy.add(slot);
    const request = ++revision;
    try {
      const result = await send(type, { slot, id, undoAt }, account);
      if (account !== owner || !recommended) return;
      if (request === revision) setCards(result);
      if (!result.action) {
        notify(type === 'next' ? '暂时没有其他待读书签' : '这条回看状态已更新');
      } else if (type === 'read') {
        notify('已标为已读', () => cardAction('undo', slot, id, result.undoAt));
      } else if (type === 'undo') {
        notify('已撤销');
      }
    } catch (error) {
      if (account === owner && recommended) notify(error.message);
    } finally {
      actionBusy.delete(slot);
    }
  }

  function mount(slot, parent, before) {
    const post = cards[slot];
    if (!parent || !post || !settings[slot]) {
      remove(slot);
      return;
    }
    let card = mounts.get(slot);
    const focusAction = card?.contains(document.activeElement) &&
      document.activeElement.getAttribute('data-action');
    if (card?.dataset.xbrPost !== post.id) {
      remove(slot);
      card = RecallCard.card(post, slot, {
        next: (name, id) => cardAction('next', name, id),
        read: (name, id) => cardAction('read', name, id)
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
  }

  function place() {
    const feed = RecallX.feed();
    if (!feed) {
      remove('top');
      remove('inline');
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
    mount('inline', anchor?.cell.firstElementChild, null);
  }

  function importPosts(posts, account) {
    const task = importTail.then(async () => {
      if (RecallX.route() !== 'bookmarks' || RecallX.account() !== account) {
        throw new Error('请在当前账号的 X 书签页导入。');
      }
      return send('import', { posts, path: location.pathname }, account);
    });
    importTail = task.catch(() => {});
    return task;
  }

  function scanCollection() {
    if (!collecting || collecting.busy) return;
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
    return {
      owner: account,
      route,
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
      clearNotice();
      return;
    }
    const route = RecallX.route();
    const account = RecallX.account();
    const isRecommended = !!account && RecallX.recommended();
    if (recommended !== isRecommended || account !== owner) {
      if (recommended && (route !== 'home' || account !== owner)) send('leave', {}, owner).catch(() => {});
      revision += 1;
      if (account !== owner || !isRecommended) clearNotice();
      cards = {};
      resetFeed();
      owner = account;
      recommended = isRecommended;
      if (isRecommended) refresh();
    }
    if (route !== 'bookmarks' || (collecting && collecting.owner !== account)) collecting = undefined;
    if (lastRoute === 'bookmarks' && route !== lastRoute) clearNotice();
    lastRoute = route;
    if (recommended) place();
    else {
      remove('top');
      remove('inline');
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
    if (!['import', 'toggle-collection'].includes(message.type)) return;
    if (!active.owner || active.route !== 'bookmarks') {
      reply({ error: '请在已登录的 X 书签页操作。' });
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
