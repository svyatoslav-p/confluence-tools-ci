import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

test('смена регистра сохраняет части выделения, оформление, ссылки и учитывает изменение длины Unicode', () => {
  const { toggleTextCase } = loadTs('features/selection-toolbar/text-selection.ts', { globals: {
    Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
  } });
  const parent = { style: 'color:green', href: '/page', closest: () => null };
  const texts = ['до Привет ', 'world ß после'].map((data) => ({ nodeType: 3, data, get length() { return this.data.length; },
    parentElement: parent, replaceData(start, length, value) { this.data = this.data.slice(0, start) + value + this.data.slice(start + length); } }));
  let range = { commonAncestorContainer: {}, startContainer: texts[0], startOffset: 3, endContainer: texts[1], endOffset: 7, intersectsNode: () => true };
  let transactions = 0;
  const editor = {
    selection: { getRng: () => range, setRng: (value) => { range = { ...range, ...value }; } },
    getDoc: () => ({ createTreeWalker: () => { let i = 0; return { nextNode: () => texts[i++] ?? null }; },
      createRange: () => ({ setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; } }) }),
    undoManager: { transact: (callback) => { transactions++; callback(); } }, nodeChanged() {},
  };
  toggleTextCase(editor);
  assert.equal(texts[0].data, 'до ПРИВЕТ ');
  assert.equal(texts[1].data, 'WORLD SS после');
  assert.equal(range.endOffset, 8);
  toggleTextCase(editor);
  assert.equal(texts[0].data, 'до привет ');
  assert.equal(texts[1].data, 'world ss после');
  assert.equal(parent.style, 'color:green');
  assert.equal(parent.href, '/page');
  assert.equal(transactions, 2);
});
