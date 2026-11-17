import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const builtAt = '2026-11-17T12:00:00.000Z';
const source = 'https://raw.githubusercontent.com/svyatoslav-p/confluence-tools-ci/refs/heads/main/update.json';
const downloadUrl = 'https://github.com/svyatoslav-p/confluence-tools-ci/actions';
const { parseUpdateSource, storedUpdateSource, parseUpdateManifest } = loadTs('core/update-source.ts');

function fixture() {
  const data = { updateManifestUrl: source };
  const requests = [], listeners = {};
  let badge = '', granted = true, offline = false, httpStatus = 200;
  let manifest = { version: '0.1.0', builtAt: '2026-11-17T14:00:00Z', downloadUrl };
  const event = (name) => ({ addListener: (callback) => { listeners[name] = callback; } });
  const chrome = {
    storage: { local: { get: async () => ({ ...data }), set: async (value) => Object.assign(data, value),
      remove: async (key) => { delete data[key]; } }, onChanged: event('storage') },
    permissions: { contains: async () => granted },
    action: { setBadgeText: async ({ text }) => { badge = text; }, setTitle: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'test',
      onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed') },
  };
  const api = loadTs('core/updates.ts', { globals: { chrome, AbortSignal, fetch: async (url, options) => {
    requests.push({ url, options });
    if (offline) throw Error('offline');
    return { ok: httpStatus === 200, status: httpStatus, json: async () => manifest };
  } } });
  return { ...api, data, requests, listeners, get badge() { return badge; },
    setManifest: (value) => { manifest = value; }, setDate: (value) => { manifest.builtAt = value; },
    setOffline: () => { offline = true; }, setGranted: (value) => { granted = value; }, setHttpStatus: (value) => { httpStatus = value; } };
}

test('источник — полный HTTPS URL любого хостинга, старый GitHub-адрес переносится', () => {
  assert.equal(parseUpdateSource('https://gitlab.example.org/project/raw/main/update.json').permission, 'https://gitlab.example.org/*');
  assert.equal(parseUpdateSource('https://gitlab.example.org:8443/update.json').permission, 'https://gitlab.example.org/*');
  assert.equal(storedUpdateSource({}), source);
  assert.equal(storedUpdateSource({ updateRepository: 'https://github.com/svyatoslav-p/confluence-tools-ci' }), source);
  assert.equal(storedUpdateSource({ updateRepository: '' }), '');
  assert.equal(storedUpdateSource({ updateManifestUrl: '' }), '');
  for (const url of ['javascript:alert(1)', 'http://example.org/update.json', 'https://u:p@example.org/update.json']) assert.equal(parseUpdateSource(url), null);
});

test('JSON проверяет дату UTC, версию и безопасную ссылку на сборки', () => {
  for (const value of [null, {}, { version: '1', builtAt: '2026-02-30T12:00:00Z', downloadUrl },
    { version: '1', builtAt, downloadUrl: 'javascript:alert(1)' }, { version: '1', builtAt: '2026-11-17', downloadUrl }]) {
    assert.equal(parseUpdateManifest(value), null);
  }
  assert.equal(parseUpdateManifest({ version: '1', builtAt, downloadUrl }).builtAt, builtAt);
});

test('один запрос JSON обнаруживает более новую сборку с тем же номером версии', async () => {
  const f = fixture(); await f.checkForUpdates(builtAt);
  assert.equal(f.data.updateCheckState.available, true);
  assert.equal(f.data.updateCheckState.downloadUrl, downloadUrl);
  assert.equal(f.badge, '!');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, source);
  assert.equal(f.requests[0].options.credentials, 'omit');
  await f.checkForUpdates('2026-11-17T14:00:00.000Z');
  assert.equal(f.badge, '');
});

test('одинаковая или более старая дата не объявляется обновлением', async () => {
  const f = fixture();
  for (const date of [builtAt, '2026-11-16T23:00:00Z']) {
    f.setDate(date); await f.checkForUpdates(builtAt);
    assert.equal(f.data.updateCheckState.available, false);
  }
});

test('отключённая проверка и отсутствие доступа не выполняют запрос', async () => {
  const f = fixture(); f.setGranted(false);
  await assert.rejects(f.checkForUpdates(builtAt), /update.json/);
  f.data.updateManifestUrl = ''; await f.checkForUpdates(builtAt);
  assert.equal(f.requests.length, 0);
});

test('ошибка HTTP и некорректный JSON не устанавливают отметку обновления', async () => {
  const f = fixture(); f.setHttpStatus(404);
  await assert.rejects(f.checkForUpdates(builtAt), /404/);
  f.setHttpStatus(200); f.setManifest({});
  await assert.rejects(f.checkForUpdates(builtAt), /version/);
  assert.equal(f.badge, '');
});

test('ручная проверка сохраняет результат и ошибку для настроек', async () => {
  const f = fixture(); f.setupUpdateChecks(builtAt);
  const check = () => new Promise((resolve) => f.listeners.message({ type: 'check-updates' }, { id: 'test' }, resolve));
  assert.equal(f.listeners.message({ type: 'check-updates' }, { id: 'foreign' }, () => assert.fail()), undefined);
  await check(); assert.equal(f.data.updateCheckState.available, true);
  f.setOffline(); await check();
  assert.ok(f.data.updateCheckState.error);
  assert.equal(f.data.updateCheckState.available, true);
  assert.equal(f.data.updateCheckState.checking, false);
});

test('проверка при запуске браузера устанавливает отметку, отключение источника убирает её', async () => {
  const f = fixture(); f.setupUpdateChecks(builtAt);
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
  f.listeners.startup(); await flush(); assert.equal(f.badge, '!');
  assert.equal(f.data.updateCheckState.downloadUrl, downloadUrl);
  f.data.updateManifestUrl = '';
  f.listeners.storage({ updateManifestUrl: {} }, 'local'); await flush(); assert.equal(f.badge, '');
});
