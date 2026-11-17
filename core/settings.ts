import { isHotkey } from './hotkeys';
import type { FeatureDefinition, SettingField, Settings } from './types';

export const STORAGE_KEY = 'settings';
export const DEFAULT_HOSTS = ['http://confluence.ideveloplab.ru:8095'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validValue(value: unknown, field: SettingField): string {
  if (typeof value !== 'string') return field.default;
  if (field.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) return field.default;
  if (field.type === 'boolean' && value !== 'true' && value !== 'false') return field.default;
  if (field.type === 'hotkey' && !isHotkey(value)) return field.default;
  return value;
}

/** Проверяет данные хранилища/моста и дополняет их умолчаниями. */
export function normalizeSettings(raw: unknown, features: FeatureDefinition[]): Settings {
  const saved = isRecord(raw) ? raw : {};
  const states = isRecord(saved.features) ? saved.features : {};
  const result: Settings = { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true, hosts: normalizeHosts(saved.hosts), features: {} };
  for (const feature of features) {
    const state = states[feature.id];
    const savedState = isRecord(state) ? state : {};
    const savedValues = isRecord(savedState.values) ? savedState.values : {};
    const values: Record<string, string> = {};
    for (const field of feature.settings) values[field.key] = validValue(savedValues[field.key], field);
    result.features[feature.id] = {
      enabled: typeof savedState.enabled === 'boolean' ? savedState.enabled : true,
      values,
    };
  }
  return result;
}

/** Общий разбор списка адресов, не требующий каталога модулей. */
export function normalizeHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_HOSTS];
  return [...new Set(raw.flatMap((host: unknown) => {
    const normalized = typeof host === 'string' ? normalizeHost(host) : null;
    return normalized ? [normalized] : [];
  }))];
}

/** Приводит адрес к «протокол://хост[:порт]». */
export function normalizeHost(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = 'http://' + text;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname.includes('*')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Chrome не учитывает порт в шаблонах доступа; точный origin проверяет приложение. */
export function hostToPattern(host: string): string {
  const url = new URL(host);
  return url.protocol + '//' + url.hostname + '/*';
}
