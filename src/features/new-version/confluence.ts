import { isRecord } from '../../core/settings';

export function createClient(contextPath: string) {
  const origin = location.origin;
  const context = new URL(`${contextPath.replace(/\/$/, '')}/`, origin);
  if (context.origin !== origin || context.username || context.password || context.search || context.hash) {
    throw new Error('Не удалось определить адрес Confluence.');
  }
  const base = new URL('rest/api/content/', context);

  async function request(url: URL, options: RequestInit = {}) {
    if (url.origin !== origin || url.username || url.password) throw new Error('Confluence вернул адрес другого сервера.');
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(30000), ...options });
    if (response.status === 401 || response.status === 403) throw new Error('Проверьте вход и права на чтение и создание страниц в Confluence.');
    if (!response.ok) throw new Error(`Confluence вернул ошибку HTTP ${response.status}.`);
    return response;
  }

  async function read(path: string) {
    const response = await request(new URL(path, base), { headers: { Accept: 'application/json' } });
    const data: unknown = await response.json();
    if (!isRecord(data)) throw new Error('Confluence вернул неполные данные.');
    return data;
  }

  async function list(path: string) {
    const results: Record<string, unknown>[] = [];
    for (let start = 0; ;) {
      const batch = await read(`${path}?limit=50&start=${start}`);
      if (!Array.isArray(batch.results) || !batch.results.every(isRecord)) throw new Error('Не удалось прочитать список страниц или вложений.');
      results.push(...batch.results);
      if (!isRecord(batch._links) || !batch._links.next) return results;
      if (!batch.results.length || batch.start !== start) throw new Error('Confluence вернул неверный номер страницы списка.');
      start += batch.results.length;
    }
  }

  async function verifySourceAccess(id: string) {
    const { restrictions } = await read(`${id}/restriction/byOperation/read?expand=restrictions.user,restrictions.group`);
    if (!isRecord(restrictions) || ![restrictions.user, restrictions.group].every((item) => isRecord(item) && typeof item.size === 'number')) {
      throw new Error('Не удалось проверить ограничения просмотра исходной страницы.');
    }
    if ([restrictions.user, restrictions.group].some((item) => isRecord(item) && Number(item.size) > 0)) {
      throw new Error('Просмотр исходной страницы ограничен. Создайте копию через Confluence с нужными правами доступа.');
    }
  }

  async function attachments(id: string) {
    return (await list(`${id}/child/attachment`)).map((item) => {
      if (typeof item.title !== 'string' || !isRecord(item._links) || typeof item._links.download !== 'string') {
        throw new Error('Confluence не вернул название или ссылку для вложения.');
      }
      // Относительные ссылки API начинаются от корня установки Confluence.
      const download = item._links.download;
      const url = new URL(download.startsWith('/download/') ? download.slice(1) : download, context);
      if (url.origin !== origin || url.username || url.password) throw new Error('Вложение находится на другом сервере.');
      return { name: item.title, url };
    });
  }

  async function create(parentId: string, spaceKey: string, title: string, content: string) {
    const response = await request(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ type: 'page', title, space: { key: spaceKey }, ancestors: [{ id: parentId }],
        body: { storage: { value: content, representation: 'storage' } } }) });
    const page: unknown = await response.json();
    if (!isRecord(page) || typeof page.id !== 'string' || !/^\d+$/.test(page.id)) {
      throw new Error('Confluence не вернул ID созданной страницы. Проверьте список дочерних страниц перед повтором.');
    }
    return { id: page.id, url: new URL(`pages/viewpage.action?pageId=${page.id}`, context).href };
  }

  async function copyAttachment(attachment: { name: string; url: URL }, pageId: string) {
    const file = await request(attachment.url);
    const form = new FormData();
    form.append('file', await file.blob(), attachment.name);
    await request(new URL(`${pageId}/child/attachment`, base), {
      method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form,
    });
  }

  return { read, list, verifySourceAccess, attachments, create, copyAttachment };
}
