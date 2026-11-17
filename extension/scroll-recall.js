const RecallScroll = (() => {
  function gap(random) {
    return 9 + Math.floor(random() * 7);
  }

  function create(random = Math.random) {
    return {
      nativeIds: new Set(),
      count: 0,
      target: gap(random),
      start: null,
      frontier: -1,
      lastAnchor: null
    };
  }

  function advance(tracker, { y, viewport, nativePosts, lastCardEnd = null, firstCardEnd = null }) {
    if (tracker.start === null) {
      tracker.start = Math.max(y, firstCardEnd ?? y);
      tracker.frontier = y;
      return null;
    }
    const cardEnd = tracker.lastAnchor ? lastCardEnd : firstCardEnd;
    if (cardEnd !== null) tracker.start = Math.max(tracker.start, cardEnd);
    if (y <= tracker.frontier + 1) return null;
    tracker.frontier = y;
    if (y < tracker.start) return null;

    const visible = nativePosts.filter(post => post.bottom > 0 && post.top < viewport * 0.9 &&
      (!tracker.lastAnchor || post.id !== tracker.lastAnchor));
    for (const post of visible) {
      if (tracker.nativeIds.has(post.id)) continue;
      tracker.nativeIds.add(post.id);
      tracker.count += 1;
    }
    if (tracker.count < tracker.target || y - tracker.start < viewport * 3) return null;
    // Leave room to mount the card in front of the reader, below a visible native post.
    return visible.find(post => !post.anchored && typeof post.id === 'string' && /^\d{1,22}$/.test(post.id) &&
      post.bottom >= viewport * 0.55)?.id ?? null;
  }

  function inserted(tracker, anchor, y, random = Math.random) {
    tracker.lastAnchor = anchor;
    tracker.start = y;
    tracker.count = 0;
    tracker.target = gap(random);
  }

  return { create, advance, inserted };
})();
