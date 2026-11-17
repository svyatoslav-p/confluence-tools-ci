import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

function fixture() {
  class Element extends EventTarget {
    style = {}; children = []; isConnected = false;
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.isConnected = true; } }
    attachShadow() { return new Element(); }
    remove() { this.isConnected = false; }
    setAttribute() {}
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  }
  const document = new EventTarget();
  document.documentElement = new Element(); document.createElement = () => new Element();
  document.querySelector = () => ({});
  const window = new EventTarget(); window.top = window;
  window.tinymce = { activeEditor: { initialized: true, getDoc: () => ({}) } };
  let receive;
  const count = { starts: { panel: 0, other: 0 }, stops: { panel: 0, other: 0 },
    intervals: 0, cleared: 0, themeStarted: 0, themeStopped: 0, unsubscribed: 0 };
  const features = ['panel', 'other'].map((id) => ({ id, setupEditor: () => {
    count.starts[id]++; return () => { count.stops[id]++; };
  } }));
  const origin = 'http://example.com:8095';
  const { startApp } = loadTs('core/app.ts', { globals: {
    window, document, location: { origin }, setInterval: () => ++count.intervals,
    clearInterval: (id) => { if (id !== undefined) count.cleared++; },
  }, imports: {
    './bridge': { onBridge: (callback) => { receive = callback; return () => { count.unsubscribed++; }; }, postBridge() {} },
    './registry': { features }, './theme': { THEME_CSS: '', watchTheme: () => {
      count.themeStarted++; return () => { count.themeStopped++; };
    } },
  } });
  const dispose = startApp();
  const send = (changes = {}) => {
    const settings = { hosts: [origin], features: {
      panel: { enabled: true, values: { color: '#008000' } },
      other: { enabled: true, values: { text: 'unchanged' } },
    }, ...changes };
    receive({ type: 'settings', settings });
    return settings;
  };
  return { startApp, dispose, send, count, window, document, origin };
}

test('приложение проверяет точный origin и не пересоздаёт модули при изменении адресов', () => {
  const f = fixture();
  try {
    f.send({ hosts: ['http://example.com:8096'] });
    assert.equal(f.count.starts.panel, 0); assert.equal(f.count.themeStarted, 0);
    f.send();
    f.send({ hosts: [f.origin, 'https://another.com'] });
    assert.equal(f.count.starts.panel, 1); assert.equal(f.count.stops.panel, 0);
    assert.equal(f.count.starts.other, 1); assert.equal(f.count.intervals, 1);
  } finally { f.dispose(); }
});

test('изменение и отключение одного модуля не перезапускает другой', () => {
  const f = fixture();
  try {
    const state = f.send();
    state.features.panel.values.color = '#ff0000';
    f.send(state);
    assert.equal(f.count.starts.panel, 2); assert.equal(f.count.stops.panel, 1);
    assert.equal(f.count.starts.other, 1); assert.equal(f.count.stops.other, 0);
    state.features.panel.enabled = false;
    f.send(state);
    assert.equal(f.count.starts.panel, 2); assert.equal(f.count.stops.panel, 2);
    assert.equal(f.count.starts.other, 1); assert.equal(f.count.stops.other, 0);
    state.features.panel.enabled = true;
    f.send(state);
    assert.equal(f.count.starts.panel, 3); assert.equal(f.count.starts.other, 1);
  } finally { f.dispose(); }
});

test('замена редактора пересоздаёт модули, идентичные настройки не делают лишнего запуска', () => {
  const f = fixture();
  try {
    f.send();
    f.window.tinymce.activeEditor = { initialized: true, getDoc: () => ({}) };
    f.send();
    assert.equal(f.count.starts.panel, 2); assert.equal(f.count.stops.panel, 1);
    assert.equal(f.count.starts.other, 2); assert.equal(f.count.stops.other, 1);
    f.send();
    assert.equal(f.count.starts.panel, 2); assert.equal(f.count.starts.other, 2);
  } finally { f.dispose(); }
});

test('удаление адреса останавливает UI и тему, повторное добавление возобновляет их', () => {
  const f = fixture();
  try {
    f.send();
    f.send({ hosts: [] });
    assert.equal(f.count.stops.panel, 1); assert.equal(f.count.stops.other, 1);
    assert.equal(f.count.themeStopped, 1); assert.equal(f.count.cleared, 1);
    assert.equal(f.document.documentElement.children[0].isConnected, false);
    assert.equal(f.count.unsubscribed, 0);
    f.send();
    assert.equal(f.count.starts.panel, 2); assert.equal(f.count.starts.other, 2);
    assert.equal(f.count.themeStarted, 2); assert.equal(f.count.intervals, 2);
  } finally { f.dispose(); }
});

test('dispose снимает все ресурсы и допускает чистый повторный запуск', () => {
  const f = fixture();
  f.send();
  assert.equal(f.startApp(), undefined);
  f.dispose(); f.dispose();
  assert.equal(f.count.stops.panel, 1); assert.equal(f.count.stops.other, 1);
  assert.equal(f.count.themeStopped, 1); assert.equal(f.count.cleared, 1);
  assert.equal(f.count.unsubscribed, 1); assert.equal(f.window.__confluenceExtLoaded, undefined);
  const disposeAgain = f.startApp();
  f.send();
  assert.equal(f.count.starts.panel, 2); assert.equal(f.count.starts.other, 2);
  disposeAgain();
});

test('pagehide освобождает приложение, но сохраняет его для back/forward cache', () => {
  const f = fixture();
  f.send();
  const cached = new Event('pagehide'); Object.assign(cached, { persisted: true });
  f.window.dispatchEvent(cached);
  assert.equal(f.count.unsubscribed, 0); assert.equal(f.count.stops.panel, 0);
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(f.count.unsubscribed, 1); assert.equal(f.count.stops.panel, 1);
});

test('наблюдатель темы отключается явной функцией очистки', () => {
  let callback, connected = false, disconnects = 0, current = 'dark';
  class Observer {
    constructor(handler) { callback = handler; }
    observe() { connected = true; }
    disconnect() { connected = false; disconnects++; }
  }
  const { watchTheme } = loadTs('core/theme.ts', { globals: {
    MutationObserver: Observer, document: { documentElement: { getAttribute: () => current } },
  } });
  const host = { setAttribute: (_, value) => { host.theme = value; } };
  const stop = watchTheme(host);
  assert.equal(host.theme, 'dark'); assert.equal(connected, true);
  current = 'light'; callback(); assert.equal(host.theme, 'light');
  stop(); assert.equal(connected, false); assert.equal(disconnects, 1);
});
