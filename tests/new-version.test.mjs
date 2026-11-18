import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const { planDraft, jiraIssueKey } = loadTs('features/new-version/draft.ts');
const page = (id, title) => ({ id, title });

test('следующая версия выбирается по числовым частям и учитывает существующие draft', () => {
  const latest = page('3', 'draft [v2.10] Спецификация');
  const result = planDraft([page('1', '[v1.99] Спецификация'), page('2', '[v2.9] Спецификация'), latest,
    page('4', 'Заметки к [v9.0]')]);
  assert.equal(result.source, latest);
  assert.equal(result.title, 'draft [v2.11] Спецификация');
  assert.throws(() => planDraft([page('4', 'Заметки')]), /Нет дочерних страниц/);
});

test('ключ Jira можно пропустить, регистр букв приводится к верхнему', () => {
  assert.equal(jiraIssueKey('  '), '');
  assert.equal(jiraIssueKey(' plat-19699 '), 'PLAT-19699');
  for (const value of ['PLAT', 'key = PLAT-1234', 'https://jira.example.org/browse/PLAT-1234', '<PLAT>-1234']) {
    assert.equal(jiraIssueKey(value), null);
  }
});

test('REST-клиент читает все страницы списка и проверяет ограничения исходника перед копированием', async () => {
  const paths = [];
  const { createClient } = loadTs('features/new-version/confluence.ts', { globals: {
    location: { origin: 'https://example.org' }, AbortSignal,
    async fetch(url) {
      paths.push(url.pathname);
      const start = Number(url.searchParams.get('start'));
      const data = url.pathname.endsWith('/read') ? { restrictions: { user: { size: 1 }, group: { size: 0 } } }
        : { start, results: [{ id: String(start + 1) }], _links: start === 0 ? { next: '/next' } : {} };
      return { ok: true, json: async () => data };
    },
  } });
  const api = createClient('/wiki');
  assert.equal((await api.list('5/child/page')).length, 2);
  assert.deepEqual(paths, ['/wiki/rest/api/content/5/child/page', '/wiki/rest/api/content/5/child/page']);
  await assert.rejects(api.verifySourceAccess('1'), /Просмотр исходной страницы ограничен/);
});
