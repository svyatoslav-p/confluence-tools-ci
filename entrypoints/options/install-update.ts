import {
  chooseInstallFolder, loadInstallFolder, rememberInstallFolder, replaceBundle,
  supportsLocalInstall, validateInstallFolder, type WritableFolder,
} from '../../core/local-install';
import { downloadRelease, RELEASE_PERMISSIONS } from '../../core/update-release';
import { availableUpdate, DEFAULT_UPDATE_SOURCE, storedUpdateSource, UPDATE_CONFIG_KEYS, UPDATE_STATE_KEY } from '../../core/update-source';

export function createUpdateInstaller() {
  const panel = document.querySelector<HTMLElement>('#install-update-panel')!;
  const hint = document.querySelector<HTMLElement>('#install-update-hint')!;
  const button = document.querySelector<HTMLButtonElement>('#install-update')!;
  const folderButton = document.querySelector<HTMLButtonElement>('#choose-update-folder')!;
  const status = document.querySelector<HTMLElement>('#install-update-status')!;
  const installed = chrome.runtime.getManifest();
  let folder: WritableFolder | undefined;
  let version: string | null = null;
  let officialSource = false;
  let busy = false;
  let hasDownloadAccess = false;
  let supported = false;

  function render() {
    panel.hidden = !supported;
    button.disabled = busy || !version;
    folderButton.hidden = !version || !folder || !hasDownloadAccess;
    folderButton.disabled = busy;
    if (!busy) {
      button.textContent = !version ? 'Установить обновление'
        : hasDownloadAccess ? 'Установить обновление ' + version : 'Разрешить скачивание с GitHub';
      hint.textContent = !officialSource ? 'Установка ZIP доступна для официального источника обновлений.'
        : !version ? 'Кнопка станет активной после обнаружения новой версии.'
        : 'Установка скачает ZIP из официального выпуска на GitHub. Chrome может попросить выбрать папку расширения и разрешить запись.';
    }
  }

  function show(message: string, error = false) {
    status.className = error ? 'error' : 'hint';
    status.textContent = message;
    status.hidden = !message;
  }

  async function refreshAccess() {
    if (!supported) return;
    hasDownloadAccess = await chrome.permissions.contains(RELEASE_PERMISSIONS);
    render();
  }

  async function init() {
    if (!supportsLocalInstall() || (await chrome.management.getSelf()).installType !== 'development') return;
    supported = true;
    folder = await loadInstallFolder();
    await refreshAccess();
  }
  const initialized = init().catch((error) => console.error('[Confluence Tools CI] Установка обновлений', error));

  const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); };

  async function interact(action: () => Promise<void>) {
    busy = true;
    render();
    show('');
    try { await action(); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      show(error instanceof Error ? error.message : 'Не удалось установить обновление.', true);
    } finally {
      busy = false;
      render();
    }
  }

  async function selectFolder() {
    const chosen = await chooseInstallFolder();
    await validateInstallFolder(chosen);
    await rememberInstallFolder(chosen);
    folder = chosen;
    render();
    return chosen;
  }

  async function checkSelectedVersion(expected: string) {
    const stored = await chrome.storage.local.get([...UPDATE_CONFIG_KEYS, UPDATE_STATE_KEY]);
    if (storedUpdateSource(stored) !== DEFAULT_UPDATE_SOURCE || availableUpdate(stored, installed.version)?.version !== expected) {
      throw new Error('Доступная версия изменилась. Проверьте обновление снова.');
    }
  }

  async function install(expected: string) {
    const selected = folder;
    // Запрос к Chrome должен начинаться в обработчике нажатия.
    if (selected && await selected.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('Запись в папку не разрешена. Подтвердите доступ или выберите папку заново.');
    }
    const target = selected ?? await selectFolder();
    await navigator.locks.request('confluence-tools-ci-local-update', { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('Установка уже выполняется в другой вкладке настроек.');
      await checkSelectedVersion(expected);
      show('Скачиваем и проверяем ZIP версии ' + expected + '…');
      const files = await downloadRelease(expected, installed.name);
      await checkSelectedVersion(expected);
      await validateInstallFolder(target);
      show('Устанавливаем обновление. Оставьте вкладку открытой…');
      window.addEventListener('beforeunload', confirmLeave);
      try { await replaceBundle(target, files); }
      finally { window.removeEventListener('beforeunload', confirmLeave); }
      show('Обновление установлено. Перезагружаем расширение…');
      chrome.runtime.reload();
    });
  }

  folderButton.addEventListener('click', () => {
    if (busy) return;
    void interact(async () => {
      await selectFolder();
      show('Папка расширения сохранена.');
    });
  });

  button.addEventListener('click', () => {
    const expected = version;
    if (busy || !expected) return;
    void interact(async () => {
      if (!hasDownloadAccess) {
        if (!await chrome.permissions.request(RELEASE_PERMISSIONS)) throw new Error('Разрешите скачивание файлов с GitHub, чтобы установить обновление.');
        await refreshAccess();
        show('Доступ выдан. Нажмите «Установить обновление».');
        return;
      }
      await install(expected);
    });
  });

  chrome.permissions.onAdded.addListener(() => void refreshAccess());
  chrome.permissions.onRemoved.addListener(() => void refreshAccess());
  return async (nextVersion: string | null, usesOfficialSource: boolean) => {
    await initialized;
    if (!supported) return;
    if (version !== nextVersion && !busy) show('');
    version = nextVersion;
    officialSource = usesOfficialSource;
    render();
  };
}
