import { cells, escapeXml, findTable, parseStorage, rows, TASK_HEADERS } from '../../core/confluence-storage';

interface Page { id: string; title: string }

export function planDraft(pages: Page[]) {
  const versions = pages.flatMap((page) => {
    const match = /^(?:draft\s+)?\[v(\d+)\.(\d+)\]\s+(.+)$/i.exec(page.title);
    if (!match || !/^\d+$/.test(page.id)) return [];
    return [{ page, major: BigInt(match[1]), minor: BigInt(match[2]), name: match[3] }];
  });
  versions.sort((a, b) => {
    if (a.major !== b.major) return a.major > b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
    // При одинаковом номере предпочитаем страницу без префикса draft.
    return Number(/^draft\s/i.test(a.page.title)) - Number(/^draft\s/i.test(b.page.title));
  });
  const latest = versions[0];
  if (!latest) throw new Error('Нет дочерних страниц с версией в формате [vX.X]. Запустите команду с родительской страницы спецификации.');
  return { source: latest.page, title: `draft [v${latest.major}.${latest.minor + 1n}] ${latest.name}` };
}

export function jiraIssueKey(value: string): string | null {
  const key = value.trim();
  return !key || /^[a-z][a-z0-9_]*-\d+$/i.test(key) ? key.toUpperCase() : null;
}

function jiraServer(cell: Element) {
  for (const macro of cell.getElementsByTagName('ac:structured-macro')) {
    if (macro.getAttribute('ac:name')?.toLowerCase() !== 'jira') continue;
    const parameters = [...macro.children].filter((node) => node.tagName === 'ac:parameter');
    const settings = ['server', 'serverId'].flatMap((name) => {
      const value = parameters.find((node) => node.getAttribute('ac:name') === name)?.textContent?.trim();
      return value ? [jiraParameter(name, value)] : [];
    });
    if (settings.length) return settings.join('');
  }
  return '';
}

const emptyCell = '<p><br /></p>';

function jiraParameter(name: string, value: string) {
  return `<ac:parameter ac:name="${name}">${escapeXml(value)}</ac:parameter>`;
}

function jiraMacro(key: string, server: string) {
  if (!key) return emptyCell;
  return `<div class="content-wrapper"><p><ac:structured-macro ac:name="jira" ac:schema-version="1">${server}${jiraParameter('key', key)}</ac:structured-macro></p></div>`;
}

export function fillTasks(content: string, issues: { task: string; story: string }, userKey: string) {
  const { doc, spans, raw } = parseStorage(content);
  const taskRows = rows(findTable(doc, 'Задачи', TASK_HEADERS));
  cells(taskRows[0], 4);
  if (taskRows.length !== 2) throw new Error('В таблице «Задачи» должна быть одна строка данных под заголовком.');
  const dataCells = cells(taskRows[1], 4);
  const taskServer = jiraServer(dataCells[0]);
  const storyServer = jiraServer(dataCells[1]);
  const replacements = [
    jiraMacro(issues.task, taskServer || storyServer),
    jiraMacro(issues.story, storyServer || taskServer),
    `<div class="content-wrapper"><p><ac:link><ri:user ri:userkey="${escapeXml(userKey)}" /></ac:link></p></div>`,
    emptyCell,
  ];
  for (let i = replacements.length - 1; i >= 0; i--) {
    const cell = dataCells[i];
    const { start, end, openEnd, close } = spans.get(cell)!;
    if (close < openEnd) {
      const opening = raw(cell).replace(/\s*\/>$/, '>');
      content = content.slice(0, start) + opening + replacements[i] + `</${cell.tagName}>` + content.slice(end);
    } else {
      content = content.slice(0, openEnd) + replacements[i] + content.slice(close);
    }
  }
  return content;
}
