// Страница настроек. Блоки модулей строятся из описаний Feature.settings.
import { eventToHotkey, findHotkeyConflict, formatHotkey } from '../../core/hotkeys';
import { definitions } from '../../core/definitions';
import { hostToPattern, isRecord, normalizeHost } from '../../core/settings';
import { loadSettings, onSettingsChanged, saveSettings } from '../../core/storage';
import { availableUpdate, DEFAULT_UPDATE_SOURCE, parseUpdateSource, storedUpdateSource, UPDATE_CONFIG_KEYS, UPDATE_SOURCE_KEY, UPDATE_STATE_KEY } from '../../core/update-source';
import type { FeatureDefinition, SettingField, Settings } from '../../core/types';
import { createUpdateInstaller } from './install-update';

const hostsList = document.querySelector<HTMLUListElement>('#hosts')!;
const hostForm = document.querySelector<HTMLFormElement>('#host-form')!;
const hostInput = document.querySelector<HTMLInputElement>('#host-input')!;
const hostError = document.querySelector<HTMLElement>('#host-error')!;
const featuresBox = document.querySelector<HTMLElement>('#features')!;
const updateForm = document.querySelector<HTMLFormElement>('#update-form')!;
const updateSourceInput = document.querySelector<HTMLInputElement>('#update-repository')!;
const updateFeedback = document.querySelector<HTMLElement>('#update-feedback')!;
const updateStatus = document.querySelector<HTMLElement>('#update-status')!;
const installedVersionLabel = document.querySelector<HTMLElement>('#installed-version')!;
const updateError = document.querySelector<HTMLElement>('#update-error')!;
const updateArtifact = document.querySelector<HTMLAnchorElement>('#update-artifact')!;
const updateAccess = document.querySelector<HTMLElement>('#update-access')!;
const updateHost = document.querySelector<HTMLElement>('#update-host')!;
const grantUpdateAccess = document.querySelector<HTMLButtonElement>('#grant-update-access')!;
const checkUpdatesButton = document.querySelector<HTMLButtonElement>('#check-updates')!;
const renderUpdateInstaller = createUpdateInstaller();
let savedUpdateSource = '';
let updateRender = 0;
let manualUpdateCheck = false;

let settings: Settings;
let hostsRender = 0;
const saveError = el('p', 'error');
saveError.hidden = true;
saveError.setAttribute('role', 'alert');
featuresBox.before(saveError);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function save() {
  try {
    await saveSettings(settings);
    saveError.hidden = true;
  } catch (error) {
    saveError.textContent = 'Не удалось сохранить настройки. Повторите изменение.';
    saveError.hidden = false;
    console.error('[Confluence Tools CI] Ошибка сохранения', error);
  }
}

// --- Вкладки ---

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
function selectTab(selected: HTMLButtonElement) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !active;
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
});

// --- Адреса ---

function showHostError(message: string) {
  hostError.textContent = message;
  hostError.hidden = !message;
}

async function renderHosts() {
  const render = ++hostsRender;
  const list = document.createDocumentFragment();
  if (!settings.hosts.length) {
    list.append(el('li', 'hint', 'Адреса не заданы — расширение нигде не работает.'));
  }
  for (const host of settings.hosts) {
    const origins = [hostToPattern(host)];
    const granted = await chrome.permissions.contains({ origins });
    const item = el('li');
    item.append(el('span', 'host', host));
    item.append(el('span', `status ${granted ? 'ok' : 'missing'}`, granted ? 'доступ выдан' : 'нет доступа'));
    if (!granted) {
      const grant = el('button', 'primary', 'Выдать доступ');
      grant.addEventListener('click', async () => {
        await chrome.permissions.request({ origins });
        await renderHosts();
      });
      item.append(grant);
    }
    const remove = el('button', '', 'Удалить');
    remove.addEventListener('click', async () => {
      settings.hosts = settings.hosts.filter((h) => h !== host);
      await save();
      // Доступ отзываем, только если этим же хостом не пользуется другой адрес из списка.
      if (!settings.hosts.some((h) => hostToPattern(h) === origins[0])) {
        await chrome.permissions.remove({ origins });
      }
      await renderHosts();
    });
    item.append(remove);
    list.append(item);
  }
  if (render === hostsRender) hostsList.replaceChildren(list);
}

hostForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showHostError('');
  const host = normalizeHost(hostInput.value);
  if (!host) return showHostError('Не удалось разобрать адрес. Пример: https://confluence.example.com');
  if (settings.hosts.includes(host)) return showHostError('Этот адрес уже есть в списке.');
  // Запрос разрешения должен идти сразу по действию пользователя, до других await.
  const granted = await chrome.permissions.request({ origins: [hostToPattern(host)] });
  settings.hosts.push(host);
  await save();
  hostInput.value = '';
  if (!granted) showHostError('Адрес добавлен, но доступ не выдан — нажмите «Выдать доступ».');
  await renderHosts();
});

// --- Обновления ---

async function renderUpdateStatus() {
  const render = ++updateRender;
  const stored = await chrome.storage.local.get([...UPDATE_CONFIG_KEYS, UPDATE_STATE_KEY]);
  const source = parseUpdateSource(storedUpdateSource(stored));
  const hasAccess = !!source && await chrome.permissions.contains({ origins: [source.permission] });
  if (render !== updateRender) return;
  savedUpdateSource = source?.url ?? '';
  updateAccess.hidden = !source || hasAccess;
  updateHost.textContent = source ? new URL(source.url).host : '';
  const installedVersion = chrome.runtime.getManifest().version;
  installedVersionLabel.textContent = installedVersion;
  const usesOfficialSource = savedUpdateSource === DEFAULT_UPDATE_SOURCE;
  const release = hasAccess && usesOfficialSource ? availableUpdate(stored, installedVersion) : null;
  void renderUpdateInstaller(release?.version ?? null, usesOfficialSource);
  const raw = stored[UPDATE_STATE_KEY];
  const state = isRecord(raw) && raw.source === savedUpdateSource && raw.installedVersion === installedVersion ? raw : {};
  const checking = state.checking === true;
  checkUpdatesButton.disabled = manualUpdateCheck || checking || !hasAccess;
  checkUpdatesButton.textContent = manualUpdateCheck || checking ? 'Проверяем…' : 'Проверить обновление';
  updateArtifact.hidden = true;
  updateArtifact.removeAttribute('href');
  updateStatus.className = 'hint';
  updateError.hidden = true;
  updateError.textContent = '';
  if (!source) { updateStatus.textContent = 'Проверка обновлений отключена.'; return; }
  if (!hasAccess) { updateStatus.textContent = 'Проверка ожидает разрешения Chrome.'; return; }
  const available = state.available === true;
  updateStatus.className = available ? 'update-available' : 'hint';
  updateStatus.textContent = available
    ? `Доступна новая версия${typeof state.version === 'string' ? `: ${state.version}` : '.'}${checking ? ' Проверяем повторно…' : ''}`
    : checking ? 'Проверяем обновления…' : state.checkedAt ? 'Новых обновлений не найдено.' : 'Обновления ещё не проверялись.';
  const download = parseUpdateSource(state.downloadUrl);
  if (available && download) {
    updateArtifact.href = download.url;
    updateArtifact.textContent = 'Открыть сборки';
    updateArtifact.hidden = false;
  }
  if (typeof state.error === 'string' && state.error) {
    updateError.hidden = false;
    updateError.textContent = state.error;
  }
}

function showUpdateFeedback(message: string, kind: 'hint' | 'error' = 'error') {
  updateFeedback.className = kind;
  updateFeedback.textContent = message;
  updateFeedback.hidden = false;
}

function sourceForUpdateAction() {
  updateFeedback.hidden = true;
  const source = parseUpdateSource(updateSourceInput.value);
  if (!source || source.url !== savedUpdateSource) {
    showUpdateFeedback('Сначала сохраните изменённый источник обновлений.');
    return null;
  }
  return source;
}

async function checkNow() {
  manualUpdateCheck = true;
  checkUpdatesButton.disabled = true;
  checkUpdatesButton.textContent = 'Проверяем…';
  try {
    await chrome.runtime.sendMessage({ type: 'check-updates' });
  } catch {
    showUpdateFeedback('Не удалось выполнить проверку. Перезагрузите расширение и повторите попытку.');
  } finally {
    manualUpdateCheck = false;
    await renderUpdateStatus();
  }
}

checkUpdatesButton.addEventListener('click', () => {
  if (sourceForUpdateAction()) void checkNow();
});

grantUpdateAccess.addEventListener('click', async () => {
  const source = sourceForUpdateAction();
  if (!source) return;
  grantUpdateAccess.disabled = true;
  try {
    // Chrome принимает запрос разрешения непосредственно из обработчика нажатия.
    const granted = await chrome.permissions.request({ origins: [source.permission] });
    if (!granted) {
      showUpdateFeedback('Доступ не выдан. Нажмите «Разрешить проверку обновлений», чтобы повторить запрос.');
      return;
    }
    if (source.url === savedUpdateSource) {
      showUpdateFeedback('Доступ выдан. Проверяем обновления…', 'hint');
      await checkNow();
      if (updateFeedback.className === 'hint') updateFeedback.hidden = true;
    }
  } catch {
    showUpdateFeedback('Не удалось запросить разрешение Chrome. Повторите попытку.');
  } finally {
    grantUpdateAccess.disabled = false;
  }
});

updateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = updateSourceInput.value.trim();
  const source = parseUpdateSource(input);
  if (input && !source) {
    showUpdateFeedback('Укажите полный HTTPS-адрес файла package.json.');
    return;
  }
  try {
    await chrome.storage.local.set({ [UPDATE_SOURCE_KEY]: source?.url ?? '' });
    savedUpdateSource = source?.url ?? '';
    updateSourceInput.value = source?.url ?? '';
    showUpdateFeedback(source ? 'Источник сохранён.' : 'Проверка обновлений отключена.', 'hint');
    await renderUpdateStatus();
  } catch (error) {
    showUpdateFeedback('Не удалось сохранить источник обновлений. Повторите попытку.');
    console.error('[Confluence Tools CI]', error);
  }
});

// --- Модули ---

function renderField(feature: FeatureDefinition, field: SettingField): HTMLElement[] {
  const values = settings.features[feature.id].values;
  const label = el('label', '', field.label);
  let control: HTMLElement;
  let fieldInput: HTMLInputElement;

  if (field.type === 'hotkey') {
    const input = el('input');
    input.type = 'text';
    input.readOnly = true;
    input.placeholder = 'не задано';
    // Пока поле в фокусе, оно ждёт нажатия — показываем это явно.
    input.addEventListener('focus', () => (input.placeholder = 'нажмите клавиши…'));
    input.addEventListener('blur', () => (input.placeholder = 'не задано'));
    const show = () => (input.value = formatHotkey(values[field.key]));
    show();
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Tab') return;
      event.preventDefault();
      const hotkey = eventToHotkey(event);
      // Сочетание без Ctrl/Alt/Meta мешало бы обычному набору текста.
      if (!hotkey || !(event.ctrlKey || event.altKey || event.metaKey)) return;
      const duplicate = findHotkeyConflict(definitions, settings, feature, field, hotkey);
      if (duplicate) {
        saveError.textContent = `Это сочетание уже задано: ${duplicate.feature.title} — ${duplicate.field.label}`;
        saveError.hidden = false;
        return;
      }
      values[field.key] = hotkey;
      show();
      await save();
    });
    const clear = el('button', '', 'Сбросить');
    clear.title = 'Отключить сочетание';
    clear.addEventListener('click', async () => {
      values[field.key] = '';
      show();
      await save();
    });
    fieldInput = input;
    control = el('div', 'hotkey');
    control.append(input, clear);
    input.title = 'Нажмите на поле и введите сочетание с Ctrl или Alt';
  } else if (field.type === 'boolean') {
    const input = el('input');
    input.type = 'checkbox';
    input.checked = values[field.key] === 'true';
    input.addEventListener('change', async () => {
      values[field.key] = String(input.checked);
      await save();
      // От флажка может зависеть вид других настроек.
      if (feature.settings.some((f) => f.enabledBy === field.key)) renderFeatures();
    });
    fieldInput = input;
    control = input;
  } else if (field.type === 'color') {
    const input = el('input');
    input.type = 'color';
    input.value = values[field.key];
    input.addEventListener('change', async () => {
      values[field.key] = input.value;
      await save();
    });
    fieldInput = input;
    control = input;
  } else {
    const input = el('input');
    input.type = 'text';
    input.value = values[field.key];
    input.addEventListener('change', async () => {
      values[field.key] = input.value;
      await save();
    });
    fieldInput = input;
    control = input;
  }
  label.htmlFor = fieldInput.id = `${feature.id}-${field.key}`;
  if (field.enabledBy && values[field.enabledBy] !== 'true') {
    label.classList.add('inactive');
    control.classList.add('inactive');
  }
  return [label, control];
}

function renderFeatures() {
  featuresBox.replaceChildren();
  for (const feature of definitions) {
    const state = settings.features[feature.id];
    const box = el('div', 'feature');

    const header = el('div', 'feature-header');
    const title = el('h3', 'feature-title', feature.title);
    title.id = `${feature.id}-title`;
    const switches = el('div', 'feature-switches');
    switches.setAttribute('role', 'radiogroup');
    switches.setAttribute('aria-labelledby', title.id);
    header.append(title, switches);

    // Настройки без группы идут общей сеткой, с группой — отдельным блоком с заголовком.
    const fields = el('div', 'settings');
    let grid: HTMLElement | null = null;
    let currentGroup: string | undefined;
    for (const field of feature.settings) {
      if (!grid || field.group !== currentGroup) {
        currentGroup = field.group;
        grid = el('div', 'fields');
        if (field.group) {
          const group = el('div', 'group');
          group.append(el('div', 'group-title', field.group), grid);
          fields.append(group);
        } else {
          fields.append(grid);
        }
      }
      grid.append(...renderField(feature, field));
    }
    fields.classList.toggle('disabled', !state.enabled);

    for (const [enabled, text] of [[true, 'Включена'], [false, 'Выключена']] as const) {
      const label = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = `${feature.id}-enabled`;
      radio.value = String(enabled);
      radio.checked = state.enabled === enabled;
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        state.enabled = enabled;
        fields.classList.toggle('disabled', !enabled);
        await save();
      });
      label.append(radio, text);
      switches.append(label);
    }

    box.append(header, el('p', 'hint', feature.description), fields);
    if (feature.settings.length) {
      const reset = el('button', 'reset', 'По умолчанию');
      reset.title = 'Вернуть все настройки этого модуля к значениям по умолчанию';
      reset.addEventListener('click', async () => {
        for (const field of feature.settings) state.values[field.key] = field.default;
        await save();
        renderFeatures();
      });
      box.append(reset);
    }
    featuresBox.append(box);
  }
}

async function init() {
  settings = await loadSettings();
  const unsubscribe = onSettingsChanged((current) => {
    if (JSON.stringify(current) === JSON.stringify(settings)) return;
    settings = current;
    renderFeatures();
    void renderHosts();
  });
  window.addEventListener('pagehide', () => unsubscribe(), { once: true });
  const updates = await chrome.storage.local.get(UPDATE_CONFIG_KEYS);
  updateSourceInput.value = storedUpdateSource(updates);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[UPDATE_SOURCE_KEY] || changes[UPDATE_STATE_KEY])) void renderUpdateStatus();
  });
  await renderUpdateStatus();
  renderFeatures();
  await renderHosts();
  const refreshAccess = () => {
    void renderHosts();
    void renderUpdateStatus();
  };
  chrome.permissions.onAdded.addListener(refreshAccess);
  chrome.permissions.onRemoved.addListener(refreshAccess);
}

void init();
