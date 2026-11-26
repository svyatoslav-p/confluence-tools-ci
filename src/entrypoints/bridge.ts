import { defineUnlistedScript } from '#imports';
import { onBridge, postBridge } from '../core/bridge';
import { loadSettings, onSettingsChanged } from '../core/storage';

export default defineUnlistedScript(() => {
  if (window.top !== window) return;
  const connected = () => Boolean(chrome.runtime?.id);
  async function respond(type: 'get-settings' | 'open-options') {
    try {
      if (!connected()) return postBridge({ type: 'extension-reloaded' });
      if (type === 'get-settings') postBridge({ type: 'settings', settings: await loadSettings() });
      else await chrome.runtime.sendMessage({ type: 'open-options' });
    } catch (error) {
      if (!connected()) postBridge({ type: 'extension-reloaded' });
      else console.error('[Confluence Tools CI] Не удалось связаться с расширением', error);
    }
  }
  const unsubscribeBridge = onBridge((message) => {
    if (message.type === 'get-settings' || message.type === 'open-options') void respond(message.type);
  });
  const unsubscribeSettings = onSettingsChanged((settings) => postBridge({ type: 'settings', settings }));
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    unsubscribeBridge();
    unsubscribeSettings();
  });
  void respond('get-settings');
});
