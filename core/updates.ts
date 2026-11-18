import { isRecord } from './settings';
import { compareVersions, parseUpdateSource, readPackageVersion, storedUpdateSource,
  UPDATE_CONFIG_KEYS, UPDATE_SOURCE_KEY, UPDATE_STATE_KEY as STATE_KEY } from './update-source';

async function clearUpdateBadge() {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — управление модулями' });
}

export async function checkForUpdates(): Promise<void> {
  const stored = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
  const source = parseUpdateSource(storedUpdateSource(stored));
  if (!source || !await chrome.permissions.contains({ origins: [source.permission] })) {
    await clearUpdateBadge();
    await chrome.storage.local.remove(STATE_KEY);
    return;
  }
  const response = await fetch(source.url, {
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Не удалось прочитать package.json: HTTP ${response.status}`);
  const metadata: unknown = await response.json();
  const version = readPackageVersion(metadata);
  if (!version) throw new Error('В package.json отсутствует корректная числовая версия version.');
  const downloadUrl = isRecord(metadata) ? parseUpdateSource(metadata.downloadUrl)?.url ?? '' : '';
  const installedVersion = chrome.runtime.getManifest().version;
  const available = compareVersions(version, installedVersion) > 0;
  const current = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
  if (storedUpdateSource(current) !== source.url) return;
  await chrome.storage.local.set({ [STATE_KEY]: { source: source.url, available, version, installedVersion, downloadUrl,
    checking: false, error: '', checkedAt: Date.now() } });
  if (!available) return clearUpdateBadge();
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#0052CC' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — доступна новая версия' });
}

export function setupUpdateChecks() {
  let queue = Promise.resolve();
  const check = () => {
    queue = queue.then(async () => {
      const stored = await chrome.storage.local.get([...UPDATE_CONFIG_KEYS, STATE_KEY]);
      const source = storedUpdateSource(stored);
      const installedVersion = chrome.runtime.getManifest().version;
      const state = isRecord(stored[STATE_KEY]) && stored[STATE_KEY].source === source &&
        stored[STATE_KEY].installedVersion === installedVersion ? stored[STATE_KEY] : {};
      if (source) await chrome.storage.local.set({ [STATE_KEY]: { ...state, source, installedVersion, checking: true, error: '' } });
      try { await checkForUpdates(); }
      catch (error) {
        const current = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
        if (source && storedUpdateSource(current) === source) {
          await chrome.storage.local.set({ [STATE_KEY]: { ...state, source, installedVersion, checking: false,
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
