// Фоновый скрипт: подключает расширение к адресам Confluence из настроек.
import { defineBackground } from '#imports';
import { hostToPattern, STORAGE_KEY } from '../core/settings';
import { loadSettings } from '../core/storage';

const BRIDGE_ID = 'confluence-ext-bridge';
const APP_ID = 'confluence-ext-app';

/** Регистрирует скрипты страницы для адресов, к которым пользователь выдал доступ. */
async function syncContentScripts(): Promise<void> {
  const { hosts } = await loadSettings();
  const patterns: string[] = [];
  for (const host of hosts) {
    const pattern = hostToPattern(host);
    if (!patterns.includes(pattern) && (await chrome.permissions.contains({ origins: [pattern] }))) {
      patterns.push(pattern);
    }
  }

  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_ID, APP_ID] });
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  }
  if (!patterns.length) return;

  await chrome.scripting.registerContentScripts([
    { id: BRIDGE_ID, js: ['bridge.js'], matches: patterns, runAt: 'document_idle' },
    { id: APP_ID, js: ['app.js'], matches: patterns, runAt: 'document_idle', world: 'MAIN' },
  ]);
}

export default defineBackground(() => {
  // Вызовы идут по очереди, чтобы регистрации не пересекались.
  let queue: Promise<void> = Promise.resolve();
  const sync = () => {
    queue = queue.then(syncContentScripts).catch((error) => console.error('[Confluence Tools CI]', error));
  };

  chrome.runtime.onInstalled.addListener((details) => {
    sync();
    if (details.reason === 'install') void chrome.runtime.openOptionsPage();
  });
  chrome.runtime.onStartup.addListener(sync);
  chrome.permissions.onAdded.addListener(sync);
  chrome.permissions.onRemoved.addListener(sync);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) sync();
  });

  chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'open-options') void chrome.runtime.openOptionsPage();
  });
});
