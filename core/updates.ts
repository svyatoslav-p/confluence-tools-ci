import { isRecord } from './settings';
import { compareVersions, fetchChromeRelease, LATEST_RELEASE_URL, readUpdateState,
  UPDATE_AUTO_CHECK_KEY, UPDATE_PERMISSION, UPDATE_STATE_KEY } from './update-source';

async function clearUpdateBadge() {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Confluence Tools CI — управление модулями' });
}

async function clearUpdateState() {
  await chrome.storage.local.remove(UPDATE_STATE_KEY);
  await clearUpdateBadge();
}

export async function checkForUpdates(): Promise<void> {
  if (!await chrome.permissions.contains(UPDATE_PERMISSION)) return clearUpdateState();
  const installedVersion = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get(UPDATE_STATE_KEY);
  const previous = readUpdateState(stored, installedVersion);
  const state = { ...previous, source: LATEST_RELEASE_URL, installedVersion };
  await chrome.storage.local.set({ [UPDATE_STATE_KEY]: { ...state, checking: true, error: '' } });
  try {
    const release = await fetchChromeRelease();
    if (!await chrome.permissions.contains(UPDATE_PERMISSION)) return clearUpdateState();
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: {
      ...state, version: release?.version ?? null, checking: false, error: '', checkedAt: Date.now(),
    } });
    if (!release || compareVersions(release.version, installedVersion) <= 0) return clearUpdateBadge();
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#0052CC' });
    await chrome.action.setTitle({ title: 'Confluence Tools CI — доступна новая версия' });
  } catch (error) {
    if (!await chrome.permissions.contains(UPDATE_PERMISSION)) return clearUpdateState();
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: {
      ...state, checking: false, error: error instanceof Error ? error.message : 'Не удалось проверить обновления.',
    } });
    console.error('[Confluence Tools CI] Проверка обновлений не удалась', error);
  }
}

export function setupUpdateChecks() {
  let queue = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    queue = queue.then(action).catch((error) => console.error('[Confluence Tools CI] Проверка обновлений не удалась', error));
    return queue;
  };
  const checkAutomatically = () => enqueue(async () => {
    const stored = await chrome.storage.local.get(UPDATE_AUTO_CHECK_KEY);
    if (stored[UPDATE_AUTO_CHECK_KEY] !== false) await checkForUpdates();
  });
  const isUpdatePermission = ({ origins }: chrome.permissions.Permissions) =>
    origins?.some((origin) => UPDATE_PERMISSION.origins.includes(origin));

  chrome.runtime.onStartup.addListener(() => { void checkAutomatically(); });
  chrome.runtime.onInstalled.addListener(() => { void checkAutomatically(); });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !isRecord(message) || message.type !== 'check-updates') return;
    void enqueue(checkForUpdates).then(() => respond({ ok: true }));
    return true;
  });
  chrome.permissions.onAdded.addListener((permissions) => {
    if (isUpdatePermission(permissions)) void checkAutomatically();
  });
  chrome.permissions.onRemoved.addListener((permissions) => {
    if (isUpdatePermission(permissions)) void enqueue(async () => {
      if (!await chrome.permissions.contains(UPDATE_PERMISSION)) await clearUpdateState();
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[UPDATE_AUTO_CHECK_KEY]?.newValue === true) void checkAutomatically();
  });
}
