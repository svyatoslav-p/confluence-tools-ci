import type { Feature } from '../../core/types';
import definition from './definition';
import { updateHistory } from './tables';

let running = false;

const feature: Feature = {
  ...definition,
  actions: [{
    id: 'add-history', title: definition.title, description: definition.description, mode: 'view',
    async run(ctx) {
      if (running) { ctx.notify('Добавление истории уже выполняется.'); return; }
      const id = document.querySelector<HTMLMetaElement>('meta[name="ajs-page-id"]')?.content;
      const contextPath = document.querySelector<HTMLMetaElement>('meta[name="ajs-context-path"]')?.content ?? '';
      if (!id || !/^\d+$/.test(id)) throw new Error('Не удалось определить текущую страницу.');
      // Только текущий сервер, включая установки Confluence в подкаталоге.
      const base = new URL(contextPath.replace(/\/$/, '') + '/rest/api/content/', location.origin);
      if (base.origin !== location.origin) throw new Error('Некорректный адрес Confluence.');
      async function request(path: string, options: RequestInit = {}) {
        const response = await fetch(new URL(path, base), { ...options, credentials: 'same-origin', redirect: 'error',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) {
          if (response.status === 409) throw new Error('Родительскую страницу изменили одновременно с вами. Повторите действие.');
          if ([401, 403].includes(response.status)) throw new Error('Нет доступа к странице или права на изменение родителя. Проверьте вход в Confluence.');
          throw new Error(`Confluence вернул ошибку HTTP ${response.status}.`);
        }
        return response.json();
      }
      running = true;
      try {
        ctx.notify('Добавляем запись в историю…');
        const child = await request(`${id}?expand=ancestors,body.storage,space`);
        const parentId = child.ancestors?.at(-1)?.id;
        if (!parentId || !/^\d+$/.test(parentId)) throw new Error('У страницы нет родителя.');
        const parent = await request(`${parentId}?expand=body.storage,version`);
        if (typeof parent.body?.storage?.value !== 'string' || typeof child.body?.storage?.value !== 'string' ||
          !Number.isInteger(parent.version?.number) || typeof parent.title !== 'string' || typeof child.title !== 'string' || typeof child.space?.key !== 'string') {
          throw new Error('Confluence вернул неполные данные страницы.');
        }
        const result = updateHistory(parent.body.storage.value, child.body.storage.value, child);
        if (!result.changed) { ctx.notify('История уже актуальна.', 'success'); return; }
        await request(parentId, { method: 'PUT', body: JSON.stringify({ type: 'page', title: parent.title,
          version: { number: parent.version.number + 1, message: 'Добавить в историю: ' + child.title },
          body: { storage: { value: result.content, representation: 'storage' } } }) });
        ctx.notify(result.updated ? 'Запись в истории родительской страницы обновлена.' : 'Запись добавлена в историю родительской страницы.', 'success');
      } finally { running = false; }
    },
  }],
};

export default feature;
