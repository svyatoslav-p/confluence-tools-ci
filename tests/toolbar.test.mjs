import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

class Element extends EventTarget {
  get childElementCount() { return this.children.length; }
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
  createTextNode(text) { return { textContent: text }; }
  createRange() { return { setStart() {}, collapse() {}, getClientRects: () => [{ left: 180, top: 200, bottom: 220 }] }; }
}
function input(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 240));

function fixture(always = true, overrides = {}) {
  const window = new EventTarget(); window.innerWidth = 900; window.innerHeight = 700;
  const document = new Document();
  const editorDoc = new Document();
  editorDoc.defaultView = new EventTarget(); editorDoc.defaultView.Element = Element;
  const root = new Element('root');
  const body = new Element('body');
  const text = { nodeType: 3, parentElement: body };
  const range = { cloneRange() { return { ...this }; }, commonAncestorContainer: text, intersectsNode: () => true,
    getClientRects: () => [{ left: 10, right: 200, top: 100, bottom: 220 }],
    getBoundingClientRect: () => ({ left: 10, right: 200, top: 100, bottom: 220 }) };
  const calls = [];
  const selection = { collapsed: false, getRng: () => range, isCollapsed() { return this.collapsed; },
    getSel: () => ({ anchorNode: text, focusNode: text, anchorOffset: 0, focusOffset: 5 }) };
  const editor = { selection, getDoc: () => editorDoc, getBody: () => body, nodeChanged() {},
    iframeElement: { getBoundingClientRect: () => ({ left: 0, top: 100, bottom: 650 }) },
    undoManager: { transact: (callback) => callback() },
    formatter: { register() {}, remove: (...args) => calls.push(['remove', ...args]), apply: (...args) => calls.push(args) }, execCommand: (...args) => calls.push(args) };
  const { default: feature } = loadTs('features/selection-toolbar/index.ts', { globals: {
    window, document, Node: { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 },
  } });
  const values = Object.fromEntries(feature.settings.map((field) => [field.key, field.default]));
  values.showWithoutCtrl = String(always);
  Object.assign(values, overrides);
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
    assert.equal(f.toolbar.children.some((button) => button.getAttribute('aria-label') === 'Очистить стиль'), false);
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
  const f = fixture(true, { hotkeyYellow: 'Alt+KeyV' });
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

test('после действия панель не появляется повторно от selectionchange того же выделения', async () => {
  const f = fixture();
  try {
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.equal(f.toolbar.style.display, 'flex');
    input(f.toolbar.children.find((button) => button.getAttribute('aria-label') === 'Добавлено'), 'click');
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.equal(f.toolbar.style.display, 'none');
    input(f.editorDoc, 'mousedown', { button: 0 });
    input(f.editorDoc, 'mouseup', { button: 0 }); await pause();
    assert.equal(f.toolbar.style.display, 'flex');
  } finally { f.cleanup(); }
});

test('обход списков ограничен областью выделения, стиль li восстанавливается', () => {
  const f = fixture(true, { hotkeyRed: 'Alt+KeyX' });
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

test('стандартный стиль снимает зачёркивание, возвращает цвет ссылок и удаляет служебные метки', () => {
  const f = fixture();
  try {
    const span = new Element('span');
    span.setAttribute('data-ci-default-text', 'true');
    span.setAttribute('style', 'color: var(--ds-text, #172B4D);');
    const link = new Element('a');
    link.setAttribute('href', 'https://example.com');
    link.getAttribute = (name) => name === 'style' ? `color: ${link.style.color};` : link.attributes.get(name) ?? null;
    span.querySelectorAll = () => [link];
    f.body.querySelectorAll = () => [span];
    input(f.toolbar.children.find((button) => button.getAttribute('aria-label') === 'Стиль по умолчанию'), 'click');
    assert.deepEqual(f.calls.map((args) => args[0]), ['remove', 'ci-default-text']);
    assert.equal(f.calls[0][1], 'strikethrough');
    assert.equal(link.style.color, 'var(--ds-link, #0052CC)');
    assert.equal(link.getAttribute('href'), 'https://example.com');
    assert.equal(link.getAttribute('data-mce-style'), link.getAttribute('style'));
    assert.equal(span.getAttribute('data-ci-default-text'), null);
  } finally { f.cleanup(); }
});

test('скрытые кнопки сохраняют горячие клавиши, пустая панель не появляется', async () => {
  const f = fixture(true, { showClean: 'false', showDefault: 'false', showRed: 'false', showGreen: 'false', showYellow: 'false', showCase: 'false', showTextCase: 'false', hotkeyDefault: 'Alt+KeyB' });
  try {
    assert.equal(f.toolbar.children.length, 0);
    input(f.editorDoc, 'selectionchange'); await pause();
    assert.equal(f.toolbar.style.display, 'none');
    const event = input(f.editorDoc, 'keydown', { code: 'KeyB', key: 'и', altKey: true });
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(f.calls.map((args) => args[0]), ['remove', 'ci-default-text']);
  } finally { f.cleanup(); }
});

test('можно оставить только выбранные кнопки и переназначить стандартный стиль', () => {
  const f = fixture(true, { showClean: 'false', showRed: 'false', showYellow: 'false', showCase: 'false', showTextCase: 'false', hotkeyDefault: 'Alt+KeyN' });
  try {
    assert.deepEqual(f.toolbar.children.map((button) => button.getAttribute('aria-label')), ['Стиль по умолчанию', 'Добавлено']);
    assert.equal(input(f.editorDoc, 'keydown', { code: 'KeyB', altKey: true }).defaultPrevented, false);
    assert.equal(input(f.editorDoc, 'keydown', { code: 'KeyN', altKey: true }).defaultPrevented, true);
  } finally { f.cleanup(); }
});

test('имена преобразуются в обе стороны только для обратимых форм', () => {
  const { toggleIdentifier } = loadTs('features/selection-toolbar/identifier.ts');
  for (const [snake, camel] of [['oper_plan_draft_id', 'operPlanDraftId'], ['api_response_v2', 'apiResponseV2']]) {
    assert.equal(toggleIdentifier(snake), camel);
    assert.equal(toggleIdentifier(camel), snake);
  }
  for (const name of ['status', 'parseURL', 'draft_planId', 'oper_id, draftId', 'a_b_c', '_api_id', 'api_id\n']) {
    assert.equal(toggleIdentifier(name), null, name);
  }
});

test('выделенное имя может состоять из нескольких узлов с одинаковым оформлением и включать пробелы', () => {
  const { selectedIdentifier } = loadTs('features/selection-toolbar/identifier.ts', { globals: {
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
  } });
  const block = { nodeType: 1 };
  let editable = 'true';
  const editableRegion = { getAttribute: () => editable };
  const parent = { closest: (selector) => {
    if (selector.startsWith('p,')) return block;
    if (selector === '[contenteditable]') return editableRegion;
    // Внешний body=false не должен запрещать работу внутри innerCell=true.
    if (selector === '[contenteditable=false]') return { getAttribute: () => 'false' };
    return null;
  } };
  const texts = [' oper_', 'plan_draft_id '].map((data) => ({ nodeType: 3, data, length: data.length, parentElement: parent, parentNode: block }));
  const range = { commonAncestorContainer: block, startContainer: texts[0], startOffset: 0,
    endContainer: texts[1], endOffset: texts[1].length, intersectsNode: () => true,
    toString: () => texts.map((text) => text.data).join('') };
  const editor = { selection: { getRng: () => range }, getBody: () => block, getDoc: () => ({
    createTreeWalker: () => { let index = 0; return { nextNode: () => texts[index++] ?? null }; },
    defaultView: { getComputedStyle: (element) => ({ getPropertyValue: () => element.color ?? 'green', textDecorationLine: 'none' }) },
  }) };
  const match = selectedIdentifier(editor);
  assert.equal(match.replacement, 'operPlanDraftId');
  assert.equal(match.parts[0].start, 1);
  assert.equal(match.parts[1].end, texts[1].length - 1);
  editable = 'false';
  assert.equal(selectedIdentifier(editor), null);
  editable = 'true';
  texts[1].parentElement = { ...parent, color: 'red' };
  assert.equal(selectedIdentifier(editor), null);
});
