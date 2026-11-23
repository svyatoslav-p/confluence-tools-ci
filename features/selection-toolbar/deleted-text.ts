import type { TinyEditor } from '../../core/types';
import { selectedTextParts } from './text-selection';

const INLINE_WRAPPERS = 'a, b, code, del, em, font, i, mark, s, small, span, strike, strong, sub, sup, u';
const LIST_CONTENT = `:not(${INLINE_WRAPPERS}, br, div, p), [contenteditable="false"], [data-macro-name]`;

/** Удаляет только выделенные символы, которые видны красными и зачёркнутыми. */
export function removeDeletedText(editor: TinyEditor, colors: string[]) {
  const parts = selectedTextParts(editor);
  if (!parts.length) return;

  const body = editor.getBody();
  const doc = editor.getDoc();
  const view = doc.defaultView!;
  const probe = doc.createElement('span');
  body.append(probe);
  const red = new Set<string>();
  try {
    for (const color of colors) {
      probe.style.color = '';
      probe.style.color = color;
      if (probe.style.color) red.add(view.getComputedStyle(probe).color);
    }
  } finally {
    probe.remove();
  }

  const deleted = parts.filter(({ text }) => {
    const parent = text.parentElement;
    if (!parent || !red.has(view.getComputedStyle(parent).color)) return false;
    // Зачёркивание распространяется на потомков без наследования CSS-свойства.
    for (let node: HTMLElement | null = parent; node && node !== body; node = node.parentElement) {
      if (view.getComputedStyle(node).textDecorationLine.includes('line-through')) return true;
    }
    return false;
  });
  if (!deleted.length) return;

  const range = editor.selection.getRng().cloneRange();
  const items = new Set<HTMLLIElement>();
  for (const { text, start, end } of deleted) {
    const parent = text.parentElement;
    const item = parent?.closest('li');
    if (item) items.add(item);
    text.deleteData(start, end - start);
    if (text.length) continue;
    text.remove();
    for (let node = parent; node && !node.hasChildNodes() && node.matches(INLINE_WRAPPERS);) {
      const wrapper = node;
      node = node.parentElement;
      wrapper.remove();
    }
  }

  // Сначала удаляем пустые вложенные пункты. Если в подсписке есть текст или макросы,
  // оставляем его на прежнем уровне вместе с родительским пунктом.
  const innermostFirst = [...items].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1,
  );
  for (const item of innermostFirst) {
    if (item.textContent?.trim() || item.querySelector(LIST_CONTENT)) continue;
    const list = item.parentElement;
    if (!list?.matches('ul, ol')) continue;
    item.remove();
    if (!list.children.length) list.remove();
  }
  editor.selection.setRng(range);
}
