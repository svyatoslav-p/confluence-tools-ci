import { isRecord } from '../../core/settings';
import type { Feature, FeatureContext } from '../../core/types';
import { createClient } from './confluence';
import definition from './definition';
import { fillTasks, jiraIssueKey, planDraft } from './draft';

let running = false;
const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

function askIssueKey(title: string, column: string): string | null {
  const message = `${title}\n\nКлюч задачи Jira для колонки ${column} (можно оставить поле пустым).\nНапример PLAT-1234`;
  let invalid = false;
  for (;;) {
    const value = window.prompt(invalid ? `Проверьте формат ключа задачи.\n\n${message}` : message, '');
    if (value === null) return null;
    const key = jiraIssueKey(value);
    if (key !== null) return key;
    invalid = true;
  }
}

async function run(ctx: FeatureContext) {
  if (running) return;
  running = true;
  try {
    const parentId = meta('ajs-page-id');
    if (!parentId || !/^\d+$/.test(parentId)) throw new Error('Не удалось определить родительскую страницу.');
    const userKey = meta('ajs-remote-user-key');
    if (!userKey) throw new Error('Войдите в Confluence, чтобы указать ответственного аналитика.');
    const api = createClient(meta('ajs-context-path') ?? '');
    const [children, parent] = await Promise.all([api.list(`${parentId}/child/page`), api.read(`${parentId}?expand=space`)]);
    const { source, title } = planDraft(children.filter((page): page is Record<string, unknown> & { id: string; title: string } =>
      typeof page.id === 'string' && typeof page.title === 'string'));
    if (!isRecord(parent.space) || typeof parent.space.key !== 'string') throw new Error('Не удалось определить пространство родителя.');
    const [page, attachments] = await Promise.all([
      api.read(`${source.id}?expand=body.storage`), api.attachments(source.id), api.verifySourceAccess(source.id),
    ]);
    if (!isRecord(page.body) || !isRecord(page.body.storage) || typeof page.body.storage.value !== 'string') {
      throw new Error('Не удалось прочитать содержимое исходной страницы.');
    }

    const task = askIssueKey(title, 'SA Task');
    if (task === null) return;
    const story = askIssueKey(title, 'Story');
    if (story === null) return;
    const content = fillTasks(page.body.storage.value, { task, story }, userKey);
    // Закрытие страницы или отключение расширения во время подготовки отменяет запись.
    if (!ctx.root.host.isConnected) return;

    ctx.notify('Создаём новую версию…');
    const created = await api.create(parentId, parent.space.key, title, content);
    for (const attachment of attachments) {
      try { await api.copyAttachment(attachment, created.id); }
      catch (error) {
        console.error('[Confluence Tools CI] Копирование вложения', error);
        throw new Error(`Страница «${title}» создана (ID ${created.id}). Не удалось перенести вложение «${attachment.name}». Проверьте файлы на новой странице.`);
      }
    }
    ctx.notify(`Новая версия «${title}» создана на основе страницы «${source.title}».`, 'success');
    await new Promise<void>((resolve) => setTimeout(resolve, 2500));
    if (ctx.root.host.isConnected) location.assign(created.url);
  } finally { running = false; }
}

const feature: Feature = {
  ...definition,
  actions: [{ id: 'create', title: definition.title, description: definition.description, mode: 'view', run }],
};

export default feature;
