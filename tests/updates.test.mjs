import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const source = 'https://api.github.com/repos/svyatoslav-p/confluence-tools-ci/releases/latest';
const permission = 'https://api.github.com/*';
const { parseVersion, compareVersions, availableUpdate } = loadTs('src/core/update-source.ts');

test('popup использует только результат проверки релиза для установленной версии', () => {
  const state = { source, installedVersion: '0.1.2', version: '0.1.3', checking: true };
  const stored = { updateCheckState: state };
  assert.equal(availableUpdate(stored, '0.1.2'), '0.1.3');
  assert.equal(availableUpdate(stored, '0.1.3'), null);
  assert.equal(availableUpdate({ updateCheckState: { ...state, source: 'https://example.org/package.json' } }, '0.1.2'), null);
  for (const version of [null, '0.1.2', '0.1.1', 'bad']) {
    assert.equal(availableUpdate({ updateCheckState: { ...state, version } }, '0.1.2'), null);
  }
});

function release(version = '0.2.0') {
  const tag_name = 'v' + version;
  const name = 'confluence-tools-ci-chrome-' + version + '.zip';
  return {
    tag_name, draft: false, prerelease: false,
    assets: [{ name, state: 'uploaded', size: 100, digest: 'sha256:' + 'a'.repeat(64),
      browser_download_url: 'https://github.com/svyatoslav-p/confluence-tools-ci/releases/download/' + tag_name + '/' + name }],
  };
}

function fixture() {
  const data = {};
  const requests = [], listeners = {};
  let badge = '', granted = true, offline = false, httpStatus = 200;
  let response = release(), installedVersion = '0.1.0', revokeDuringFetch = false;
  const event = (name) => ({ addListener: (callback) => { listeners[name] = callback; } });
  const chrome = {
    storage: { local: { get: async () => ({ ...data }), set: async (value) => Object.assign(data, value),
      remove: async (key) => { delete data[key]; } }, onChanged: event('storage') },
    permissions: {
      contains: async ({ origins }) => { assert.equal(origins.join(','), permission); return granted; },
      onAdded: event('grant'), onRemoved: event('revoke'),
    },
    action: { setBadgeText: async ({ text }) => { badge = text; }, setTitle: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'test', getManifest: () => ({ version: installedVersion }),
      onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed') },
  };
  const api = loadTs('src/core/updates.ts', { globals: { chrome, AbortSignal, Error, fetch: async (url, options) => {
    requests.push({ url, options });
    if (revokeDuringFetch) granted = false;
    if (offline) throw Error('offline');
    return { ok: httpStatus === 200, status: httpStatus, json: async () => response };
  } } });
  return { ...api, data, requests, listeners, get badge() { return badge; },
    setRelease: (value) => { response = value; }, setInstalled: (value) => { installedVersion = value; },
    setOffline: () => { offline = true; }, setGranted: (value) => { granted = value; },
    setHttpStatus: (value) => { httpStatus = value; }, revokeDuringFetch: () => { revokeDuringFetch = true; },
    runManualCheck: () => new Promise((resolve) => listeners.message({ type: 'check-updates' }, { id: 'test' }, resolve)),
  };
}

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };

test('номера выпусков сравниваются по числовым частям Chrome', () => {
  for (const value of [null, 1, '0.01.0', '1.2.3-beta', '65536.1', '0.0.0', '1.2.3.4.5']) {
    assert.equal(parseVersion(value), null);
  }
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('1.1.9.9999', '1.2') < 0);
  assert.equal(compareVersions('0.1', '0.1.0.0'), 0);
});

test('проверка запрашивает только официальный релиз и игнорирует прежний URL', async () => {
  const f = fixture();
  f.data.updateManifestUrl = 'https://example.org/package.json';
  await f.checkForUpdates();
  assert.equal(availableUpdate(f.data, '0.1.0'), '0.2.0');
  assert.equal(f.badge, '!');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, source);
  assert.equal(f.requests[0].options.credentials, 'omit');
  f.setInstalled('0.2.0');
  await f.checkForUpdates();
  assert.equal(f.badge, '');
  assert.equal(availableUpdate(f.data, '0.2.0'), null);
});

test('проверка показывает обновление только для нового стабильного выпуска с готовым ZIP', async () => {
  const f = fixture();
  const valid = release();
  for (const candidate of [
    release('0.0.9'), release('0.1.0'), release('0.2.0-beta'), { ...valid, draft: true },
    { ...valid, prerelease: true }, { ...valid, assets: [] },
    ...[{ state: 'new' }, { digest: '' }, { browser_download_url: 'https://example.org/zip' }].map((asset) => ({
      ...valid, assets: [{ ...valid.assets[0], ...asset }],
    })),
  ]) {
    f.setRelease(candidate);
    await f.checkForUpdates();
    assert.equal(availableUpdate(f.data, '0.1.0'), null);
    assert.equal(f.badge, '');
    assert.equal(f.data.updateCheckState.error, '');
  }
  f.setHttpStatus(404);
  await f.checkForUpdates();
  assert.equal(f.data.updateCheckState.version, null);
  assert.equal(f.data.updateCheckState.error, '');
});

test('отсутствие доступа блокирует запрос, а отзыв доступа во время проверки очищает результат', async () => {
  const f = fixture();
  f.setGranted(false);
  await f.checkForUpdates();
  assert.equal(f.requests.length, 0);
  assert.equal(f.data.updateCheckState, undefined);
  f.setGranted(true);
  f.revokeDuringFetch();
  await f.checkForUpdates();
  assert.equal(f.requests.length, 1);
  assert.equal(f.data.updateCheckState, undefined);
  assert.equal(f.badge, '');
});

test('ручная проверка сохраняет ошибки API и последний успешный результат', async () => {
  const f = fixture(); f.setupUpdateChecks();
  assert.equal(f.listeners.message({ type: 'check-updates' }, { id: 'foreign' }, () => assert.fail()), undefined);
  f.setHttpStatus(403);
  await f.runManualCheck();
  assert.match(f.data.updateCheckState.error, /403/);
  assert.equal(f.data.updateCheckState.installedVersion, '0.1.0');
  assert.equal(f.data.updateCheckState.checking, false);
  f.setHttpStatus(200);
  f.setRelease({});
  await f.runManualCheck();
  assert.match(f.data.updateCheckState.error, /некорректные данные/);
  f.setRelease(release());
  await f.runManualCheck();
  assert.equal(availableUpdate(f.data, '0.1.0'), '0.2.0');
  f.setOffline();
  await f.runManualCheck();
  assert.ok(f.data.updateCheckState.error);
  assert.equal(availableUpdate(f.data, '0.1.0'), '0.2.0');
});

test('автопроверка включена по умолчанию, отзыв доступа снимает отметку', async () => {
  const f = fixture(); f.setupUpdateChecks();
  f.listeners.startup(); await flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.badge, '!');
  f.setGranted(false);
  f.listeners.revoke({ origins: [permission] }); await flush();
  assert.equal(f.badge, '');
  assert.equal(f.data.updateCheckState, undefined);
  assert.equal(f.requests.length, 1);
});

test('при отключённой автопроверке запрос отправляет только ручная команда', async () => {
  const f = fixture();
  f.data.autoCheckUpdates = false;
  f.setupUpdateChecks();
  f.listeners.startup();
  f.listeners.installed();
  f.listeners.grant({ origins: [permission] });
  f.listeners.storage({ autoCheckUpdates: { newValue: false } }, 'local');
  await flush();
  assert.equal(f.requests.length, 0);
  await f.runManualCheck();
  assert.equal(f.requests.length, 1);
  assert.equal(f.badge, '!');
  f.data.autoCheckUpdates = true;
  f.listeners.storage({ autoCheckUpdates: { newValue: true } }, 'local');
  await flush();
  assert.equal(f.requests.length, 2);
});
