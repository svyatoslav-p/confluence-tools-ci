// Сообщения между кодом страницы (app) и скриптом расширения (bridge).
// Код страницы не имеет доступа к chrome.*, поэтому настройки ему передаёт bridge.
import type { Settings } from './types';

const TAG = 'confluence-ext';

export type BridgeMessage =
  | { type: 'get-settings' }
  | { type: 'settings'; settings: Settings }
  | { type: 'open-options' }
  /** Расширение обновили или отключили, а страница осталась открытой со старыми скриптами. */
  | { type: 'extension-reloaded' };

export function postBridge(message: BridgeMessage): void {
  window.postMessage({ tag: TAG, message }, window.location.origin);
}

export function onBridge(callback: (message: BridgeMessage) => void): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.tag !== TAG) return;
    callback(event.data.message as BridgeMessage);
  });
}
