import type { Feature, Settings } from './types';

export const STORAGE_KEY = 'settings';

export const DEFAULT_HOSTS = ['http://confluence.ideveloplab.ru:8095'];

/** Дополняет сохранённые настройки значениями по умолчанию для всех модулей. */
export function normalizeSettings(raw: unknown, features: Feature[]): Settings {
  const saved = (raw ?? {}) as Partial<Settings>;
  const result: Settings = {
    hosts: Array.isArray(saved.hosts) ? saved.hosts.filter((h) => typeof h === 'string') : [...DEFAULT_HOSTS],
    features: {},
  };
  for (const feature of features) {
    const state = saved.features?.[feature.id];
    const values: Record<string, string> = {};
    for (const field of feature.settings) {
      const value = state?.values?.[field.key];
      values[field.key] = typeof value === 'string' ? value : field.default;
    }
    result.features[feature.id] = { enabled: state?.enabled ?? true, values };
  }
  return result;
}

/** Приводит введённый адрес к виду «протокол://хост[:порт]» или возвращает null. */
export function normalizeHost(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = 'http://' + text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Шаблон доступа Chrome для адреса (порт в шаблонах не учитывается). */
export function hostToPattern(host: string): string {
  const url = new URL(host);
  return `${url.protocol}//${url.hostname}/*`;
}
