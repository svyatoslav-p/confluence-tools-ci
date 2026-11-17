// Приложение, работающее в контексте страницы Confluence (есть доступ к tinymce и AJS).
// Показывает плавающую кнопку с меню и запускает модули.
import { onBridge, postBridge } from './bridge';
import { features } from './registry';
import { THEME_CSS, watchTheme } from './theme';
import type { Feature, FeatureContext, NotifyKind, PageMode, Settings, TinyEditor } from './types';

const EDITOR_POLL_MS = 700;

const STYLE = `
  :host { all: initial; }
  ${THEME_CSS}
  .launcher {
    /* Отступ снизу больше, чтобы не закрывать панель сохранения редактора. */
    position: fixed; right: 20px; bottom: 64px;
    font: 14px/1.4 Arial, sans-serif; color: var(--ct-text);
  }
  .launcher-button {
    display: flex; align-items: center; justify-content: center; padding: 0;
    width: 40px; height: 40px; border: 0; border-radius: 50%; cursor: pointer;
    background: var(--ct-accent); color: var(--ct-accent-text); font: 700 16px Arial, sans-serif;
    box-shadow: 0 2px 10px var(--ct-shadow);
  }
  .launcher-button:hover { background: var(--ct-accent-hover); }
  .menu {
    position: absolute; right: 0; bottom: 48px; min-width: 240px; padding: 6px 0;
    background: var(--ct-bg); border: 1px solid var(--ct-border); border-radius: 6px;
    box-shadow: 0 4px 12px var(--ct-shadow);
  }
  .menu[hidden] { display: none; }
  .menu-title { padding: 6px 14px 2px; font-size: 11px; color: var(--ct-text-muted); text-transform: uppercase; }
  .menu-item {
    display: block; width: 100%; padding: 7px 14px; border: 0; background: none;
    font: inherit; color: inherit; text-align: left; cursor: pointer;
  }
  .menu-item:hover { background: var(--ct-bg-hover); }
  .menu-empty { padding: 7px 14px; color: var(--ct-text-muted); }
  .menu-separator { height: 1px; margin: 6px 0; background: var(--ct-border); }
  .toast {
    position: fixed; top: 20px; right: 20px; max-width: 320px; padding: 12px 16px;
    border-radius: 6px; font: 14px/1.4 Arial, sans-serif;
    box-shadow: 0 4px 12px var(--ct-shadow);
  }
  .toast-info { background: var(--ct-info-bg); color: var(--ct-info-text); }
  .toast-success { background: var(--ct-success-bg); color: var(--ct-success-text); }
  .toast-error { background: var(--ct-error-bg); color: var(--ct-error-text); }
`;

/** Волшебная палочка — тот же значок, что на иконке расширения (assets/icon.svg). */
const ICON_SVG = `<svg viewBox="14 14 104 104" width="24" height="24" aria-hidden="true"><path d="M30 98 L70 58" stroke="currentColor" stroke-width="13" stroke-linecap="round" fill="none"/> <path fill="currentColor" d="M86 16 L93.28 34.72 L112 42 L93.28 49.28 L86 68 L78.72 49.28 L60 42 L78.72 34.72 Z"/> <path fill="currentColor" d="M46 23 L49.08 30.92 L57 34 L49.08 37.08 L46 45 L42.92 37.08 L35 34 L42.92 30.92 Z"/> <path fill="currentColor" d="M98 76 L101.36 84.64 L110 88 L101.36 91.36 L98 100 L94.64 91.36 L86 88 L94.64 84.64 Z"/></svg>`;

function isConfluencePage(): boolean {
  return document.querySelector('meta[name="ajs-version-number"], meta[name="ajs-context-path"]') !== null;
}

function findEditor(): TinyEditor | null {
  const editor = (window as any).tinymce?.activeEditor as TinyEditor | undefined;
  if (!editor || editor.removed || !editor.initialized) return null;
  try {
    return editor.getDoc() ? editor : null;
  } catch {
    return null;
  }
}

export function startApp(): void {
  const flag = '__confluenceExtLoaded';
  if (window.top !== window || (window as any)[flag] || !isConfluencePage()) return;
  (window as any)[flag] = true;

  let settings: Settings | null = null;
  let editor: TinyEditor | null = null;
  let editorCleanups: Array<() => void> = [];

  // --- Контейнер интерфейса ---
  const host = document.createElement('div');
  host.id = 'confluence-ext-root';
  host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  watchTheme(host);
  const style = document.createElement('style');
  style.textContent = STYLE;
  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'launcher-button';
  button.innerHTML = ICON_SVG;
  button.title = 'Confluence Tools CI';
  launcher.append(menu, button);
  root.append(style, launcher);

  // --- Уведомления ---
  let toast: HTMLElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function notify(message: string, kind: NotifyKind = 'info') {
    toast?.remove();
    clearTimeout(toastTimer);
    toast = document.createElement('div');
    toast.className = `toast toast-${kind}`;
    toast.textContent = message;
    root.append(toast);
    toastTimer = setTimeout(() => toast?.remove(), kind === 'error' ? 6000 : 3000);
  }

  function contextFor(feature: Feature): FeatureContext {
    return { values: settings!.features[feature.id].values, editor, root, notify };
  }

  function enabledFeatures(): Feature[] {
    if (!settings) return [];
    return features.filter((f) => settings!.features[f.id]?.enabled);
  }

  // --- Модули в редакторе ---
  function teardownEditor() {
    for (const cleanup of editorCleanups) cleanup();
    editorCleanups = [];
  }

  function setupEditorFeatures() {
    teardownEditor();
    if (!editor) return;
    for (const feature of enabledFeatures()) {
      if (!feature.setupEditor) continue;
      try {
        editorCleanups.push(feature.setupEditor({ ...contextFor(feature), editor }));
      } catch (error) {
        console.error(`[Confluence Tools CI] Модуль «${feature.title}» не запустился`, error);
      }
    }
  }

  function checkEditor() {
    const found = findEditor();
    if (found === editor) return;
    editor = found;
    setupEditorFeatures();
  }

  // --- Меню ---
  function renderMenu() {
    menu.replaceChildren();
    const mode: PageMode = editor ? 'editor' : 'view';
    let count = 0;
    for (const feature of enabledFeatures()) {
      const values = settings!.features[feature.id].values;
      const actions = (feature.actions ?? []).filter(
        (a) => (a.mode === 'any' || a.mode === mode) && (a.visible?.(values) ?? true),
      );
      if (!actions.length) continue;
      const title = document.createElement('div');
      title.className = 'menu-title';
      title.textContent = feature.title;
      menu.append(title);
      for (const action of actions) {
        count++;
        menu.append(
          menuItem(action.title, async () => {
            try {
              await action.run(contextFor(feature));
            } catch (error) {
              console.error(`[Confluence Tools CI] ${action.title}`, error);
              notify(`Ошибка: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
          }),
        );
      }
    }
    if (!count) {
      const empty = document.createElement('div');
      empty.className = 'menu-empty';
      empty.textContent = 'Для этой страницы действий пока нет';
      menu.append(empty);
    }
    const separator = document.createElement('div');
    separator.className = 'menu-separator';
    menu.append(separator, menuItem('Настройки…', () => postBridge({ type: 'open-options' })));
  }

  function menuItem(title: string, run: () => void): HTMLElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.textContent = title;
    // preventDefault на mousedown сохраняет фокус и выделение в редакторе.
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => {
      menu.hidden = true;
      run();
    });
    return item;
  }

  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    if (menu.hidden) renderMenu();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('mousedown', (event) => {
    if (event.target !== host) menu.hidden = true;
  });

  // --- Запуск ---
  onBridge((message) => {
    if (message.type === 'extension-reloaded') {
      notify('Расширение Confluence Tools CI было обновлено. Перезагрузите страницу.', 'error');
      return;
    }
    if (message.type !== 'settings') return;
    const first = settings === null;
    settings = message.settings;
    if (first) {
      document.documentElement.append(host);
      setInterval(checkEditor, EDITOR_POLL_MS);
      checkEditor();
    } else {
      setupEditorFeatures();
    }
  });
  postBridge({ type: 'get-settings' });
}
