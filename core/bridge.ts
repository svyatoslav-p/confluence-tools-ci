// Сообщения проходят через общую страницу: проверяем структуру до использования.
import { definitions } from './definitions';
import { isRecord, normalizeSettings } from './settings';
import type { Settings } from './types';

const TAG = 'confluence-ext';
export type BridgeMessage =
  | { type: 'get-settings' }
  | { type: 'settings'; settings: Settings }
  | { type: 'open-options' }
  | { type: 'extension-reloaded' };

export function postBridge(message: BridgeMessage): void {
  window.postMessage({ tag: TAG, message }, window.location.origin);
}

export function onBridge(callback: (message: BridgeMessage) => void): () => void {
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin || !isRecord(event.data)) return;
    if (event.data.tag !== TAG || !isRecord(event.data.message)) return;
    const message = event.data.message;
    switch (message.type) {
      case 'settings':
        if (isRecord(message.settings) && Array.isArray(message.settings.hosts) && isRecord(message.settings.features)) {
          callback({ type: 'settings', settings: normalizeSettings(message.settings, definitions) });
        }
        break;
      case 'get-settings':
      case 'open-options':
      case 'extension-reloaded':
        callback({ type: message.type });
    }
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}
