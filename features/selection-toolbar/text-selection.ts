import type { TinyEditor } from '../../core/types';

/** Текстовые части выделения, доступные для редактирования. Разметка не заменяется. */
export function selectedTextParts(editor: TinyEditor) {
  const range = editor.selection.getRng();
  const common = range.commonAncestorContainer;
  const walker = editor.getDoc().createTreeWalker(common, NodeFilter.SHOW_TEXT);
  let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
  const parts: { text: Text; start: number; end: number }[] = [];
  while (node) {
    const text = node as Text;
    if (range.intersectsNode(text)) {
      const start = range.startContainer === text ? range.startOffset : 0;
      const end = range.endContainer === text ? range.endOffset : text.length;
      const editable = text.parentElement?.closest('[contenteditable]');
      if (end > start && editable?.getAttribute('contenteditable') !== 'false') parts.push({ text, start, end });
    }
    node = walker.nextNode();
  }
  return parts;
}

export function toggleTextCase(editor: TinyEditor) {
  const parts = selectedTextParts(editor);
  if (!parts.length) return;
  const selected = parts.map(({ text, start, end }) => text.data.slice(start, end)).join('');
  const upper = selected !== selected.toUpperCase();
  editor.undoManager.transact(() => {
    let lastEnd = 0;
    for (const { text, start, end } of parts) {
      const value = text.data.slice(start, end);
      const replacement = upper ? value.toUpperCase() : value.toLowerCase();
      text.replaceData(start, end - start, replacement);
      lastEnd = start + replacement.length;
    }
    const range = editor.getDoc().createRange();
    range.setStart(parts[0].text, parts[0].start);
    range.setEnd(parts[parts.length - 1].text, lastEnd);
    editor.selection.setRng(range);
  });
  editor.nodeChanged();
}
