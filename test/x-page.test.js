import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/x-page.js', import.meta.url), 'utf8');
const cellSelector = '[data-testid="cellInnerDiv"]';
const tweetSelector = 'article[data-testid="tweet"]';

function article(paths) {
  const links = paths.map(([path, stamped]) => ({
    href: 'https://x.com' + path,
    querySelector: selector => stamped && selector === 'time' ? {} : null
  }));
  return {
    querySelectorAll: () => links,
    getAttribute: () => null,
    closest: selector => selector === cellSelector ? null : undefined
  };
}

test('counts promoted posts with analytics links when positioning an inline card', () => {
  const organic = article([['/author/status/10', true], ['/author/status/20/analytics', false]]);
  const ad = article([['/brand/status/11/analytics', false]]);
  const third = article([['/author/status/12', true]]);
  const region = {};
  const list = { closest: () => region };
  list.children = [organic, ad, third].map((post, index) => {
    const cell = {
      parentElement: list,
      offsetTop: index * 100,
      matches: selector => selector === cellSelector,
      querySelector: selector => selector === tweetSelector ? post : null
    };
    post.closest = selector => selector === cellSelector ? cell : null;
    return cell;
  });
  const column = {
    querySelector(selector) {
      return selector === tweetSelector ? organic : { textContent: '为你推荐' };
    },
    contains: node => node === region
  };
  const accessible = vm.runInNewContext(source + '\nRecallX;', {
    URL,
    location: { origin: 'https://x.com', pathname: '/home' },
    document: { querySelector: () => column },
    getComputedStyle: () => ({ transform: 'none' })
  });
  assert.deepEqual(Array.from(accessible.feed().entries, row => row.id), ['10', '11', '12']);
});
