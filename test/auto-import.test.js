import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/auto-import.js', import.meta.url), 'utf8');
const importer = vm.runInNewContext(source + '\nRecallAutoImport;');
const today = Date.parse('2026-11-17T12:00:00');
const post = (id, date = '2026-06-01') => ({ id, publishedAt: Date.parse(date + 'T12:00:00') });

function fixture(pages, options = {}, overrides = {}) {
  let time = today;
  let index = pages.length - 1;
  let valid = true;
  let reset = 0;
  const saved = [];
  const positions = [];
  const statuses = [];
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const ctl = importer.create({
    now: () => time,
    wait: async ms => { time += ms; },
    read: () => ({
      posts: pages[index],
      y: index * 500, height: (pages.length - 1) * 500 + 700, viewport: 700,
      loading: !!overrides.loading, empty: !!overrides.empty
    }),
    scrollToTop: () => { index = 0; reset += 1; },
    scrollBy: pixels => {
      positions.push(pixels);
      index = Math.min(index + 1, pages.length - 1);
      if (overrides.stop) ctl.stop();
      if (overrides.navigate) valid = false;
    },
    save: async rows => {
      saved.push(...Array.from(rows, p => p.id));
      const duplicate = rows.filter(row => overrides.duplicate?.includes(row.id)).length;
      return { added: rows.length - duplicate, duplicate };
    },
    valid: () => valid,
    onChange: snapshot => {
      statuses.push(snapshot.status);
      if (!['running', 'stopping'].includes(snapshot.status)) done(snapshot);
    }
  });
  ctl.start('viewer', options);
  return { finished, saved, positions, statuses, reset: () => reset };
}

test('automatic import starts at the top and traverses a virtual list to the end with overlap', async () => {
  const scene = fixture([[post('1'), post('2')], [post('2'), post('3')], [post('3'), post('4')]],
    {}, { duplicate: ['2'] });
  const result = await scene.finished;
  assert.equal(scene.reset(), 1);
  assert.equal(result.status, 'complete');
  assert.deepEqual(scene.saved, ['1', '2', '3', '4']);
  assert.deepEqual(scene.positions, [504, 504]);
  assert.equal(result.added, 3);
  assert.equal(result.duplicate, 1);
});

test('age filtering keeps scanning after older or undated posts and respects the combined limit', async () => {
  const scene = fixture([[post('old', '2023-01-01'), { id: 'missing' }, post('1')],
    [post('1'), post('2', '2025-11-17'), post('3')]], { years: 1, limit: 2 });
  const result = await scene.finished;
  assert.equal(result.status, 'limit');
  assert.equal(result.filtered, 2);
  assert.deepEqual(scene.saved, ['1', '2']);
});

test('manual stop saves the loaded batch without scrolling further', async () => {
  const scene = fixture([[post('1')], [post('2')]], {}, { stop: true });
  assert.equal((await scene.finished).status, 'stopped');
  assert.deepEqual(scene.saved, ['1']);
  assert.ok(scene.statuses.includes('stopping'));
});

test('navigation prevents further imports, and a stuck loader cannot report completion', async () => {
  const interrupted = fixture([[post('1')], [post('2')]], {}, { navigate: true });
  assert.equal((await interrupted.finished).status, 'interrupted');
  assert.deepEqual(interrupted.saved, []);
  const stalled = fixture([[post('1')]], {}, { loading: true });
  assert.equal((await stalled.finished).status, 'stalled');
  assert.deepEqual(stalled.saved, ['1']);
});

test('blank limits are unrestricted and out-of-range limits are rejected', () => {
  assert.equal(importer.optionsFrom({ limit: '', years: '' }).limit, null);
  assert.equal(importer.optionsFrom({ limit: '30', years: '2' }).years, 2);
  assert.throws(() => importer.optionsFrom({ limit: 0 }), /正整数/);
  assert.throws(() => importer.optionsFrom({ years: 101 }), /正整数/);
});
