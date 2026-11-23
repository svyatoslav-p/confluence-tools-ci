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
    formatter: { register() {}, remove: (...args) => calls.push(['remove', ...args]), apply: (...args) => calls.push(args) } };
  const { default: feature } = loadTs('features/selection-toolbar/index.ts', { globals: {
    window, document, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_POSITION_FOLLOWING: 4 }, NodeFilter: { SHOW_TEXT: 4 },
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
    assert.deepEqual(f.toolbar.children.slice(0, -1).map((button) => button.getAttribute('aria-label')),
      ['Применить правки', 'Удалено', 'Добавлено']);
    assert.equal(f.toolbar.children.at(-1).className, 'st-more');
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

test('«Добавлено» форматирует только части выделения между ссылками и восстанавливает выделение', () => {
  const f = fixture();
  try {
    const links = [{ start: 3, end: 6 }, { start: 9, end: 12 }];
    f.body.querySelectorAll = (selector) => selector === 'a[href]' ? links : [];
    const text = 'до abc и xyz после';
    const makeRange = (start, end) => ({
      start, end, commonAncestorContainer: f.body,
      get collapsed() { return this.start === this.end; },
      cloneRange() { return makeRange(this.start, this.end); },
      intersectsNode(link) { return link.start < this.end && link.end > this.start; },
      setEndBefore(link) { this.end = link.start; this.start = Math.min(this.start, this.end); },
      setStartAfter(link) { this.start = link.end; this.end = Math.max(this.start, this.end); },
      toString() { return text.slice(this.start, this.end); },
    });
    const original = makeRange(4, text.length);
    let current = original;
    f.selection.getRng = () => current;
    f.selection.setRng = (range) => { current = range; };
    f.selection.getBookmark = () => current;
    f.selection.moveToBookmark = f.selection.setRng;
    const formatted = [];
    f.editor.formatter.apply = (name, { value }) => formatted.push([name, value, current.toString()]);
    input(f.toolbar.children.find((button) => button.getAttribute('aria-label') === 'Добавлено'), 'click');
    assert.deepEqual(formatted.map((call) => call[2]), [' после', ' и ']);
    assert.ok(formatted.every(([name, value]) => name === 'forecolor' && value.includes('#1F845A')));
    assert.equal(current, original);
  } finally { f.cleanup(); }
});

test('стандартный стиль из меню снимает зачёркивание, восстанавливает цвет ссылок и удаляет служебные метки', () => {
  const f = fixture(true, { showCase: 'false' });
  try {
    const span = new Element('span');
    span.setAttribute('data-ci-default-text', 'true');
    span.setAttribute('style', 'color: var(--ds-text, #172B4D);');
    const link = new Element('a');
    link.setAttribute('href', 'https://example.com');
    link.getAttribute = (name) => name === 'style' ? `color: ${link.style.color};` : link.attributes.get(name) ?? null;
    span.querySelectorAll = () => [link];
    f.body.querySelectorAll = () => [span];
    const more = f.toolbar.children.at(-1);
    const [trigger, menu] = more.children;
    more.getBoundingClientRect = () => ({ left: 150, right: 180, top: 100 });
    menu.getBoundingClientRect = () => ({ width: 160, height: 90 });
    assert.equal(menu.hidden, true);
    input(trigger, 'click');
    assert.equal(menu.hidden, false);
    const action = menu.children[0];
    assert.equal(action.getAttribute('aria-label'), 'Стиль по умолчанию');
    input(action, 'click');
    assert.equal(menu.hidden, true);
    assert.deepEqual(f.calls.map((args) => args[0]), ['remove', 'ci-default-text']);
    assert.equal(f.calls[0][1], 'strikethrough');
    assert.equal(link.style.color, 'var(--ds-link, #0052CC)');
    assert.equal(link.getAttribute('href'), 'https://example.com');
    assert.equal(link.getAttribute('data-mce-style'), link.getAttribute('style'));
    assert.equal(span.getAttribute('data-ci-default-text'), null);
  } finally { f.cleanup(); }
});

test('«Применить правки» удаляет только выбранную часть красного зачёркнутого текста и сбрасывает стиль', () => {
  const f = fixture(true, { redColor: '#800080' });
  try {
    const strike = new Element('strike');
    strike.style.textDecorationLine = 'line-through';
    const red = new Element('span');
    red.style.color = '#800080';
    strike.append(red);
    f.body.append(strike);
    const makeText = (data, parentElement) => ({
      data, parentElement, get length() { return this.data.length; },
      deleteData(start, count) { this.data = this.data.slice(0, start) + this.data.slice(start + count); },
    });
    const marked = makeText('keepdrop', red);
    const struckOnly = makeText('struck', strike);
    const plainRed = new Element('span');
    plainRed.style.color = '#800080';
    f.body.append(plainRed);
    const redOnly = makeText('red', plainRed);
    f.editorDoc.defaultView.getComputedStyle = (node) => ({ textDecorationLine: 'none', ...node.style });
    f.editorDoc.createTreeWalker = () => {
      const nodes = [marked, struckOnly, redOnly][Symbol.iterator]();
      return { nextNode: () => nodes.next().value };
    };
    f.range.commonAncestorContainer = f.body;
    f.range.startContainer = marked;
    f.range.startOffset = 4;
    f.selection.setRng = () => {};
    let transactions = 0;
    f.editor.undoManager.transact = (action) => { transactions++; action(); };
    input(f.toolbar.children.find((button) => button.getAttribute('aria-label') === 'Применить правки'), 'click');
    assert.equal(marked.data, 'keep');
    assert.equal(struckOnly.data, 'struck');
    assert.equal(redOnly.data, 'red');
    assert.deepEqual(f.calls.map(([name]) => name), ['remove', 'ci-default-text']);
    assert.equal(transactions, 1);
  } finally { f.cleanup(); }
});

test('«Применить правки» убирает текст и перенос во всех отмеченных TinyMCE ячейках', () => {
  const makeCell = (deleted, kept) => {
    const cell = new Element('td');
    cell.closest = (selector) => selector.split(', ').includes('td') ? cell : null;
    cell.contains = (node) => node === cell || cell.children.includes(node);
    cell.style = { color: '#c9372c', textDecorationLine: 'line-through' };
    cell.hasChildNodes = () => cell.children.length > 0;
    const newline = new Element('br');
    newline.closest = cell.closest;
    const marked = {
      nodeType: 3, data: deleted, get length() { return this.data.length; },
      compareDocumentPosition: () => 4,
      deleteData() { this.data = ''; },
      remove() { cell.children = cell.children.filter((node) => node !== this); },
    };
    const remaining = { data: kept };
    cell.append(marked, newline, remaining);
    cell.querySelectorAll = (selector) => selector.startsWith('br') ? [newline] : [];
    return { cell, marked, remaining };
  };
  const f = fixture();
  try {
    const first = makeCell('false', 'true');
    const last = makeCell('нет', 'да');
    const outside = makeCell('keep', 'outside');
    f.body.append(first.cell, last.cell, outside.cell);
    // Браузерный Range содержит только текст последней ячейки, как при выделении мышью.
    f.range.commonAncestorContainer = last.marked;
    f.body.querySelectorAll = (selector) => selector.includes('[data-mce-selected]') ? [first.cell, last.cell] : [];
    f.editorDoc.createTreeWalker = (root) => {
      const nodes = (root.children ?? []).filter((node) => node.nodeType === 3)[Symbol.iterator]();
      return { nextNode: () => nodes.next().value };
    };
    f.editorDoc.defaultView.getComputedStyle = (node) => ({ textDecorationLine: 'none', ...node.style });
    f.editorDoc.createRange = () => ({
      selectNodeContents(block) { this.commonAncestorContainer = block; },
      intersectsNode: () => true,
      setEndBefore(node) { this.end = node; },
      cloneContents() {
        const { children } = this.commonAncestorContainer;
        const textContent = children.slice(0, children.indexOf(this.end)).map((node) => node.data).join('');
        return { textContent, querySelector: () => null };
      },
      deleteContents() {},
    });
    f.selection.setRng = () => {};
    input(f.toolbar.children.find((button) => button.getAttribute('aria-label') === 'Применить правки'), 'click');
    assert.deepEqual(first.cell.children, [first.remaining]);
    assert.deepEqual(last.cell.children, [last.remaining]);
    assert.equal(outside.marked.data, 'keep');
    assert.equal(outside.cell.children.length, 3);
  } finally { f.cleanup(); }
});

test('скрытые кнопки сохраняют горячие клавиши, пустая панель не появляется', async () => {
  const f = fixture(true, { showDefault: 'false', showApplyEdits: 'false', showRed: 'false', showGreen: 'false', showYellow: 'false', showCase: 'false', showTextCase: 'false', hotkeyDefault: 'Alt+KeyB' });
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
  const f = fixture(true, { showApplyEdits: 'false', showRed: 'false', showYellow: 'false', showCase: 'false', showTextCase: 'false', hotkeyDefault: 'Alt+KeyN' });
  try {
    const [added, more] = f.toolbar.children;
    assert.equal(added.getAttribute('aria-label'), 'Добавлено');
    assert.deepEqual(more.children[1].children.map((button) => button.getAttribute('aria-label')), ['Стиль по умолчанию']);
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
