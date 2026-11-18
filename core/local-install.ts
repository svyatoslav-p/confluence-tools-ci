export type WritableFolder = FileSystemDirectoryHandle & {
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

type DirectoryPicker = (options: { id: string; mode: 'readwrite' }) => Promise<WritableFolder>;
const picker = () => (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

export function supportsLocalInstall() {
  return typeof picker() === 'function';
}

function folderStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('confluence-tools-ci-local-update', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function folderSetting(folder?: WritableFolder): Promise<WritableFolder | undefined> {
  const db = await folderStore();
  try {
    const transaction = db.transaction('settings', folder ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('settings');
    const request = folder ? store.put(folder, 'folder') : store.get('folder');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    return folder ?? request.result;
  } finally {
    db.close();
  }
}

export const loadInstallFolder = () => folderSetting();

export const chooseInstallFolder = () => {
  const show = picker();
  if (!show) throw new Error('Эта версия браузера не позволяет выбрать папку для записи.');
  return show.call(window, { mode: 'readwrite', id: 'ctci-install-folder' });
};

async function writeFile(file: FileSystemFileHandle, data: FileSystemWriteChunkType) {
  const writer = await file.createWritable();
  try {
    await writer.write(data);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

export async function validateInstallFolder(folder: WritableFolder) {
  const error = 'Выберите папку, из которой Chrome загрузил именно это расширение. В её корне находится manifest.json.';
  const file = await folder.getFileHandle('manifest.json').catch(() => null);
  const installed = chrome.runtime.getManifest();
  if (!file) throw new Error(error);
  const manifest = JSON.parse(await (await file.getFile()).text());
  if (manifest.name !== installed.name || manifest.version !== installed.version) throw new Error(error);

  // В двух копиях сборки манифест может совпадать. Проверяем видимость случайного файла
  // через каталог, который Chrome привязал к работающему экземпляру.
  const root = await new Promise<DirectoryEntry>((resolve, reject) => {
    chrome.runtime.getPackageDirectoryEntry((entry) => {
      const detail = chrome.runtime.lastError;
      if (detail || !entry) reject(new Error(detail?.message ?? error));
      else resolve(entry);
    });
  });
  const probe = 'ctci-folder-check-' + crypto.randomUUID() + '.txt';
  const handle = await folder.getFileHandle(probe, { create: true });
  try {
    await writeFile(handle, probe);
    await new Promise<void>((resolve, reject) => {
      root.getFile(probe, { create: false }, () => resolve(), () => reject(new Error(error)));
    });
  } finally {
    await folder.removeEntry(probe);
  }
}

export const rememberInstallFolder = (folder: WritableFolder) => folderSetting(folder);

async function existingFile(parent: FileSystemDirectoryHandle, filename: string) {
  try {
    return await parent.getFileHandle(filename);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function replaceBundle(folder: FileSystemDirectoryHandle, files: ReadonlyMap<string, Uint8Array>) {
  const rollback: Array<() => Promise<void>> = [];
  const staged = [...files.entries()].sort(([a], [b]) => Number(a === 'manifest.json') - Number(b === 'manifest.json'));
  try {
    for (const [path, bytes] of staged) {
      const segments = path.split('/');
      const filename = segments.pop()!;
      let parent = folder;
      for (const segment of segments) parent = await parent.getDirectoryHandle(segment, { create: true });
      const existing = await existingFile(parent, filename);
      const previous = existing ? await (await existing.getFile()).arrayBuffer() : null;
      const handle = existing ?? await parent.getFileHandle(filename, { create: true });
      if (!existing) rollback.push(() => parent.removeEntry(filename));
      // FileSystemWritableFileStream применяет замену только при успешном close().
      await writeFile(handle, new Blob([new Uint8Array(bytes)]));
      if (previous) rollback.push(() => writeFile(handle, previous));
    }
  } catch (error) {
    let restored = true;
    for (const undo of rollback.reverse()) {
      try { await undo(); }
      catch { restored = false; }
    }
    if (!restored) throw new Error('Не удалось восстановить все файлы. Распакуйте рабочую сборку поверх этой папки и перезагрузите расширение.');
    throw error;
  }
}
