import { isRecord } from './settings';

const REPOSITORY = 'svyatoslav-p/confluence-tools-ci';
const API_ORIGIN = 'https://api.github.com';
const RELEASES_API = API_ORIGIN + '/repos/' + REPOSITORY + '/releases';
const RELEASES_PAGE = 'https://github.com/' + REPOSITORY + '/releases';
const MAX_ZIP_SIZE = 5 * 1024 * 1024;

export const LATEST_RELEASE_URL = RELEASES_API + '/latest';
export const UPDATE_PERMISSION = { origins: [API_ORIGIN + '/*'] };
export const UPDATE_STATE_KEY = 'updateCheckState';
export const UPDATE_AUTO_CHECK_KEY = 'autoCheckUpdates';

/** Числовая версия расширения Chrome: от одной до четырёх частей. */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((part) => part <= 65535) && parts.some((part) => part > 0) ? parts : null;
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

export async function fetchChromeRelease(requestedVersion?: string) {
  if (requestedVersion !== undefined && !parseVersion(requestedVersion)) throw new Error('Некорректная версия выпуска.');
  const url = requestedVersion === undefined ? LATEST_RELEASE_URL : RELEASES_API + '/tags/v' + requestedVersion;
  const response = await fetch(url, {
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Не удалось получить данные выпуска GitHub. HTTP ' + response.status);
  const release: unknown = await response.json();
  if (!isRecord(release) || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
    throw new Error('GitHub вернул некорректные данные о выпуске.');
  }
  if (release.draft !== false || release.prerelease !== false || !release.tag_name.startsWith('v')) return null;
  const version = release.tag_name.slice(1);
  if (!parseVersion(version) || (requestedVersion !== undefined && version !== requestedVersion)) return null;
  const filename = 'confluence-tools-ci-chrome-' + version + '.zip';
  const downloadUrl = RELEASES_PAGE + '/download/' + release.tag_name + '/' + filename;
  const asset: unknown = release.assets.find((value: unknown) => isRecord(value) && value.name === filename);
  if (!isRecord(asset) || asset.state !== 'uploaded' || asset.browser_download_url !== downloadUrl ||
      typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
      typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ZIP_SIZE) {
    return null;
  }
  return { version, url: downloadUrl, digest: asset.digest, size: asset.size };
}

export function readUpdateState(stored: Record<string, unknown>, installedVersion: string) {
  const state = stored[UPDATE_STATE_KEY];
  return isRecord(state) && state.source === LATEST_RELEASE_URL && state.installedVersion === installedVersion ? state : {};
}

export function availableUpdate(stored: Record<string, unknown>, installedVersion: string): string | null {
  const { version } = readUpdateState(stored, installedVersion);
  return typeof version === 'string' && parseVersion(version) && compareVersions(version, installedVersion) > 0 ? version : null;
}
