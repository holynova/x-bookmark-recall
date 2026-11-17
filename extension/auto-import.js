const RecallAutoImport = (() => {
  const TICK_MS = 420;
  const END_MS = 6000;
  const STALL_MS = 25000;
  const MAX_BATCH = 150;

  function number(value, maximum) {
    if (value === '' || value == null) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new Error('请输入有效的正整数，或留空表示不限。');
    }
    return parsed;
  }

  function optionsFrom(value) {
    return {
      limit: number(value?.limit, Number.MAX_SAFE_INTEGER),
      years: number(value?.years, 100)
    };
  }

  function cutoffAt(years, now) {
    if (!years) return null;
    const date = new Date(now);
    const month = date.getMonth();
    date.setFullYear(date.getFullYear() - years);
    if (date.getMonth() !== month) date.setDate(0);
    return date.getTime();
  }

  function summary(state) {
    return '新增 ' + state.added + ' 条 · 重复 ' + state.duplicate + ' 条' +
      (state.filtered ? ' · 按年限跳过 ' + state.filtered + ' 条' : '');
  }

  function description(state) {
    const label = {
      running: '正在自动导入',
      stopping: '正在保存后停止',
      complete: '已到书签页底部',
      limit: '已达到本次条数上限',
      stalled: 'X 暂未加载更多书签，可重试',
      stopped: '已停止自动导入',
      interrupted: '已离开书签页，自动导入结束',
      error: '自动导入中断'
    }[state.status];
    return label + ' · ' + summary(state) + (state.error ? ' · ' + state.error : '');
  }

  function create({ read, scrollToTop, scrollBy, save, valid, onChange,
    now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    let job;

    function update(status, error = '') {
      job.status = status;
      job.error = error;
      onChange(snapshot());
    }

    function snapshot() {
      if (!job) return null;
      const { owner, status, error, added, duplicate, filtered, options } = job;
      return { owner, status, error, added, duplicate, filtered, options };
    }

    async function run() {
      const cutoff = cutoffAt(job.options.years, now());
      const seen = new Set();
      const queue = [];
      let matched = 0;
      let lastSave = now();
      let lastProgress = now();
      let stableBottomSince = null;
      let previousScroll;

      async function flush(all = false) {
        if (!queue.length || (!all && queue.length < 24 && now() - lastSave < 3600)) return;
        do {
          const result = await save(queue.splice(0, MAX_BATCH), job.owner);
          job.added += result.added;
          job.duplicate += result.duplicate;
          onChange(snapshot());
        } while (queue.length >= MAX_BATCH || (all && queue.length));
        lastSave = now();
      }

      try {
        scrollToTop();
        await wait(TICK_MS);
        while (valid(job.owner)) {
          if (job.status === 'stopping') {
            await flush(true);
            update('stopped');
            return;
          }

          const page = read();
          for (const post of page.posts) {
            if (seen.has(post.id)) continue;
            seen.add(post.id);
            if (cutoff !== null && (!Number.isFinite(post.publishedAt) || post.publishedAt < cutoff)) {
              job.filtered += 1;
              continue;
            }
            queue.push(post);
            matched += 1;
            if (matched === job.options.limit) break;
          }

          if (matched === job.options.limit) {
            await flush(true);
            update(job.status === 'stopping' ? 'stopped' : 'limit');
            return;
          }

          const progress = { y: page.y, height: page.height, seen: seen.size };
          const changed = !previousScroll || previousScroll.seen !== progress.seen ||
            previousScroll.height !== progress.height || Math.abs(previousScroll.y - progress.y) >= 2;
          if (changed) lastProgress = now();
          previousScroll = progress;
          const bottom = page.height > 0 && page.height - page.viewport - page.y <= 3;
          const endCandidate = bottom && !page.loading && (seen.size > 0 || page.empty);
          if (!endCandidate || changed) stableBottomSince = null;
          if (endCandidate) stableBottomSince ??= now();

          const reachedEnd = stableBottomSince !== null && now() - stableBottomSince >= END_MS;
          if (reachedEnd || page.retry || now() - lastProgress >= STALL_MS) {
            await flush(true);
            update(job.status === 'stopping' ? 'stopped' : reachedEnd ? 'complete' : 'stalled');
            return;
          }

          await flush();
          if (!valid(job.owner)) break;
          if (changed) onChange(snapshot());
          if (!bottom && job.status === 'running') scrollBy(Math.max(1, Math.floor(page.viewport * 0.72)));
          await wait(TICK_MS);
        }
        update('interrupted');
      } catch (error) {
        if (valid(job.owner)) update('error', error.message);
        else update('interrupted');
      }
    }

    function busy() {
      return job?.status === 'running' || job?.status === 'stopping';
    }

    function start(owner, options) {
      if (busy()) throw new Error('当前书签页正在自动导入。');
      job = { owner, status: 'running', error: '', added: 0, duplicate: 0, filtered: 0, options: optionsFrom(options) };
      onChange(snapshot());
      run();
    }

    function stop() {
      if (job?.status === 'running') update('stopping');
    }

    return { busy, snapshot, start, stop };
  }

  return { create, description, optionsFrom };
})();
