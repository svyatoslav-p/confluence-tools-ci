import { hostToPattern, isRecord } from './settings';

export const UPDATE_SOURCE_KEY = 'updateManifestUrl';
export const UPDATE_STATE_KEY = 'updateCheckState';
export const UPDATE_CONFIG_KEYS = [UPDATE_SOURCE_KEY, 'updateRepository'];
export const DEFAULT_UPDATE_SOURCE = 'https://raw.githubusercontent.com/svyatoslav-p/confluence-tools-ci/refs/heads/main/update.json';

export function parseUpdateSource(value: unknown): { url: string; permission: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return { url: url.href, permission: hostToPattern(url.origin) };
  } catch { return null; }
}

/** Сохраняем отключение проверки и переносим старый GitHub-источник на raw JSON. */
export function storedUpdateSource(stored: Record<string, unknown>): string {
  if (typeof stored[UPDATE_SOURCE_KEY] === 'string') return parseUpdateSource(stored[UPDATE_SOURCE_KEY])?.url ?? '';
  if (stored.updateRepository === '') return '';
  if (typeof stored.updateRepository === 'string') {
    const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(stored.updateRepository);
    if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/refs/heads/main/update.json`;
  }
  return DEFAULT_UPDATE_SOURCE;
}

export interface UpdateManifest { version: string; builtAt: string; downloadUrl: string }

export function validBuildDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}

export function parseUpdateManifest(value: unknown): UpdateManifest | null {
  if (!isRecord(value) || typeof value.version !== 'string' || !value.version.trim() || !validBuildDate(value.builtAt)) return null;
  const download = parseUpdateSource(value.downloadUrl);
  return download ? { version: value.version, builtAt: value.builtAt, downloadUrl: download.url } : null;
}
