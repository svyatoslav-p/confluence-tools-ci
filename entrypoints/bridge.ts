// Скрипт расширения на странице Confluence: передаёт настройки коду страницы (app.ts)
// и выполняет его запросы, для которых нужен доступ к chrome.*.
import { defineUnlistedScript } from '#imports';
import { onBridge, postBridge } from '../core/bridge';
import { loadSettings, onSettingsChanged } from '../core/storage';

export default defineUnlistedScript(() => {
  if (window.top !== window) return;

  async function sendSettings() {
    postBridge({ type: 'settings', settings: await loadSettings() });
  }

  // После обновления расширения скрипт на уже открытой странице теряет связь с ним:
  // chrome.runtime пропадает. Работать дальше нельзя, нужно перезагрузить страницу.
  const connected = () => Boolean(chrome.runtime?.id);

  onBridge((message) => {
    if (message.type !== 'get-settings' && message.type !== 'open-options') return;
    if (!connected()) return postBridge({ type: 'extension-reloaded' });
    if (message.type === 'get-settings') void sendSettings();
    if (message.type === 'open-options') void chrome.runtime.sendMessage({ type: 'open-options' });
  });
  onSettingsChanged((settings) => postBridge({ type: 'settings', settings }));
  void sendSettings();
});
