const HEADERS = ['SA Task', 'Story', 'Ответственный аналитик', 'Описание'];
const text = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ').trim();
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** XML нужен для макросов ac:/ri:. Диапазоны позволяют менять только нужную строку,
 * сохраняя исходную разметку всей остальной страницы, включая CDATA и макросы. */
function parseStorage(source: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Неподдерживаемая разметка страницы.');
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE root [<!ENTITY nbsp "&#160;">]><root xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier">' + source + '</root>', 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Не удалось разобрать разметку страницы.');
  const elements = [...doc.documentElement.getElementsByTagName('*')];
  const spans = new Map<Element, { start: number; end: number; close: number }>();
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
      spans.set(node, { start, end: start + value.length, close: start });
      if (!value.endsWith('/>')) stack.push(node);
    }
  }
  if (index !== elements.length || stack.length) throw new Error('Неподдерживаемая разметка страницы.');
  const raw = (node: Element) => { const span = spans.get(node)!; return source.slice(span.start, span.end); };
  return { doc, spans, raw };
}

function rows(table: Element) {
  return [...table.getElementsByTagName('tr')].filter((row) => row.closest('table') === table);
}

function cells(row: Element, count: number) {
  const result = [...row.children].filter((node) => ['td', 'th'].includes(node.tagName));
  if (result.length !== count || result.some((cell) => ['rowspan', 'colspan'].some((attr) => Number(cell.getAttribute(attr) ?? 1) !== 1))) {
    throw new Error(`В таблице ожидается ${count} отдельных столбцов без объединения ячеек.`);
  }
  return result;
}

function findTable(doc: Document, heading: string, headers: string[]) {
  const candidates = [...doc.getElementsByTagName('table')].filter((table) => {
    // Ближайший предшествующий заголовок, не принадлежащий вложенной таблице.
    let previousHeading = '';
    for (const node of doc.documentElement.getElementsByTagName('*')) {
      if (node === table) break;
      if (/^h[1-6]$/.test(node.tagName) && !node.closest('table')) previousHeading = text(node);
    }
    const first = rows(table)[0];
    return previousHeading === heading && first &&
      [...first.children].length === headers.length && [...first.children].every((cell, i) => text(cell) === headers[i]);
  });
  if (candidates.length !== 1) throw new Error(`Ожидается одна таблица «${heading}» с колонками: ${headers.join(', ')}. Найдено: ${candidates.length}.`);
  return candidates[0];
}

export interface ChildPage { id: string; title: string; space: { key: string } }

function versionParts(value: string): number[] | null {
  const match = /^\s*\[?v?(\d+(?:\.\d+)*)(?=\]|\s|$)/i.exec(value);
  if (!match) return null;
  const parts = match[1].split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

/** Неизвестные версии идут в конце; равные номера сохраняют исходный порядок. */
export function compareHistoryVersions(left: string, right: string): number {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function rowVersion(row: Element): string {
  const last = cells(row, 5)[4];
  const label = text(last);
  if (versionParts(label)) return label;
  return [...last.getElementsByTagName('ri:page')].map((link) => link.getAttribute('ri:content-title') ?? '')
    .find((title) => versionParts(title)) ?? label;
}

export function updateHistory(parent: string, child: string, page: ChildPage): { content: string; updated: boolean; changed: boolean } {
  const from = parseStorage(child), to = parseStorage(parent);
  const sourceRows = rows(findTable(from.doc, 'Задачи', HEADERS));
  cells(sourceRows[0], 4);
  if (sourceRows.length !== 2) throw new Error('В таблице «Задачи» должна быть одна строка данных под заголовком.');
  const sourceCells = cells(sourceRows[1], 4);
  const targetTable = findTable(to.doc, 'История', [...HEADERS, 'Версия']);
  const targetRows = rows(targetTable);
  cells(targetRows[0], 5);
  const matches = targetRows.slice(1).filter((row) => {
    const last = cells(row, 5)[4];
    return [...last.getElementsByTagName('ri:page')].some((link) =>
      link.getAttribute('ri:content-id') === page.id || (link.getAttribute('ri:content-title') === page.title &&
        (!link.hasAttribute('ri:space-key') || link.getAttribute('ri:space-key') === page.space.key))) ||
      [...last.getElementsByTagName('a')].some((link) => {
        const url = new URL(link.getAttribute('href') ?? '', location.href);
        return url.origin === location.origin && (url.searchParams.get('pageId') === page.id || new RegExp(`/pages/${page.id}(?:/|$)`).test(url.pathname));
      });
  });
  if (matches.length > 1) throw new Error('В «Истории» несколько строк для этой страницы. Удалите дубликаты перед обновлением.');
  const existing = matches[0];
  const version = page.title.match(/^\[?v\d+(?:\.\d+)*\]?/i)?.[0] ?? page.title;
  const link = existing ? to.raw(cells(existing, 5)[4]) : `<td><ac:link><ri:page ri:content-title="${escape(page.title)}" ri:space-key="${escape(page.space.key)}" /><ac:plain-text-link-body><![CDATA[${version.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-link-body></ac:link></td>`;
  const next = sourceCells.map(from.raw);
  const dataRows = targetRows.slice(1);
  const body = dataRows[0]?.parentElement ?? [...targetTable.children].find((node) => node.tagName === 'tbody') ?? targetTable;
  if (!['table', 'tbody'].includes(body.tagName) || dataRows.some((row) => row.parentElement !== body)) {
    throw new Error('Строки «Истории» должны находиться в одной секции таблицы.');
  }
  const entries = dataRows.map((row) => {
    let html = to.raw(row);
    if (row === existing) {
      // Сохраняем тег строки, её атрибуты и пятую ячейку.
      const rowStart = to.spans.get(row)!.start;
      const first = to.spans.get(cells(row, 5)[0])!, last = to.spans.get(cells(row, 5)[3])!;
      html = html.slice(0, first.start - rowStart) + next.join('') + html.slice(last.end - rowStart);
    }
    return { html, version: rowVersion(row) };
  });
  if (!existing) entries.push({ html: `<tr>${next.join('')}${link}</tr>`, version: page.title });
  entries.sort((a, b) => compareHistoryVersions(a.version, b.version));

  // Переставляем исходные строки целиком: заголовок, атрибуты таблицы, промежутки
  // между строками и всё вне этой таблицы остаются в исходной разметке.
  const edits = dataRows.map((row, i) => ({ ...to.spans.get(row)!, html: entries[i].html }));
  if (!existing) {
    const at = dataRows.length ? to.spans.get(dataRows.at(-1)!)!.end : to.spans.get(body)!.close;
    edits.push({ start: at, end: at, close: at, html: entries.at(-1)!.html });
  }
  let content = parent;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, edit.start) + edit.html + content.slice(edit.end);
  }
  return { content, updated: !!existing, changed: content !== parent };
}
