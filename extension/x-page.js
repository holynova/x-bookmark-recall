const RecallX = (() => {
  const primarySelector = '[data-testid="primaryColumn"]';
  const tweetSelector = 'article[data-testid="tweet"]';
  const cellSelector = '[data-testid="cellInnerDiv"]';
  const recommendedLabel = /^(for you|为你推荐|为你推荐的|推荐|為你推薦|為您推薦|推薦|おすすめ)$/iu;
  const followingLabel = /^(following|正在关注|已关注|关注|正在關注|關注中|已關注|關注|フォロー中)$/iu;

  function path() {
    return location.pathname.replace(/\/$/, '');
  }

  function primary() {
    return document.querySelector(primarySelector);
  }

  function route() {
    const current = path();
    if (current === '/home') return 'home';
    if (current === '/i/bookmarks' || current === '/i/history') return 'bookmarks';
    return 'other';
  }

  function account() {
    const href = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    const handle = href?.match(/^\/([a-z0-9_]{1,15})$/i)?.[1];
    if (handle) return handle.toLowerCase();
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    for (const span of switcher?.querySelectorAll('span') ?? []) {
      const username = span.textContent.trim().match(/^@([a-z0-9_]{1,15})$/i)?.[1];
      if (username) return username.toLowerCase();
    }
    return null;
  }

  function status(href, allowDetails = false) {
    let url;
    try { url = new URL(href, location.origin); } catch { return null; }
    if (url.origin !== location.origin) return null;
    const pattern = allowDetails ? /^\/([a-z0-9_]{1,15})\/status\/(\d{1,22})(?:\/|$)/i
      : /^\/([a-z0-9_]{1,15})\/status\/(\d{1,22})\/?$/i;
    const match = url.pathname.match(pattern);
    return match ? { handle: match[1], id: match[2] } : null;
  }

  function parsePost(article) {
    const links = [...article.querySelectorAll('a[href]')];
    const stamp = links.find(link => link.querySelector('time') && status(link.href));
    const identity = stamp ? status(stamp.href) : null;
    if (!identity) return null;

    const author = article.querySelector('[data-testid="User-Name"]');
    const displayName = [...(author?.querySelectorAll('a[href]') || [])].find(link =>
      link.getAttribute('href')?.toLowerCase() === '/' + identity.handle.toLowerCase() &&
      !link.textContent.trim().startsWith('@'))?.textContent;
    const text = article.querySelector('[data-testid="tweetText"]');
    const photo = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
      .find(image => (image.currentSrc || image.src).startsWith('https://pbs.twimg.com/media/'));
    return {
      ...identity,
      name: displayName || author?.firstElementChild?.textContent || '@' + identity.handle,
      text: text?.innerText || text?.textContent || '',
      avatar: article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || '',
      photo: photo?.currentSrc || photo?.src || '',
      hasMedia: !!article.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'),
      publishedAt: Date.parse(stamp.querySelector('time').dateTime)
    };
  }

  function visibleBookmarks() {
    if (route() !== 'bookmarks') return [];
    return [...(primary()?.querySelectorAll(tweetSelector) || [])].map(parsePost).filter(Boolean);
  }

  function homeChannel() {
    if (route() !== 'home') return null;
    const selected = primary()?.querySelector('[role="tab"][aria-selected="true"]');
    const label = selected?.textContent.trim() || '';
    if (recommendedLabel.test(label)) return 'recommended';
    if (followingLabel.test(label)) return 'following';
    return null;
  }

  function bookmarkPage() {
    const column = primary();
    const scroller = document.scrollingElement;
    return {
      posts: visibleBookmarks(),
      y: scroller?.scrollTop || 0,
      height: scroller?.scrollHeight || 0,
      viewport: scroller?.clientHeight || window.innerHeight,
      loading: !!column?.querySelector('[role="progressbar"]'),
      empty: !!column?.querySelector('[data-testid="emptyState"]'),
      retry: [...(column?.querySelectorAll('button') || [])].some(button =>
        /^(retry|try again|重试|再试一次|重試|再試一次|再試行)$/iu.test(button.textContent.trim()))
    };
  }

  function feedKey(article) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')];
    const timestamp = links.find(link => link.querySelector('time') && status(link.href));
    if (timestamp) return status(timestamp.href).id;
    // Some promoted posts expose only an analytics link.
    const id = links.map(link => status(link.href, true)?.id).find(Boolean);
    return id || article.getAttribute('aria-labelledby') || article;
  }

  function feed() {
    if (!homeChannel()) return null;
    const column = primary();
    const first = column?.querySelector(tweetSelector);
    const list = first?.closest(cellSelector)?.parentElement;
    const region = list?.closest('section[role="region"], section');
    if (!region || !column.contains(region)) return null;
    const entries = [...list.children].filter(node => node.matches(cellSelector)).map(cell => {
      const article = cell.querySelector(tweetSelector);
      const transform = getComputedStyle(cell).transform;
      return {
        cell,
        article,
        id: article ? feedKey(article) : null,
        offset: cell.offsetTop + (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42)
      };
    });
    entries.sort((a, b) => a.offset - b.offset);
    return { region, list, entries };
  }

  function dark() {
    const background = getComputedStyle(document.body).backgroundColor;
    const rgb = background.match(/\d+(?:\.\d+)?/g)?.map(Number);
    return !!rgb && rgb.length >= 3 && (rgb[0] + rgb[1] + rgb[2]) / 3 < 120 && rgb[3] !== 0;
  }

  return { account, bookmarkPage, dark, feed, homeChannel, parsePost, primary, route, visibleBookmarks };
})();
