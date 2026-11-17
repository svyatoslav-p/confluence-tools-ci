// Страница настроек. Блоки модулей строятся из описаний Feature.settings.
import { eventToHotkey, formatHotkey } from '../../core/hotkeys';
import { features } from '../../core/registry';
import { hostToPattern, normalizeHost } from '../../core/settings';
import { loadSettings, saveSettings } from '../../core/storage';
import type { Feature, SettingField, Settings } from '../../core/types';

const hostsList = document.querySelector<HTMLUListElement>('#hosts')!;
const hostForm = document.querySelector<HTMLFormElement>('#host-form')!;
const hostInput = document.querySelector<HTMLInputElement>('#host-input')!;
const hostError = document.querySelector<HTMLElement>('#host-error')!;
const featuresBox = document.querySelector<HTMLElement>('#features')!;

let settings: Settings;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function save() {
  await saveSettings(settings);
}

// --- Адреса ---

function showHostError(message: string) {
  hostError.textContent = message;
  hostError.hidden = !message;
}

async function renderHosts() {
  hostsList.replaceChildren();
  if (!settings.hosts.length) {
    hostsList.append(el('li', 'hint', 'Адреса не заданы — расширение нигде не работает.'));
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
    hostsList.append(item);
  }
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

// --- Модули ---

function renderField(feature: Feature, field: SettingField): HTMLElement[] {
  const values = settings.features[feature.id].values;
  const label = el('label', '', field.label);
  let control: HTMLElement;

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
    control = input;
  } else if (field.type === 'color') {
    const input = el('input');
    input.type = 'color';
    input.value = values[field.key];
    input.addEventListener('change', async () => {
      values[field.key] = input.value;
      await save();
    });
    control = input;
  } else {
    const input = el('input');
    input.type = 'text';
    input.value = values[field.key];
    input.addEventListener('change', async () => {
      values[field.key] = input.value;
      await save();
    });
    control = input;
  }
  label.htmlFor = control.id = `${feature.id}-${field.key}`;
  if (field.enabledBy && values[field.enabledBy] !== 'true') {
    label.classList.add('inactive');
    control.classList.add('inactive');
  }
  return [label, control];
}

function renderFeatures() {
  featuresBox.replaceChildren();
  for (const feature of features) {
    const state = settings.features[feature.id];
    const box = el('div', 'feature');

    const header = el('label', 'feature-header');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = state.enabled;
    header.append(toggle, feature.title);

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

    toggle.addEventListener('change', async () => {
      state.enabled = toggle.checked;
      fields.classList.toggle('disabled', !state.enabled);
      await save();
    });

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
  renderFeatures();
  await renderHosts();
  chrome.permissions.onAdded.addListener(() => void renderHosts());
  chrome.permissions.onRemoved.addListener(() => void renderHosts());
}

void init();
