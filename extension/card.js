const RecallCard = (() => {
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
  const symbols = {
    bookmark: 'M6 4h12v16l-6-4-6 4z',
    open: 'M13 5h6v6m0-6-9 9m8-1v6H5V6h6',
    next: 'M5 8h14m-4-4 4 4-4 4m4 4H5m4-4-4 4 4 4',
    check: 'm5 12 4 4L19 6'
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function icon(name) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', symbols[name]);
    svg.append(path);
    return svg;
  }

  function action(label, glyph, callback) {
    const button = element('button', 'xbr-action');
    button.type = 'button';
    button.dataset.action = glyph;
    button.append(icon(glyph), document.createTextNode(label));
    button.addEventListener('click', callback);
    return button;
  }

  function card(post, slot, callbacks) {
    const article = element('article', 'xbr-card');
    article.dataset.xbrSlot = slot;
    article.dataset.xbrPost = post.id;
    article.setAttribute('aria-label', '来自你的书签，' + post.name);
    article.addEventListener('click', event => event.stopPropagation());
    article.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    const label = element('div', 'xbr-origin');
    label.append(icon('bookmark'), document.createTextNode('来自你的书签'));

    const main = element('div', 'xbr-body');
    const avatar = element('span', 'xbr-avatar', Array.from(post.name)[0]);
    avatar.setAttribute('aria-hidden', 'true');
    if (post.avatar) {
      const image = element('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = post.avatar;
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.append(image);
    }
    const content = element('div', 'xbr-content');
    const author = element('div', 'xbr-author');
    author.append(element('strong', '', post.name), element('span', 'xbr-meta', '@' + post.handle));
    if (post.publishedAt) {
      const time = element('time', 'xbr-meta', dateFormat.format(post.publishedAt));
      time.dateTime = new Date(post.publishedAt).toISOString();
      author.append(element('span', 'xbr-meta', '·'), time);
    }
    content.append(author);
    const buttons = element('div', 'xbr-actions');
    const link = element('a', 'xbr-action');
    link.href = 'https://x.com/' + post.handle + '/status/' + post.id;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(icon('open'), document.createTextNode('原帖'));
    if (post.text) {
      const text = element('div', 'xbr-text', post.text);
      content.append(text);
      if (Array.from(post.text).length > 115 || post.text.split('\n').length > 3) {
        text.classList.add('xbr-clamp');
        const expand = element('button', 'xbr-action xbr-secondary', '展开');
        expand.type = 'button';
        expand.setAttribute('aria-expanded', 'false');
        expand.addEventListener('click', () => {
          const collapsed = text.classList.toggle('xbr-clamp');
          expand.textContent = collapsed ? '展开' : '收起';
          expand.setAttribute('aria-expanded', String(!collapsed));
        });
        buttons.append(expand);
      }
    } else {
      content.append(element('div', 'xbr-meta xbr-media-label', post.hasMedia ? '查看原帖中的媒体内容' : '在 X 上查看这条书签'));
    }
    if (post.photo) {
      const image = element('img', 'xbr-photo');
      image.alt = '书签中的图片预览';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = post.photo;
      image.addEventListener('error', () => image.remove(), { once: true });
      content.append(image);
    }
    buttons.append(link,
      action('换一条', 'next', () => callbacks.next(slot, post.id)),
      action('标为已读', 'check', () => callbacks.read(slot, post.id)));
    content.append(buttons);
    main.append(avatar, content);
    article.append(label, main);
    return article;
  }

  function toast(text, onUndo) {
    const container = element('div', 'xbr-toast');
    container.setAttribute('role', 'status');
    container.append(element('span', '', text));
    if (onUndo) {
      const button = element('button', '', '撤销');
      button.type = 'button';
      button.dataset.action = 'undo';
      button.addEventListener('click', onUndo);
      container.append(button);
    }
    return container;
  }

  return { card, toast };
})();
