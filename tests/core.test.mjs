import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const feature = { id: 'panel', settings: [
  { key: 'color', type: 'color', default: '#008000' },
  { key: 'always', type: 'boolean', default: 'false' },
  { key: 'key', type: 'hotkey', default: 'Alt+KeyZ' },
] };
const { normalizeSettings, normalizeHost, hostToPattern } = loadTs('core/settings.ts');
const { eventToHotkey, isHotkey } = loadTs('core/hotkeys.ts');

test('повреждённые настройки не приводят к исключению или неверному типу', () => {
  for (const raw of [null, [], 12, 'text', { hosts: ['bad host', null, 'ftp://test'] },
    { features: { panel: { enabled: 'false', values: { color: 'red', always: 'yes', key: 'KeyZ' } } } }]) {
    const result = normalizeSettings(raw, [feature]);
    assert.equal(result.features.panel.enabled, true);
    assert.equal(result.features.panel.values.color, '#008000');
    assert.equal(result.features.panel.values.always, 'false');
    assert.equal(result.features.panel.values.key, 'Alt+KeyZ');
  }
});

test('пустой список хостов, отключение модуля и пустая клавиша сохраняются', () => {
  const result = normalizeSettings({ hosts: [], features: { panel: { enabled: false, values: { key: '' } } } }, [feature]);
  assert.equal(result.hosts.length, 0);
  assert.equal(result.features.panel.enabled, false);
  assert.equal(result.features.panel.values.key, '');
});

test('адреса нормализуются и не включают учётные данные, wildcard и другой протокол', () => {
  assert.equal(normalizeHost('https://Example.com/path'), 'https://example.com');
  for (const host of ['https://u:p@example.com', 'https://*.example.com', 'file:///tmp', 'ftp://example.com']) assert.equal(normalizeHost(host), null);
  const result = normalizeSettings({ hosts: ['https://example.com/a', 'https://example.com/', 'http://example.com:8095'] }, []);
  assert.equal(result.hosts.length, 2);
  assert.equal(hostToPattern(result.hosts[1]), 'http://example.com/*');
});

test('клавиши зависят от code и одинаковы для русской и английской раскладки', () => {
  for (const key of ['z', 'я']) assert.equal(eventToHotkey({ key, code: 'KeyZ', altKey: true }), 'Alt+KeyZ');
  assert.equal(eventToHotkey({ code: 'AltLeft', altKey: true }), null);
  for (const key of ['', 'Alt+KeyV', 'Ctrl+Alt+Shift+Meta+KeyQ']) assert.equal(isHotkey(key), true);
  for (const key of ['KeyZ', 'Shift+KeyZ', 'Alt+AltLeft', 'Alt+KeyZ+KeyX']) assert.equal(isHotkey(key), false);
});

test('мост отбрасывает malformed, чужое окно и чужой origin', () => {
  let receive;
  const window = { location: { origin: 'https://example.com' }, addEventListener: (_, cb) => { receive = cb; }, removeEventListener() {} };
  const { onBridge } = loadTs('core/bridge.ts', { globals: { window }, imports: { './definitions': { definitions: [feature] } } });
  const messages = [];
  onBridge((message) => messages.push(message));
  const emit = (data, source = window, origin = window.location.origin) => receive({ data, source, origin });
  for (const data of [null, {}, { tag: 'confluence-ext' }, { tag: 'confluence-ext', message: null }, { tag: 'confluence-ext', message: { type: 'settings' } }]) emit(data);
  const valid = { tag: 'confluence-ext', message: { type: 'get-settings' } };
  emit(valid, {}); emit(valid, window, 'https://other.com');
  assert.equal(messages.length, 0);
  emit(valid);
  assert.equal(messages[0].type, 'get-settings');
});

test('регистрация не меняется при настройке цвета, но меняется при удалении хоста', async () => {
  const listeners = {};
  const event = (name) => ({ addListener: (callback) => { listeners[name] = callback; } });
  let registered = [];
  let registrations = 0, removals = 0;
  const state = { hosts: ['https://example.com'] };
  const chrome = {
    permissions: { contains: async () => true, onAdded: event('permissionAdded'), onRemoved: event('permissionRemoved') },
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (scripts) => { registered = scripts; registrations++; },
      unregisterContentScripts: async () => { registered = []; removals++; },
    },
    runtime: { id: 'extension', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), openOptionsPage: async () => {} },
    action: { onClicked: event('action') }, storage: { onChanged: event('storage') },
  };
  loadTs('entrypoints/background.ts', { globals: { chrome, __BUILD_TIMESTAMP__: '' }, imports: {
    '../core/updates': { setupUpdateChecks() {} },
    '#imports': { defineBackground: (callback) => callback() },
    '../core/storage': { loadHosts: async () => state.hosts },
  } });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  listeners.startup(); await flush();
  assert.equal(registrations, 1);
  listeners.storage({ settings: {} }, 'local'); await flush();
  assert.equal(registrations, 1); assert.equal(removals, 0);
  state.hosts = [];
  listeners.storage({ settings: {} }, 'local'); await flush();
  assert.equal(registered.length, 0); assert.equal(removals, 1);
});




test('background читает hosts без обращения к описаниям модулей', async () => {
  const definitions = {};
  Object.defineProperty(definitions, 'definitions', { get() { throw Error('Unexpected feature access'); } });
  const { loadHosts } = loadTs('core/storage.ts', { globals: {
    chrome: { storage: { local: { get: async () => ({ settings: { hosts: ['https://example.com/a', 'https://example.com'] } }) } } },
  }, imports: { './definitions': definitions } });
  const hosts = await loadHosts();
  assert.equal(hosts.length, 1); assert.equal(hosts[0], 'https://example.com');
});

test('подписка на хранилище возвращает точную функцию отписки', () => {
  let receive, removed;
  const { onSettingsChanged } = loadTs('core/storage.ts', { globals: {
    chrome: { storage: { onChanged: { addListener: (callback) => { receive = callback; }, removeListener: (callback) => { removed = callback; } } } },
  }, imports: { './definitions': { definitions: [feature] } } });
  const values = [];
  const stop = onSettingsChanged((value) => values.push(value));
  receive({ settings: { newValue: { hosts: [] } } }, 'sync');
  assert.equal(values.length, 0);
  receive({ settings: { newValue: { hosts: [] } } }, 'local');
  assert.equal(values.length, 1);
  stop(); assert.equal(removed, receive);
});
