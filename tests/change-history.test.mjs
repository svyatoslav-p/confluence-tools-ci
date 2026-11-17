import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const { compareHistoryVersions } = loadTs('features/change-history/tables.ts');

test('история сортируется по числовым частям версии, неизвестные номера идут в конце', () => {
  const versions = ['Other', '[v1.10]', 'v2.0 Title', '[v1.2]', 'Draft', 'v1.0', '1.1'];
  assert.deepEqual(versions.sort(compareHistoryVersions), ['v1.0', '1.1', '[v1.2]', '[v1.10]', 'v2.0 Title', 'Other', 'Draft']);
  assert.ok(compareHistoryVersions('[v1.2.1]', '[v1.2]') > 0);
  assert.equal(compareHistoryVersions('[v1.0]', 'v1.0.0'), 0);
  assert.equal(compareHistoryVersions('Draft', 'Other'), 0);
  assert.ok(compareHistoryVersions('[v1.12]', '[v1.2]') > 0);
});

function fixture({ changed = true, updated = false, status = 200 } = {}) {
  const requests = [], messages = [];
  const child = { id: '2', title: '[v1.1] Example', space: { key: 'SPC' }, ancestors: [{ id: '1' }], body: { storage: { value: 'child' } } };
  const parent = { title: 'Parent', version: { number: 5 }, body: { storage: { value: 'original' } } };
  const feature = loadTs('features/change-history/index.ts', { globals: {
    document: { querySelector: (selector) => ({ content: selector.includes('ajs-page-id') ? '2' : '/confluence' }) },
    location: { origin: 'https://example.org' }, AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url: String(url), ...options });
      return { ok: options.method !== 'PUT' || status === 200, status,
        json: async () => new URL(url).pathname.endsWith('/2') ? child : parent };
    },
  }, imports: { './tables': { updateHistory: (p, c, page) => {
    assert.equal(p, 'original'); assert.equal(c, 'child'); assert.equal(page.id, '2');
    return { content: 'updated', changed, updated };
  } } } }).default;
  return { requests, messages, child, run: () => feature.actions[0].run({ notify: (...args) => messages.push(args) }), feature };
}

test('история доступна при просмотре; сохраняется только непосредственный родитель с увеличением версии', async () => {
  const f = fixture();
  assert.equal(f.feature.actions[0].mode, 'view');
  assert.ok(f.feature.actions[0].description);
  await f.run();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].url, 'https://example.org/confluence/rest/api/content/1');
  const body = JSON.parse(f.requests[2].body);
  assert.equal(body.version.number, 6);
  assert.equal(body.body.storage.value, 'updated');
  assert.equal(f.requests[2].credentials, 'same-origin');
  assert.match(f.messages.at(-1)[0], /добавлена/);
});

test('повторный запуск обновляет запись, неизменившаяся история не создаёт версию', async () => {
  const f = fixture({ updated: true }); await f.run();
  assert.match(f.messages.at(-1)[0], /обновлена/);
  const same = fixture({ changed: false }); await same.run();
  assert.equal(same.requests.length, 2);
  assert.match(same.messages.at(-1)[0], /актуальна/);
});

test('отказ доступа и конфликт сохранения не сообщают об успехе и допускают повторный запуск', async () => {
  for (const status of [403, 409, 500]) {
    const f = fixture({ status });
    await assert.rejects(f.run(), status === 409 ? /одновременно/ : status === 403 ? /Нет доступа/ : /500/);
    assert.ok(!f.messages.some(([, kind]) => kind === 'success'));
    await assert.rejects(f.run());
    assert.equal(f.requests.length, 6);
  }
});

test('страница без родителя не изменяется', async () => {
  const f = fixture(); f.child.ancestors = [];
  await assert.rejects(f.run(), /нет родителя/);
  assert.equal(f.requests.length, 1);
});
