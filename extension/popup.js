const one = id => document.getElementById(id);
const controls = { top: one('top'), inline: one('inline'), interval: one('interval'), channel: one('channel') };
const primary = one('import');
const collect = one('collect');
const autoForm = one('auto-form');
const autoStart = one('auto-start');
const autoStatus = one('auto-status');
const autoLimit = one('auto-limit');
const autoYears = one('auto-years');
const feedback = one('feedback');
const tabChoice = one('tab-choice');
const tabSelect = one('x-tab');
let currentTab;
let activePage;
let locked = false;
let generation = 0;
let selectedTabId;
let renderedTabs = '';
let shownJob;

function worker(type, options) {
  return chrome.runtime.sendMessage({ target: 'recall-worker', type, ...options })
    .then(unwrap);
}

function unwrap(response) {
  if (!response || response.error) throw new Error(response?.error || '扩展无法连接到当前页面。');
  return response;
}

function sendTab(type, tab = currentTab, data = {}) {
  if (!tab?.id) return Promise.reject(new Error('请先打开 X。'));
  return chrome.tabs.sendMessage(tab.id, { target: 'recall-tab', type, ...data }, { frameId: 0 })
    .catch(() => { throw new Error('请刷新 X 页面，然后再打开扩展。'); })
    .then(unwrap);
}

function message(text = '', isError = false) {
  feedback.hidden = !text;
  feedback.textContent = text;
  feedback.dataset.error = String(isError);
}

function updateSettings(settings) {
  controls.top.checked = settings.top;
  controls.inline.checked = settings.inline;
  controls.interval.value = settings.interval;
  controls.channel.value = settings.channel;
  controls.interval.disabled = !settings.inline;
}

async function locateTab() {
  const [inWindow, inFocusedWindow] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  const nearby = [...new Map([...inWindow, ...inFocusedWindow].map(tab => [tab.id, tab])).values()];
  for (const tab of nearby) {
    const page = await sendTab('context', tab).catch(() => null);
    if (page) return { tab, page, alternatives: [] };
  }

  // A browser with a separate toolbar window may report a non-X tab as active.
  const nearbyIds = new Set(nearby.map(tab => tab.id));
  const tabs = (await chrome.tabs.query({})).filter(tab => tab.id != null && !nearbyIds.has(tab.id));
  const alternatives = (await Promise.all(tabs.map(async tab => {
    const page = await sendTab('context', tab).catch(() => null);
    return page?.owner ? { tab, page } : null;
  }))).filter(Boolean);
  const choice = alternatives.find(item => item.tab.id === selectedTabId) ??
    (alternatives.length === 1 ? alternatives[0] : null);
  return { ...choice, alternatives };
}

function renderTabChoices(alternatives, selected) {
  tabChoice.hidden = alternatives.length < 2;
  if (tabChoice.hidden) return;
  const options = alternatives.map(({ tab, page }) => {
    const route = { home: '首页', bookmarks: '书签', other: '其他页面' }[page.route];
    return new Option('X ' + route + ' · @' + page.owner, tab.id);
  });
  const signature = options.map(option => option.value + ':' + option.text).join('|');
  if (signature !== renderedTabs) {
    tabSelect.replaceChildren(new Option('请选择', ''), ...options);
    renderedTabs = signature;
  }
  tabSelect.value = selected?.id ?? '';
}

function renderContext(summary) {
  one('counts').textContent = activePage?.owner
    ? '已导入 ' + summary.total + ' 条 · ' + summary.unread + ' 条待读'
    : '打开已登录的 X 页面查看书签数';
  const atBookmarks = activePage?.route === 'bookmarks';
  const onX = !!activePage;
  primary.textContent = atBookmarks ? '导入已加载书签' : '打开 X 书签页';
  one('import-info').textContent = atBookmarks
    ? '自动从页面顶部开始。留空不限，年限按发帖时间筛选。'
    : onX ? '打开 X 书签页后，可以导入页面已加载的帖子。'
      : tabChoice.hidden ? '请先打开已登录的 X，然后从书签页导入。' : '请选择要使用的 X 标签页。';
  collect.hidden = !atBookmarks;
  autoForm.hidden = !atBookmarks;
  primary.classList.toggle('secondary', atBookmarks);
  const auto = activePage?.auto;
  if (auto && !shownJob) {
    autoLimit.value = auto.options.limit ?? '';
    autoYears.value = auto.options.years ?? '';
  }
  shownJob = auto;
  const running = auto?.status === 'running';
  const stopping = auto?.status === 'stopping';
  primary.disabled = locked || running || stopping;
  collect.disabled = primary.disabled;
  autoLimit.disabled = primary.disabled;
  autoYears.disabled = primary.disabled;
  autoStart.disabled = locked || stopping;
  autoStart.textContent = running ? '停止自动导入' : stopping ? '正在停止…' : '自动滚动导入';
  autoStatus.hidden = !auto;
  if (auto) {
    autoStatus.textContent = auto.text;
    autoStatus.dataset.error = String(['error', 'stalled'].includes(auto.status));
  }
  collect.textContent = activePage?.collection && !activePage.collection.error
    ? '停止连续导入' : '滚动时继续收集';
  const collection = one('collection');
  collection.hidden = !activePage?.collection;
  if (activePage?.collection) {
    const { added, duplicate, error } = activePage.collection;
    collection.textContent = error || '连续导入中 · 新增 ' + added + ' 条 · 重复 ' + duplicate + ' 条';
    collection.dataset.error = String(!!error);
  }
}

async function refresh() {
  if (locked) return;
  const request = ++generation;
  try {
    const { tab, page, alternatives } = await locateTab();
    const summary = await worker('summary', { owner: page?.owner });
    if (request !== generation || locked) return;
    currentTab = tab;
    activePage = page;
    renderTabChoices(alternatives, tab);
    updateSettings(summary.settings);
    renderContext(summary);
  } catch (error) {
    if (request === generation) message(error.message, true);
  }
}

function setBusy(busy) {
  locked = busy;
  primary.disabled = busy;
  collect.disabled = busy;
  autoStart.disabled = busy;
  if (busy) ++generation;
}

primary.addEventListener('click', async () => {
  if (locked) return;
  setBusy(true);
  message();
  try {
    if (activePage?.route === 'bookmarks') {
      primary.textContent = '正在导入…';
      const result = await sendTab('import');
      message('新增 ' + result.added + ' 条 · 跳过 ' + result.duplicate + ' 条重复');
    } else {
      if (activePage && currentTab?.id) await chrome.tabs.update(currentTab.id, { url: 'https://x.com/i/bookmarks' });
      else await chrome.tabs.create({ url: 'https://x.com/i/bookmarks' });
      window.close();
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
    refresh();
  }
});

collect.addEventListener('click', async () => {
  if (locked) return;
  const stopping = activePage?.collection && !activePage.collection.error;
  setBusy(true);
  message();
  try {
    await sendTab('toggle-collection');
    message(stopping ? '已停止连续导入。' : '现在可以关闭弹窗并向下滚动。');
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
    refresh();
  }
});

autoForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (locked || !autoForm.reportValidity()) return;
  const running = activePage?.auto?.status === 'running';
  setBusy(true);
  message();
  try {
    await sendTab(running ? 'stop-auto' : 'start-auto', currentTab, {
      options: { limit: autoLimit.value, years: autoYears.value }
    });
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
    refresh();
  }
});

for (const [key, control] of Object.entries(controls)) {
  control.addEventListener('change', async () => {
    const value = control.type === 'checkbox' ? control.checked
      : key === 'interval' ? Number(control.value) : control.value;
    const request = ++generation;
    try {
      const response = await worker('settings', { patch: { [key]: value } });
      if (request === generation) updateSettings(response.settings);
    } catch (error) {
      message(error.message, true);
    } finally {
      if (request === generation) refresh();
    }
  });
}

tabSelect.addEventListener('change', () => {
  selectedTabId = Number(tabSelect.value) || undefined;
  message();
  refresh();
});

chrome.storage.onChanged.addListener(() => refresh());
setInterval(refresh, 1100);
refresh();
