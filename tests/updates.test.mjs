import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const built = 'a'.repeat(40), latest = 'b'.repeat(40);
const repository = 'https://github.com/example/tools';
const { parseUpdateRepository } = loadTs('core/update-source.ts');

function fixture() {
  const data = { updateRepository: repository };
  const notices = [], requests = [], tabs = [], listeners = {};
  let badge = '', status = 'ahead', granted = true, remote = latest;
  const event = (key) => ({ addListener: (callback) => { listeners[key] = callback; } });
  const chrome = {
    storage: { local: { get: async () => ({ ...data }), set: async (value) => Object.assign(data, value),
      remove: async (key) => { delete data[key]; } }, onChanged: event('storage') },
    permissions: { contains: async () => granted },
    action: { setBadgeText: async ({ text }) => { badge = text; }, setTitle: async () => {}, setBadgeBackgroundColor: async () => {} },
    notifications: { create: async (_, notice) => { notices.push(notice); }, clear: async () => {}, onClicked: event('click') },
    runtime: { getURL: (path) => 'chrome-extension://test/' + path, onStartup: event('startup'), onInstalled: event('installed') },
    tabs: { create: async (value) => { tabs.push(value); } },
  };
  const api = loadTs('core/updates.ts', { globals: { chrome, AbortSignal, fetch: async (url) => {
    requests.push(url);
    if (status === 'offline') throw Error('offline');
    const missing = url.includes('/compare/') && status === 'missing';
    return { ok: !missing, status: missing ? 404 : 200,
      json: async () => url.endsWith('/commits/main') ? { sha: remote } : { status } };
  } } });
  return { ...api, data, notices, requests, tabs, listeners, get badge() { return badge; },
    setStatus: (value) => { status = value; }, setGranted: (value) => { granted = value; },
    setRemote: (value) => { remote = value; } };
}

test('источник принимает только URL репозитория GitHub и удаляет .git', () => {
  assert.equal(parseUpdateRepository(repository + '.git/').url, repository);
  for (const value of ['', null, 'http://github.com/a/b', 'https://gitlab.com/a/b',
    'https://github.com/a/b/tree/main', 'https://user:pass@github.com/a/b', repository + '?token=secret']) {
    assert.equal(parseUpdateRepository(value), null);
  }
});

test('новые коммиты вызывают уведомление, обновление сборки убирает отметку', async () => {
  const f = fixture();
  await f.checkForUpdates(built);
  assert.equal(f.notices.length, 1);
  assert.equal(f.badge, '!');
  assert.equal(f.data.updateCheckState.baseline, built);
  assert.ok(f.requests[1].endsWith(`/compare/${built}...${latest}`));
  await f.checkForUpdates(built);
  assert.equal(f.notices.length, 2);
  await f.checkForUpdates(latest);
  assert.equal(f.badge, '');
  assert.equal(f.notices.length, 2);
});

test('одинаковая или более старая ветка main не объявляется обновлением', async () => {
  const f = fixture();
  f.setRemote(built);
  await f.checkForUpdates(built);
  assert.equal(f.requests.length, 1);
  f.setRemote(latest); f.setStatus('behind');
  await f.checkForUpdates(built);
  assert.equal(f.notices.length, 0);
});

test('без доступа и при пустом источнике запросы не выполняются', async () => {
  const f = fixture();
  f.setGranted(false);
  await f.checkForUpdates(built);
  assert.equal(f.requests.length, 0);
  f.data.updateRepository = '';
  await f.checkForUpdates(built);
  assert.equal(f.badge, '');
});

test('другой репозиторий или сборка без Git получают начальную точку сравнения', async () => {
  for (const revision of [built, '']) {
    const f = fixture(); f.setStatus('missing');
    await f.checkForUpdates(revision);
    assert.equal(f.notices.length, 0);
    assert.equal(f.data.updateCheckState.baseline, latest);
    f.setRemote('c'.repeat(40)); f.setStatus('ahead');
    await f.checkForUpdates(revision);
    assert.equal(f.notices.length, 1);
  }
});

test('сбой сети не создаёт уведомление и не меняет точку сравнения', async () => {
  const f = fixture(); f.setStatus('offline');
  await assert.rejects(f.checkForUpdates(built), /offline/);
  assert.equal(f.data.updateCheckState, undefined);
  assert.equal(f.notices.length, 0);
});

test('проверка подключена к запуску браузера, нажатие уведомления открывает Actions', async () => {
  const f = fixture(); f.setupUpdateChecks(built);
  f.listeners.startup();
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
  await flush();
  assert.equal(f.notices.length, 1);
  f.listeners.click('confluence-tools-ci-update'); await flush();
  assert.equal(f.tabs[0].url, repository + '/actions');
  f.data.updateRepository = '';
  f.listeners.storage({ updateRepository: { newValue: '' } }, 'local'); await flush();
  assert.equal(f.badge, '');
});
