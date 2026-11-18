import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const source = 'https://raw.githubusercontent.com/svyatoslav-p/confluence-tools-ci/refs/heads/main/package.json';
const downloadUrl = 'https://github.com/svyatoslav-p/confluence-tools-ci/actions';
const { parseUpdateSource, storedUpdateSource, readPackageVersion, compareVersions, availableUpdate } = loadTs('core/update-source.ts');

test('popup показывает найденную новую версию только для текущей сборки и источника', () => {
  const state = { source, installedVersion: '0.1.2', version: '0.1.3', available: true, downloadUrl };
  const stored = { updateManifestUrl: source, updateCheckState: state };
  assert.equal(availableUpdate(stored, '0.1.2').version, '0.1.3');
  assert.equal(availableUpdate(stored, '0.1.2').downloadUrl, downloadUrl);
  assert.equal(availableUpdate(stored, '0.1.3'), null);
  assert.equal(availableUpdate({ ...stored, updateManifestUrl: '' }, '0.1.2'), null);
  assert.equal(availableUpdate({ ...stored, updateManifestUrl: 'https://example.org/package.json' }, '0.1.2'), null);
  for (const value of [{ available: false }, { version: '0.1.2' }, { version: '0.1.1' }, { version: 'bad' }]) {
    assert.equal(availableUpdate({ ...stored, updateCheckState: { ...state, ...value } }, '0.1.2'), null);
  }
  const cached = { ...stored, updateCheckState: { ...state, checking: true, error: 'offline', downloadUrl: 'javascript:alert(1)' } };
  assert.equal(availableUpdate(cached, '0.1.2').version, '0.1.3');
  assert.equal(availableUpdate(cached, '0.1.2').downloadUrl, '');
});

function fixture() {
  const data = { updateManifestUrl: source };
  const requests = [], listeners = {};
  let badge = '', granted = true, offline = false, httpStatus = 200;
  let manifest = { version: '0.2.0', downloadUrl }, installedVersion = '0.1.0';
  const event = (name) => ({ addListener: (callback) => { listeners[name] = callback; } });
  const chrome = {
    storage: { local: { get: async () => ({ ...data }), set: async (value) => Object.assign(data, value),
      remove: async (key) => { delete data[key]; } }, onChanged: event('storage') },
    permissions: { contains: async () => granted },
    action: { setBadgeText: async ({ text }) => { badge = text; }, setTitle: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'test', getManifest: () => ({ version: installedVersion }),
      onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed') },
  };
  const api = loadTs('core/updates.ts', { globals: { chrome, AbortSignal, fetch: async (url, options) => {
    requests.push({ url, options });
    if (offline) throw Error('offline');
    return { ok: httpStatus === 200, status: httpStatus, json: async () => manifest };
  } } });
  return { ...api, data, requests, listeners, get badge() { return badge; },
    setManifest: (value) => { manifest = value; }, setVersion: (value) => { manifest.version = value; },
    setInstalled: (value) => { installedVersion = value; },
    setOffline: () => { offline = true; }, setGranted: (value) => { granted = value; }, setHttpStatus: (value) => { httpStatus = value; } };
}

test('источник — полный HTTPS URL любого хостинга, старый GitHub-адрес переносится', () => {
  assert.equal(parseUpdateSource('https://gitlab.example.org/project/raw/main/update.json').permission, 'https://gitlab.example.org/*');
  assert.equal(parseUpdateSource('https://gitlab.example.org:8443/update.json').permission, 'https://gitlab.example.org/*');
  assert.equal(storedUpdateSource({}), source);
  assert.equal(storedUpdateSource({ updateManifestUrl: source.replace('package.json', 'update.json') }), source);
  assert.equal(storedUpdateSource({ updateRepository: 'https://github.com/svyatoslav-p/confluence-tools-ci' }), source);
  assert.equal(storedUpdateSource({ updateRepository: '' }), '');
  assert.equal(storedUpdateSource({ updateManifestUrl: '' }), '');
  for (const url of ['javascript:alert(1)', 'http://example.org/update.json', 'https://u:p@example.org/update.json']) assert.equal(parseUpdateSource(url), null);
});

test('package.json проверяет числовую версию расширения Chrome', () => {
  for (const value of [null, {}, { version: 1 }, { version: '0.01.0' }, { version: '1.2.3-beta' },
    { version: '65536.1' }, { version: '0.0.0' }, { version: '1.2.3.4.5' }]) {
    assert.equal(readPackageVersion(value), null);
  }
  assert.equal(readPackageVersion({ name: 'tools', version: '0.1.0' }), '0.1.0');
});

test('версии сравниваются по числам, недостающие части равны нулю', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.ok(compareVersions('0.1.1', '0.1.0') > 0);
  assert.ok(compareVersions('1.1.9.9999', '1.2') < 0);
  assert.equal(compareVersions('0.1', '0.1.0.0'), 0);
});

test('один запрос package.json обнаруживает увеличение версии, установка снимает отметку', async () => {
  const f = fixture(); await f.checkForUpdates();
  assert.equal(f.data.updateCheckState.available, true);
  assert.equal(f.data.updateCheckState.downloadUrl, downloadUrl);
  assert.equal(f.badge, '!');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, source);
  assert.equal(f.requests[0].options.credentials, 'omit');
  f.setInstalled('0.2.0'); await f.checkForUpdates();
  assert.equal(f.badge, '');
});

test('одинаковая или более старая версия не объявляется обновлением', async () => {
  const f = fixture();
  for (const version of ['0.1.0', '0.0.9']) {
    f.setVersion(version); await f.checkForUpdates();
    assert.equal(f.data.updateCheckState.available, false);
  }
});

test('ссылка на сборки берётся из удалённого package.json и проверяется', async () => {
  const f = fixture();
  const customUrl = 'https://gitlab.example.org/tools/-/jobs/artifacts/main/download?job=build';
  f.setManifest({ version: '0.3.0', downloadUrl: customUrl });
  await f.checkForUpdates();
  assert.equal(f.data.updateCheckState.downloadUrl, customUrl);
  for (const value of [undefined, '', 'javascript:alert(1)', 'http://example.org/file.zip', 'https://u:p@example.org/file.zip']) {
    f.setManifest({ version: '0.3.0', downloadUrl: value });
    await f.checkForUpdates();
    assert.equal(f.data.updateCheckState.available, true);
    assert.equal(f.data.updateCheckState.downloadUrl, '');
  }
});

test('отключённая проверка и отсутствие доступа не выполняют запрос', async () => {
  const f = fixture(); await f.checkForUpdates();
  f.requests.length = 0;
  f.setGranted(false);
  await f.checkForUpdates();
  assert.equal(f.badge, '');
  assert.equal(f.data.updateCheckState, undefined);
  f.setGranted(true);
  f.data.updateManifestUrl = ''; await f.checkForUpdates();
  assert.equal(f.requests.length, 0);
});

test('ошибка HTTP и некорректный JSON не устанавливают отметку обновления', async () => {
  const f = fixture(); f.setHttpStatus(404);
  await assert.rejects(f.checkForUpdates(), /404/);
  f.setHttpStatus(200); f.setManifest({});
  await assert.rejects(f.checkForUpdates(), /version/);
  assert.equal(f.badge, '');
});

test('ручная проверка сохраняет результат и ошибку для настроек', async () => {
  const f = fixture(); f.setupUpdateChecks();
  const check = () => new Promise((resolve) => f.listeners.message({ type: 'check-updates' }, { id: 'test' }, resolve));
  assert.equal(f.listeners.message({ type: 'check-updates' }, { id: 'foreign' }, () => assert.fail()), undefined);
  await check(); assert.equal(f.data.updateCheckState.available, true);
  f.setOffline(); await check();
  assert.ok(f.data.updateCheckState.error);
  assert.equal(f.data.updateCheckState.available, true);
  assert.equal(f.data.updateCheckState.checking, false);
});

test('ошибка первой проверки сохраняет установленную версию для показа в настройках', async () => {
  const f = fixture(); f.setOffline(); f.setupUpdateChecks();
  await new Promise((resolve) => f.listeners.message({ type: 'check-updates' }, { id: 'test' }, resolve));
  assert.equal(f.data.updateCheckState.installedVersion, '0.1.0');
  assert.equal(f.data.updateCheckState.checking, false);
  assert.ok(f.data.updateCheckState.error);
});

test('проверка при запуске браузера устанавливает отметку, отключение источника убирает её', async () => {
  const f = fixture(); f.setupUpdateChecks();
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
  f.listeners.startup(); await flush(); assert.equal(f.badge, '!');
  assert.equal(f.data.updateCheckState.downloadUrl, downloadUrl);
  f.data.updateManifestUrl = '';
  f.listeners.storage({ updateManifestUrl: {} }, 'local'); await flush(); assert.equal(f.badge, '');
});
