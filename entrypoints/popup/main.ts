import { definitions } from '../../core/definitions';
import { loadSettings, onSettingsChanged, saveSettings } from '../../core/storage';
import { availableUpdate, UPDATE_STATE_KEY } from '../../core/update-source';
import type { Settings } from '../../core/types';

const enabled = document.querySelector<HTMLInputElement>('#enabled')!;
const modules = document.querySelector<HTMLFieldSetElement>('#modules')!;
const list = document.querySelector<HTMLElement>('#module-list')!;
const status = document.querySelector<HTMLElement>('#status')!;
const error = document.querySelector<HTMLElement>('#error')!;
const controls = new Map<string, HTMLInputElement>();
let settings: Settings | undefined;
let busy = false;
let updateRender = 0;

document.querySelector('#version')!.textContent = chrome.runtime.getManifest().version;

async function renderUpdate() {
  const render = ++updateRender;
  const box = document.querySelector<HTMLElement>('#update-available')!;
  try {
    const stored = await chrome.storage.local.get(UPDATE_STATE_KEY);
    if (render !== updateRender) return;
    const update = availableUpdate(stored, chrome.runtime.getManifest().version);
    box.hidden = !update;
    document.querySelector('#update-version')!.textContent = update ? `Доступна новая версия: ${update}` : '';
  } catch {
    if (render === updateRender) box.hidden = true;
  }
}

function render() {
  enabled.disabled = busy || !settings;
  enabled.checked = settings?.enabled ?? true;
  modules.disabled = busy || !settings?.enabled;
  status.textContent = settings?.enabled
    ? 'Изменения применяются на всех заданных адресах.'
    : settings ? 'Все модули приостановлены. Их настройки сохранены.' : 'Не удалось загрузить настройки.';
  for (const [id, input] of controls) input.checked = settings?.features[id]?.enabled ?? true;
}

async function change(update: (current: Settings) => void) {
  if (busy) return;
  busy = true;
  error.hidden = true;
  render();
  try {
    // Читаем актуальные настройки, чтобы сохранить изменения из открытой страницы настроек.
    const current = await loadSettings();
    update(current);
    await saveSettings(current);
    settings = current;
  } catch {
    error.textContent = 'Не удалось сохранить изменение. Откройте меню заново и повторите попытку.';
    error.hidden = false;
  } finally {
    busy = false;
    render();
  }
}

enabled.addEventListener('change', () => {
  const checked = enabled.checked;
  void change((current) => { current.enabled = checked; });
});

for (const feature of definitions) {
  const label = document.createElement('label');
  label.className = 'toggle';
  label.title = feature.description;
  const title = document.createElement('span');
  title.textContent = feature.title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => {
    const checked = input.checked;
    void change((current) => { current.features[feature.id].enabled = checked; });
  });
  controls.set(feature.id, input);
  label.append(title, input);
  list.append(label);
}

document.querySelector('#open-options')!.addEventListener('click', async () => {
  try { await chrome.runtime.openOptionsPage(); window.close(); }
  catch { error.textContent = 'Не удалось открыть настройки.'; error.hidden = false; }
});

async function init() {
  const unsubscribe = onSettingsChanged((current) => { settings = current; render(); });
  const updatesChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[UPDATE_STATE_KEY]) void renderUpdate();
  };
  chrome.storage.onChanged.addListener(updatesChanged);
  window.addEventListener('pagehide', () => {
    unsubscribe();
    chrome.storage.onChanged.removeListener(updatesChanged);
  }, { once: true });
  void renderUpdate();
  try { settings = await loadSettings(); }
  catch { error.textContent = 'Не удалось загрузить настройки. Откройте меню заново.'; error.hidden = false; }
  render();
}

void init();
