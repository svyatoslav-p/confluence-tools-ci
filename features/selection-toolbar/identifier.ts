import type { TinyEditor } from '../../core/types';
import { selectedTextParts } from './text-selection';

/** Только обратимые имена. Соседние заглавные буквы трактовались бы как аббревиатура. */
export function toggleIdentifier(name: string): string | null {
  if (/^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+$/.test(name)) {
    const camel = name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return /[A-Z]{2}/.test(camel) ? null : camel;
  }
  if (!/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(name) || /[A-Z]{2}/.test(name)) return null;
  return name.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
}

// Ищем соседний символ и через границу строчной разметки, но не через перенос строки.
function adjacentCharacter(text: Text, forward: boolean): string {
  const block = text.parentElement?.closest('p,li,td,th,div,h1,h2,h3,h4,h5,h6,pre,blockquote,body');
  let node: Node | null = text;
  while (node && node !== block) {
    const sibling: ChildNode | null = forward ? node.nextSibling : node.previousSibling;
    if (!sibling) { node = node.parentNode; continue; }
    node = sibling;
    while (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).matches('br,img,hr,[contenteditable=false],p,li,div,table,ol,ul')) return '';
      const child: ChildNode | null = forward ? node.firstChild : node.lastChild;
      if (!child) break;
      node = child;
    }
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue) return forward ? node.nodeValue[0] : node.nodeValue.slice(-1);
  }
  return '';
}

function textStyle(text: Text, editor: TinyEditor): string {
  const style = editor.getDoc().defaultView!.getComputedStyle(text.parentElement!);
  const properties = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
    'font-variant', 'text-transform', 'letter-spacing', 'vertical-align'];
  const decorations: string[] = [];
  for (let parent = text.parentElement; parent; parent = parent.parentElement) {
    decorations.push(editor.getDoc().defaultView!.getComputedStyle(parent).textDecorationLine);
    if (parent === editor.getBody()) break;
  }
  return JSON.stringify([properties.map((property) => style.getPropertyValue(property)), decorations.filter((value) => value !== 'none')]);
}

export function selectedIdentifier(editor: TinyEditor) {
  const range = editor.selection.getRng();
  const selectedText = range.toString();
  const name = selectedText.trim();
  const replacement = toggleIdentifier(name);
  if (!replacement) return null;

  const parts = selectedTextParts(editor);
  if (!parts.length || parts.map(({ text, start, end }) => text.data.slice(start, end)).join('') !== selectedText) return null;
  let leading = selectedText.length - selectedText.trimStart().length;
  let trailing = selectedText.length - selectedText.trimEnd().length;
  for (const part of parts) {
    const skip = Math.min(leading, part.end - part.start);
    part.start += skip;
    leading -= skip;
  }
  for (const part of [...parts].reverse()) {
    const skip = Math.min(trailing, part.end - part.start);
    part.end -= skip;
    trailing -= skip;
  }
  const nameParts = parts.filter((part) => part.end > part.start);
  if (!nameParts.length) return null;
  const first = nameParts[0];
  const last = nameParts[nameParts.length - 1];
  const before = first.start ? first.text.data[first.start - 1] : adjacentCharacter(first.text, false);
  const after = last.end < last.text.length ? last.text.data[last.end] : adjacentCharacter(last.text, true);
  if (/[\p{L}\p{N}_$]/u.test(before + after)) return null;
  const link = first.text.parentElement?.closest('a');
  const style = textStyle(first.text, editor);
  const block = first.text.parentElement?.closest('p,li,td,th,div,h1,h2,h3,h4,h5,h6,pre,blockquote,body');
  for (const part of nameParts.slice(1)) {
    if (part.text.parentElement?.closest('a') !== link || textStyle(part.text, editor) !== style ||
      part.text.parentElement?.closest('p,li,td,th,div,h1,h2,h3,h4,h5,h6,pre,blockquote,body') !== block) return null;
  }
  return { parts: nameParts, replacement };
}

export function convertIdentifier(editor: TinyEditor) {
  const match = selectedIdentifier(editor);
  if (!match) return;
  const { parts, replacement } = match;
  const { text, start, end } = parts[0];
  editor.undoManager.transact(() => {
    for (const part of parts.slice(1)) part.text.deleteData(part.start, part.end - part.start);
    text.replaceData(start, end - start, replacement);
    const result = editor.getDoc().createRange();
    result.setStart(text, start);
    result.setEnd(text, start + replacement.length);
    editor.selection.setRng(result);
  });
  editor.nodeChanged();
}
