import { cells, escapeXml, findTable, normalize, parseStorage, rows, TASK_HEADERS as HEADERS, text } from '../../core/confluence-storage';
import definition from './definition';

export function historyTableOptions(values: Record<string, string> = {}) {
  const value = (key: string) => normalize(values[key] ?? definition.settings.find((field) => field.key === key)!.default);
  const heading = value('historyHeading');
  const headers = ['historyTaskHeader', 'historyStoryHeader', 'historyAnalystHeader', 'historyDescriptionHeader', 'historyVersionHeader'].map(value);
  if (headers.some((header) => !header)) throw new Error('Заполните названия всех пяти колонок таблицы истории в настройках модуля.');
  if (new Set(headers.map((header) => header.toLocaleLowerCase('ru'))).size !== headers.length) {
    throw new Error('Названия колонок таблицы истории в настройках модуля должны различаться.');
  }
  return { heading, headers };
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

export function updateHistory(parent: string, child: string, page: ChildPage, values: Record<string, string> = {}): { content: string; updated: boolean; changed: boolean } {
  const options = historyTableOptions(values);
  const from = parseStorage(child), to = parseStorage(parent);
  const sourceRows = rows(findTable(from.doc, 'Задачи', HEADERS));
  cells(sourceRows[0], 4);
  if (sourceRows.length !== 2) throw new Error('В таблице «Задачи» должна быть одна строка данных под заголовком.');
  const sourceCells = cells(sourceRows[1], 4);
  const targetTable = findTable(to.doc, options.heading, options.headers);
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
  const link = existing ? to.raw(cells(existing, 5)[4]) : `<td><ac:link><ri:page ri:content-title="${escapeXml(page.title)}" ri:space-key="${escapeXml(page.space.key)}" /><ac:plain-text-link-body><![CDATA[${version.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-link-body></ac:link></td>`;
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
  const edits = dataRows.map((row, i) => {
    const { start, end } = to.spans.get(row)!;
    return { start, end, html: entries[i].html };
  });
  if (!existing) {
    const at = dataRows.length ? to.spans.get(dataRows.at(-1)!)!.end : to.spans.get(body)!.close;
    edits.push({ start: at, end: at, html: entries.at(-1)!.html });
  }
  let content = parent;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, edit.start) + edit.html + content.slice(edit.end);
  }
  return { content, updated: !!existing, changed: content !== parent };
}
