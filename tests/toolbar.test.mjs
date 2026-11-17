import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

class Element extends EventTarget {
  constructor(name) { super(); this.nodeName = name.toUpperCase(); this.nodeType = 1; this.style = {}; this.children = []; this.attributes = new Map(); this.offsetWidth = 142; this.offsetHeight = 40; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelectorAll() { return []; }
  closest() { return null; }
}
class Document extends EventTarget {
  focused = true;
  hasFocus() { return this.focused; }
  createElement(name) { return new Element(name); }
  createRange() { return { setStart() {}, collapse() {}, getClientRects: () => [{ left: 180, top: 200, bottom: 220 }] }; }
}
function input(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 240));

function fixture(always = true) {
  const window = new EventTarget(); window.innerWidth = 900; window.innerHeight = 700;
  const document = new Document();
  const editorDoc = new Document();
  editorDoc.defaultView = new EventTarget(); editorDoc.defaultView.Element = Element;
  const root = new Element('root');
  const body = new Element('body');
  const text = { nodeType: 3, parentElement: body };
  const range = { commonAncestorContainer: text, intersectsNode: () => true,
    getClientRects: () => [{ left: 10, right: 200, top: 100, bottom: 220 }],
    getBoundingClientRect: () => ({ left: 10, right: 200, top: 100, bottom: 220 }) };
  const calls = [];
  const selection = { collapsed: false, getRng: () => range, isCollapsed() { return this.collapsed; },
    getSel: () => ({ anchorNode: text, focusNode: text, anchorOffset: 0, focusOffset: 5 }) };
  const editor = { selection, getDoc: () => editorDoc, getBody: () => body, nodeChanged() {},
    iframeElement: { getBoundingClientRect: () => ({ left: 0, top: 100, bottom: 650 }) },
    undoManager: { transact: (callback) => callback() },
    formatter: { apply: (...args) => calls.push(args) }, execCommand: (...args) => calls.push(args) };
  const { default: feature } = loadTs('features/selection-toolbar/index.ts', { globals: {
    window, document, Node: { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 },
  } });
  const values = Object.fromEntries(feature.settings.map((field) => [field.key, field.default]));
  values.showWithoutCtrl = String(always);
  const cleanup = feature.setupEditor({ editor, values, root, notify: (message) => calls.push(message) });
  const toolbar = root.children[1];
  return { editorDoc, document, root, window, editor, toolbar, calls, selection, cleanup, body, range };
}

test('панель ждёт mouseup, появляется у конца выделения и удаляет обработчики при отключении', async () => {
  const f = fixture();
  try {
    input(f.editorDoc, 'mousedown', { button: 0 });
    input(f.editorDoc, 'selectionchange');
    await pause();
    assert.equal(f.toolbar.style.display, 'none');
    input(f.editorDoc, 'mouseup', { button: 0 });
    await pause();
    assert.equal(f.toolbar.style.display, 'flex');
    assert.equal(f.toolbar.style.top, '328px');
    assert.equal(f.toolbar.children.length, 4);
    f.cleanup();
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.equal(f.root.children.length, 0);
    assert.equal(f.toolbar.style.display, 'flex');
  } finally { f.cleanup(); }
});

test('Ctrl-режим не открывается при обычном выделении', async () => {
  const f = fixture(false);
  try {
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.notEqual(f.toolbar.style.display, 'flex');
    input(f.editorDoc, 'keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true }); await pause();
    assert.equal(f.toolbar.style.display, 'flex');
    input(f.editorDoc, 'keyup', { key: 'Control' });
    assert.equal(f.toolbar.style.display, 'none');
  } finally { f.cleanup(); }
});

test('горячие клавиши не меняют формат без выделения и не перехватывают ввод IME', () => {
  const f = fixture();
  try {
    f.selection.collapsed = true;
    const key = { key: 'м', code: 'KeyV', altKey: true };
    assert.equal(input(f.editorDoc, 'keydown', key).defaultPrevented, false);
    assert.equal(f.calls.length, 0);
    f.selection.collapsed = false;
    input(f.editorDoc, 'keydown', { ...key, isComposing: true });
    assert.equal(f.calls.length, 0);
    assert.equal(input(f.editorDoc, 'keydown', key).defaultPrevented, true);
    assert.equal(f.calls[0][0], 'forecolor');
    assert.match(f.calls[0][1].value, /946F00/);
  } finally { f.cleanup(); }
});

test('потеря фокуса сбрасывает незавершённое выделение и скрывает панель', async () => {
  const f = fixture();
  try {
    input(f.editorDoc, 'mousedown', { button: 0 });
    input(f.editorDoc.defaultView, 'blur');
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.equal(f.toolbar.style.display, 'flex');
    f.editorDoc.focused = false;
    input(f.editorDoc.defaultView, 'blur');
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.equal(f.toolbar.style.display, 'none');
  } finally { f.cleanup(); }
});

test('обход списков ограничен областью выделения, стиль li восстанавливается', () => {
  const f = fixture();
  try {
    const li = new Element('li');
    f.body.querySelectorAll = () => { throw Error('Full editor scan'); };
    const container = new Element('p'); container.closest = () => li;
    f.range.commonAncestorContainer = { nodeType: 3, parentElement: container };
    f.editor.formatter.apply = () => li.setAttribute('style', 'color: red;');
    input(f.editorDoc, 'keydown', { code: 'KeyX', altKey: true });
    assert.equal(li.getAttribute('style'), null);
    assert.equal(li.getAttribute('data-mce-style'), null);
  } finally { f.cleanup(); }
});
