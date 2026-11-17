import { hostToPattern, isRecord } from './settings';

export const UPDATE_SOURCE_KEY = 'updateManifestUrl';
export const UPDATE_STATE_KEY = 'updateCheckState';
export const UPDATE_CONFIG_KEYS = [UPDATE_SOURCE_KEY, 'updateRepository'];
export const DEFAULT_UPDATE_SOURCE = 'https://raw.githubusercontent.com/svyatoslav-p/confluence-tools-ci/refs/heads/main/package.json';

export function parseUpdateSource(value: unknown): { url: string; permission: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return { url: url.href, permission: hostToPattern(url.origin) };
  } catch { return null; }
}

/** Сохраняем отключение проверки и переносим прежние источники на package.json. */
export function storedUpdateSource(stored: Record<string, unknown>): string {
  if (typeof stored[UPDATE_SOURCE_KEY] === 'string') {
    const source = parseUpdateSource(stored[UPDATE_SOURCE_KEY]);
    if (!source) return '';
    const url = new URL(source.url);
    url.pathname = url.pathname.replace(/\/update\.json$/, '/package.json');
    return url.href;
  }
  if (stored.updateRepository === '') return '';
  if (typeof stored.updateRepository === 'string') {
    const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(stored.updateRepository);
    if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/refs/heads/main/package.json`;
  }
  return DEFAULT_UPDATE_SOURCE;
}

/** Числовая версия расширения Chrome: от одной до четырёх частей. */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((part) => part <= 65535) && parts.some((part) => part > 0) ? parts : null;
}

export function readPackageVersion(value: unknown): string | null {
  return isRecord(value) && typeof value.version === 'string' && parseVersion(value.version) ? value.version : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error('Некорректный номер версии расширения.');
  for (let i = 0; i < 4; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
