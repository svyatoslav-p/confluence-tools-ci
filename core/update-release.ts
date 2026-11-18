import { strFromU8, unzipSync } from 'fflate';
import { isRecord } from './settings';
import { parseVersion } from './update-source';

const REPOSITORY = 'svyatoslav-p/confluence-tools-ci';
const API_ORIGIN = 'https://api.github.com';
const GITHUB_ORIGIN = 'https://github.com';
const ASSET_ORIGINS = [GITHUB_ORIGIN, 'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com'];
const MAX_ZIP_SIZE = 5 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 256;

export const RELEASE_PERMISSIONS = { origins: [API_ORIGIN, ...ASSET_ORIGINS].map((origin) => origin + '/*') };

async function fetchRelease(url: string, redirect: RequestRedirect) {
  return fetch(url, {
    cache: 'no-store', credentials: 'omit', redirect, signal: AbortSignal.timeout(60000),
  });
}

export async function downloadRelease(version: string, name: string) {
  if (!parseVersion(version)) throw new Error('Некорректная версия выпуска.');
  const tag = 'v' + version;
  const filename = 'confluence-tools-ci-chrome-' + version + '.zip';
  const url = GITHUB_ORIGIN + '/' + REPOSITORY + '/releases/download/' + tag + '/' + filename;
  const response = await fetchRelease(API_ORIGIN + '/repos/' + REPOSITORY + '/releases/tags/' + tag, 'error');
  if (response.status === 404) throw new Error('ZIP этой версии ещё не опубликован в GitHub Releases.');
  if (!response.ok) throw new Error('Не удалось получить данные выпуска GitHub. HTTP ' + response.status);
  const release: unknown = await response.json();
  if (!isRecord(release) || release.tag_name !== tag || release.draft !== false || release.prerelease !== false ||
      !Array.isArray(release.assets)) {
    throw new Error('GitHub не вернул опубликованный выпуск нужной версии.');
  }
  const asset: unknown = release.assets.find((value: unknown) => isRecord(value) && value.name === filename);
  if (!isRecord(asset) || asset.state !== 'uploaded' || asset.browser_download_url !== url ||
      typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
      typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ZIP_SIZE) {
    throw new Error('Для выпуска недоступен ZIP с контрольной суммой SHA-256.');
  }

  const archive = await fetchRelease(url, 'follow');
  if (!archive.ok || !archive.body || !ASSET_ORIGINS.includes(new URL(archive.url).origin)) {
    throw new Error('Не удалось скачать ZIP из GitHub Releases.');
  }
  const bytes = new Uint8Array(asset.size);
  const reader = archive.body.getReader();
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > bytes.length) {
      await reader.cancel();
      throw new Error('Размер ZIP не совпадает с данными выпуска.');
    }
    bytes.set(value, offset);
    offset += value.length;
  }
  if (offset !== bytes.length) throw new Error('Размер ZIP не совпадает с данными выпуска.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (asset.digest !== 'sha256:' + digest) throw new Error('Контрольная сумма ZIP не совпадает с данными GitHub.');
  return readReleaseZip(bytes, version, name);
}

function validatePath(path: string) {
  if (path.length > 200 || !path.split('/').every((part) =>
    /^[a-z0-9_-][a-z0-9_.-]*$/i.test(part) && !part.endsWith('.') &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
  ) || path.toLowerCase().startsWith('_metadata')) {
    throw new Error('Недопустимый путь в ZIP «' + path + '».');
  }
}

export function readReleaseZip(bytes: Uint8Array, version: string, name: string) {
  const paths = new Set<string>();
  let total = 0;
  const files = unzipSync(bytes, { filter(file) {
    const path = file.name.replace(/\/$/, '');
    validatePath(path);
    if (file.name.endsWith('/')) {
      if (file.originalSize !== 0) throw new Error('Недопустимая папка в ZIP.');
      return false;
    }
    const normalized = path.toLowerCase();
    if (paths.has(normalized)) throw new Error('Повторяющийся путь в ZIP «' + path + '».');
    paths.add(normalized);
    total += file.originalSize;
    if (paths.size > MAX_FILES || total > MAX_EXPANDED_SIZE) throw new Error('Сборка превышает допустимый размер.');
    return true;
  } });
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/'))) throw new Error('Конфликт имён файлов и папок в ZIP.');
      parts.pop();
    }
  }
  const bundle = new Map(Object.entries(files));
  for (const file of ['manifest.json', 'background.js', 'bridge.js', 'app.js', 'options.html', 'popup.html']) {
    if (!bundle.get(file)?.length) throw new Error('В ZIP отсутствует файл ' + file + '.');
  }
  const manifest: unknown = JSON.parse(strFromU8(bundle.get('manifest.json')!));
  if (!isRecord(manifest) || manifest.manifest_version !== 3 || manifest.version !== version || manifest.name !== name) {
    throw new Error('Манифест в ZIP не соответствует выбранной версии расширения.');
  }
  return bundle;
}
