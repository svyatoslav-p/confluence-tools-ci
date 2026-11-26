import type { TinyEditor } from '../../core/types';
import { selectedTextParts } from './text-selection';

const INLINE_WRAPPERS = 'a, b, code, del, em, font, i, mark, s, small, span, strike, strong, sub, sup, u';
const LIST_CONTENT = `:not(${INLINE_WRAPPERS}, br, div, p), [contenteditable="false"], [data-macro-name]`;
const LINE_BLOCK = 'p, div, li, td, th';
const CELL = 'td, th';
const ATOMIC_CONTENT = '[contenteditable="false"], [data-macro-name], a[id], a[name]';
const LINE_CONTENT = `:not(${INLINE_WRAPPERS}, br), ${ATOMIC_CONTENT}`;

/** Запоминает затронутые строки ячеек, пока символы и разделители ещё на месте. */
function trackTableLines(doc: Document, deleted: { text: Text }[]) {
  const blocks = new Map<Element, { breaks: Element[]; lines: Set<number> }>();
  for (const { text } of deleted) {
    const block = text.parentElement?.closest(LINE_BLOCK);
    const cell = block?.closest(CELL);
    if (!block || !cell || cell.contains(block.closest('li')) || cell.contains(block.closest(ATOMIC_CONTENT))) continue;

    let entry = blocks.get(block);
    if (!entry) {
      const breaks = [...block.querySelectorAll('br:not([data-mce-bogus])')].filter((br) =>
        br.closest(LINE_BLOCK) === block && !cell.contains(br.closest(ATOMIC_CONTENT)),
      );
      entry = { breaks, lines: new Set() };
      blocks.set(block, entry);
    }
    const index = entry.breaks.findIndex((br) => text.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_FOLLOWING);
    entry.lines.add(index === -1 ? entry.breaks.length : index);
  }

  return () => {
    for (const [block, { breaks, lines }] of blocks) {
      // Строки уже идут по порядку выделенного текста. Последняя пустая строка
      // убирает ближайший предыдущий перенос, если следующих больше нет.
      for (const index of lines) {
        const after = breaks[index];
        const before = breaks.slice(0, index).reverse().find((br) => block.contains(br));
        const line = doc.createRange();
        line.selectNodeContents(block);
        if (before) line.setStartAfter(before);
        if (after) line.setEndBefore(after);
        const content = line.cloneContents();
        if (content.textContent?.trim() || content.querySelector(LINE_CONTENT)) continue;

        line.deleteContents();
        const separator = after ?? before;
        if (separator) separator.remove();
        else if (!block.matches(CELL)) block.remove();
      }
    }
  };
}

/** Удаляет только выделенные символы, которые видны красными и зачёркнутыми. */
export function removeDeletedText(editor: TinyEditor, colors: string[], cells: HTMLTableCellElement[]) {
  const doc = editor.getDoc();
  const parts = cells.length ? cells.flatMap((cell) => {
    const range = doc.createRange();
    range.selectNodeContents(cell);
    return selectedTextParts(editor, range);
  }) : selectedTextParts(editor);
  if (!parts.length) return;

  const body = editor.getBody();
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

  const removeEmptyTableLines = trackTableLines(doc, deleted);
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
  removeEmptyTableLines();
  editor.selection.setRng(range);
}
