import { isRecord } from './settings';
import { parseUpdateSource, parseUpdateManifest, storedUpdateSource, validBuildDate,
  UPDATE_CONFIG_KEYS, UPDATE_SOURCE_KEY, UPDATE_STATE_KEY as STATE_KEY } from './update-source';

async function clearUpdateBadge() {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — настройки' });
}

export async function checkForUpdates(builtAt: string): Promise<void> {
  const stored = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
  const source = parseUpdateSource(storedUpdateSource(stored));
  if (!source) {
    await clearUpdateBadge();
    await chrome.storage.local.remove(STATE_KEY);
    return;
  }
  if (!await chrome.permissions.contains({ origins: [source.permission] })) {
    throw new Error('Разрешите чтение update.json, нажав «Проверить обновление».');
  }
  const response = await fetch(source.url, {
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Не удалось прочитать update.json: HTTP ${response.status}`);
  const manifest = parseUpdateManifest(await response.json());
  if (!manifest) throw new Error('В update.json нужны version, builtAt в UTC и downloadUrl с HTTPS-ссылкой.');
  if (!validBuildDate(builtAt)) throw new Error('В установленной сборке отсутствует корректная дата сборки.');
  const available = Date.parse(manifest.builtAt) > Date.parse(builtAt);
  const current = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
  if (storedUpdateSource(current) !== source.url) return;
  await chrome.storage.local.set({ [STATE_KEY]: { source: source.url, available, ...manifest,
    checking: false, error: '', checkedAt: Date.now() } });
  if (!available) return clearUpdateBadge();
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#0052CC' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — доступна новая версия' });
}

export function setupUpdateChecks(builtAt: string) {
  let queue = Promise.resolve();
  const check = () => {
    queue = queue.then(async () => {
      const stored = await chrome.storage.local.get([...UPDATE_CONFIG_KEYS, STATE_KEY]);
      const source = storedUpdateSource(stored);
      const state = isRecord(stored[STATE_KEY]) && stored[STATE_KEY].source === source ? stored[STATE_KEY] : {};
      if (source) await chrome.storage.local.set({ [STATE_KEY]: { ...state, source, checking: true, error: '' } });
      try { await checkForUpdates(builtAt); }
      catch (error) {
        const current = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
        if (source && storedUpdateSource(current) === source) {
          await chrome.storage.local.set({ [STATE_KEY]: { ...state, source, checking: false,
            error: error instanceof Error ? error.message : 'Не удалось проверить обновления.' } });
        }
        console.error('[Confluence Tools CI] Проверка обновлений не удалась', error);
      }
    }).catch((error) => console.error('[Confluence Tools CI] Проверка обновлений не удалась', error));
    return queue;
  };
  chrome.runtime.onStartup.addListener(() => { void check(); });
  chrome.runtime.onInstalled.addListener(() => { void check(); });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !isRecord(message) || message.type !== 'check-updates') return;
    void check().then(() => respond({ ok: true }));
    return true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[UPDATE_SOURCE_KEY]) {
      queue = queue.then(clearUpdateBadge).catch(console.error);
      void check();
    }
  });
}
