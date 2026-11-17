import { isRecord } from './settings';
import { parseUpdateRepository, UPDATE_REPOSITORY_KEY } from './update-source';

const STATE_KEY = 'updateCheckState';
const NOTIFICATION_ID = 'confluence-tools-ci-update';
const SHA = /^[0-9a-f]{40}$/i;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
  return response.json();
}

async function clearUpdateNotice() {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — настройки' });
  await chrome.notifications.clear(NOTIFICATION_ID);
}

export async function checkForUpdates(buildCommit: string): Promise<void> {
  const stored = await chrome.storage.local.get([UPDATE_REPOSITORY_KEY, STATE_KEY]);
  const source = parseUpdateRepository(stored[UPDATE_REPOSITORY_KEY]);
  if (!source) {
    await clearUpdateNotice();
    await chrome.storage.local.remove(STATE_KEY);
    return;
  }
  if (!await chrome.permissions.contains({ origins: ['https://api.github.com/*'] })) return;
  const latest = await getJson(`${source.api}/commits/main`);
  if (!isRecord(latest) || typeof latest.sha !== 'string' || !SHA.test(latest.sha)) {
    throw new Error('Не удалось прочитать ветку main публичного репозитория GitHub.');
  }
  const previous = stored[STATE_KEY];
  const state = isRecord(previous) && previous.repository === source.url ? previous : {};
  // При обновлении расширения новая встроенная ревизия становится точкой сравнения.
  const base = state.buildCommit === buildCommit && typeof state.baseline === 'string' && SHA.test(state.baseline)
    ? state.baseline : buildCommit;
  let available = false;
  let baseline = base;
  if (base !== latest.sha) {
    const comparison = SHA.test(base) ? await getJson(`${source.api}/compare/${base}...${latest.sha}`) : null;
    if (comparison === null) {
      // Архив исходников без Git или другой репозиторий: первая проверка запоминает main.
      baseline = latest.sha;
    } else if (isRecord(comparison) && typeof comparison.status === 'string' &&
      ['ahead', 'behind', 'identical', 'diverged'].includes(comparison.status)) {
      available = comparison.status === 'ahead' || comparison.status === 'diverged';
    } else throw new Error('Некорректный ответ сравнения коммитов GitHub.');
  }
  // Пользователь мог сменить источник, пока выполнялся запрос.
  const current = await chrome.storage.local.get(UPDATE_REPOSITORY_KEY);
  if (parseUpdateRepository(current[UPDATE_REPOSITORY_KEY])?.url !== source.url) return;
  await chrome.storage.local.set({ [STATE_KEY]: { repository: source.url, buildCommit, baseline, available, latest: latest.sha } });
  if (!available) return clearUpdateNotice();
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#0052CC' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — доступна новая версия' });
  await chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic', iconUrl: chrome.runtime.getURL('icon/128.png'),
    title: 'Confluence Tools CI — доступно обновление',
    message: `В main появились новые коммиты (${latest.sha.slice(0, 7)}). Нажмите, чтобы открыть сборки на GitHub.`,
  });
}

export function setupUpdateChecks(buildCommit: string) {
  let queue = Promise.resolve();
  const check = () => {
    queue = queue.then(() => checkForUpdates(buildCommit)).catch((error) => {
      console.error('[Confluence Tools CI] Проверка обновлений не удалась', error);
    });
  };
  chrome.runtime.onStartup.addListener(check);
  chrome.runtime.onInstalled.addListener(check);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[UPDATE_REPOSITORY_KEY]) {
      queue = queue.then(clearUpdateNotice).catch(console.error);
      check();
    }
  });
  chrome.notifications.onClicked.addListener((id) => {
    if (id !== NOTIFICATION_ID) return;
    void (async () => {
      const stored = await chrome.storage.local.get(STATE_KEY);
      const state = stored[STATE_KEY];
      const source = isRecord(state) && state.available ? parseUpdateRepository(state.repository) : null;
      if (source) await chrome.tabs.create({ url: `${source.url}/actions` });
    })().catch((error) => console.error('[Confluence Tools CI]', error));
  });
}
