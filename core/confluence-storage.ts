export const TASK_HEADERS = ['SA Task', 'Story', 'Ответственный аналитик', 'Описание'];
export const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const matchesText = (left: string, right: string) => normalize(left).toLocaleLowerCase('ru') === normalize(right).toLocaleLowerCase('ru');
export const text = (node: Element) => normalize(node.textContent ?? '');
export const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** XML нужен для макросов ac:/ri:. Диапазоны позволяют менять только нужную строку,
 * сохраняя исходную разметку всей остальной страницы, включая CDATA и макросы. */
export function parseStorage(source: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Неподдерживаемая разметка страницы.');
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE root [<!ENTITY nbsp "&#160;">]><root xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier">' + source + '</root>', 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Не удалось разобрать разметку страницы.');
  const elements = [...doc.documentElement.getElementsByTagName('*')];
  const spans = new Map<Element, { start: number; end: number; openEnd: number; close: number }>();
  const stack: Element[] = [];
  let index = 0;
  for (const token of source.matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\/?[\w:-]+(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
    const value = token[0], start = token.index!;
    if (value.startsWith('<!')) continue;
    if (value.startsWith('</')) {
      const span = spans.get(stack.pop()!)!;
      span.close = start;
      span.end = start + value.length;
    } else {
      const node = elements[index++];
      if (!node) throw new Error('Неподдерживаемая разметка страницы.');
      const end = start + value.length;
      spans.set(node, { start, end, openEnd: end, close: start });
      if (!value.endsWith('/>')) stack.push(node);
    }
  }
  if (index !== elements.length || stack.length) throw new Error('Неподдерживаемая разметка страницы.');
  const raw = (node: Element) => { const span = spans.get(node)!; return source.slice(span.start, span.end); };
  return { doc, spans, raw };
}

export function rows(table: Element) {
  return [...table.getElementsByTagName('tr')].filter((row) => row.closest('table') === table);
}

export function cells(row: Element, count: number) {
  const result = [...row.children].filter((node) => ['td', 'th'].includes(node.tagName));
  if (result.length !== count || result.some((cell) => ['rowspan', 'colspan'].some((attr) => Number(cell.getAttribute(attr) ?? 1) !== 1))) {
    throw new Error(`В таблице ожидается ${count} отдельных столбцов без объединения ячеек.`);
  }
  return result;
}

export function findTable(doc: Document, heading: string, headers: string[]) {
  const candidates = [...doc.getElementsByTagName('table')].filter((table) => {
    // Ближайший предшествующий заголовок, не принадлежащий вложенной таблице.
    let previousHeading = '';
    for (const node of doc.documentElement.getElementsByTagName('*')) {
      if (node === table) break;
      if (/^h[1-6]$/.test(node.tagName) && !node.closest('table')) previousHeading = text(node);
    }
    const first = rows(table)[0];
    return (!heading || matchesText(previousHeading, heading)) && first &&
      [...first.children].length === headers.length && [...first.children].every((cell, i) => matchesText(text(cell), headers[i]));
  });
  if (candidates.length !== 1) throw new Error(`Ожидается одна таблица${heading ? ` под заголовком «${heading}»` : ''} с колонками: ${headers.join(', ')}. Найдено: ${candidates.length}.`);
  return candidates[0];
}
