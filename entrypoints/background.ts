// Подключение скриптов к разрешённым хостам; очередь исключает гонки регистрации.
import { defineBackground } from '#imports';
import { hostToPattern, isRecord, STORAGE_KEY } from '../core/settings';
import { loadHosts } from '../core/storage';
import { setupUpdateChecks } from '../core/updates';

declare const __BUILD_COMMIT__: string;

const BRIDGE_ID = 'confluence-ext-bridge';
const APP_ID = 'confluence-ext-app';

async function syncContentScripts(): Promise<void> {
  const hosts = await loadHosts();
  const candidates = [...new Set(hosts.map(hostToPattern))].sort();
  const granted = await Promise.all(candidates.map((pattern) => chrome.permissions.contains({ origins: [pattern] })));
  const patterns = candidates.filter((_, index) => granted[index]);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_ID, APP_ID] });
  const desired: chrome.scripting.RegisteredContentScript[] = patterns.length ? [
    { id: BRIDGE_ID, js: ['bridge.js'], matches: patterns, runAt: 'document_idle', world: 'ISOLATED' },
    { id: APP_ID, js: ['app.js'], matches: patterns, runAt: 'document_idle', world: 'MAIN' },
  ] : [];
  const unchanged = registered.length === desired.length && desired.every((script) => {
    const old = registered.find((item) => item.id === script.id);
    return old && old.world === script.world && old.runAt === script.runAt &&
      JSON.stringify(old.js) === JSON.stringify(script.js) &&
      JSON.stringify([...(old.matches ?? [])].sort()) === JSON.stringify(script.matches);
  });
  if (unchanged) return;
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  if (desired.length) await chrome.scripting.registerContentScripts(desired);
}

export default defineBackground(() => {
  setupUpdateChecks(__BUILD_COMMIT__);
  let queue: Promise<void> = Promise.resolve();
  const sync = () => {
    queue = queue.then(syncContentScripts).catch((error) => console.error('[Confluence Tools CI]', error));
  };
  const openOptions = () => {
    void chrome.runtime.openOptionsPage().catch((error) => console.error('[Confluence Tools CI]', error));
  };
  chrome.runtime.onInstalled.addListener((details) => {
    sync();
    if (details.reason === 'install') openOptions();
  });
  chrome.runtime.onStartup.addListener(sync);
  chrome.permissions.onAdded.addListener(sync);
  chrome.permissions.onRemoved.addListener(sync);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) sync();
  });
  chrome.action.onClicked.addListener(openOptions);
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id === chrome.runtime.id && isRecord(message) && message.type === 'open-options') openOptions();
  });
});
