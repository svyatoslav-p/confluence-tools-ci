// Работа с chrome.storage. Доступно только в скриптах расширения, не в коде страницы.
import { features } from './registry';
import { normalizeSettings, STORAGE_KEY } from './settings';
import type { Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeSettings(data[STORAGE_KEY], features);
}

export async function saveSettings(settings: Settings): Promise<void> {
  // Сохраняем только значения, отличающиеся от значений по умолчанию:
  // если в новой версии умолчание изменится, пользователь его получит.
  const stored: Settings = { hosts: settings.hosts, features: {} };
  for (const feature of features) {
    const state = settings.features[feature.id];
    if (!state) continue;
    const values: Record<string, string> = {};
    for (const field of feature.settings) {
      if (state.values[field.key] !== field.default) values[field.key] = state.values[field.key];
    }
    stored.features[feature.id] = { enabled: state.enabled, values };
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      callback(normalizeSettings(changes[STORAGE_KEY].newValue, features));
    }
  });
}
