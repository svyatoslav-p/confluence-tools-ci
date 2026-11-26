// Приложение, работающее в контексте страницы Confluence (есть доступ к tinymce и AJS).
// Показывает плавающую кнопку с меню и запускает модули.
import { onBridge, postBridge } from './bridge';
import { features } from './registry';
import { THEME_CSS, watchTheme } from './theme';
import type { Feature, FeatureContext, MenuAction, NotifyKind, PageMode, Settings, TinyEditor } from './types';

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
  .menu-row { position: relative; display: flex; align-items: center; }
  .menu-row .menu-item { flex: 1; width: auto; white-space: nowrap; }
  .menu-info {
    flex: none; margin-right: 8px; width: 28px; height: 28px; border: 0;
    border-radius: 50%; background: none; color: var(--ct-text-muted); cursor: pointer;
    font: 18px Arial, sans-serif;
  }
  .menu-info:hover { background: var(--ct-bg-hover); }
  .menu-help {
    position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 1;
    width: 290px; max-width: calc(100vw - 56px); box-sizing: border-box;
    max-height: 40vh; overflow-y: auto; padding: 10px 14px;
    background: var(--ct-bg); color: var(--ct-text); border: 1px solid var(--ct-border);
    border-radius: 6px; box-shadow: 0 4px 12px var(--ct-shadow);
  }
  .menu-help[hidden] { display: none; }
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
  const editor = window.tinymce?.activeEditor;
  if (!editor || editor.removed || !editor.initialized) return null;
  try {
    return editor.getDoc() ? editor : null;
  } catch {
    return null;
  }
}

export function startApp(): (() => void) | undefined {
  if (window.top !== window || window.__confluenceExtLoaded || !isConfluencePage()) return;
  window.__confluenceExtLoaded = true;

  let settings: Settings | null = null;
  let editor: TinyEditor | null = null;
  const runningFeatures = new Map<string, { values: string; cleanup: () => void }>();
  let editorTimer: ReturnType<typeof setInterval> | undefined;
  let stopTheme: (() => void) | undefined;
  let disposed = false;
  const controller = new AbortController();
  const events = { signal: controller.signal };

  // --- Контейнер интерфейса ---
  const host = document.createElement('div');
  host.id = 'confluence-ext-root';
  host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
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
  button.setAttribute('aria-label', button.title);
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
  function stopFeature(id: string) {
    const running = runningFeatures.get(id);
    if (!running) return;
    runningFeatures.delete(id);
    try { running.cleanup(); } catch (error) { console.error('[Confluence Tools CI] Ошибка очистки модуля', error); }
  }

  function teardownEditor() {
    for (const id of runningFeatures.keys()) stopFeature(id);
  }

  function syncEditorFeatures() {
    for (const feature of features) {
      const state = settings?.features[feature.id];
      const values = JSON.stringify(state?.values);
      if (!editor || !state?.enabled || !feature.setupEditor) {
        stopFeature(feature.id);
        continue;
      }
      if (runningFeatures.get(feature.id)?.values === values) continue;
      stopFeature(feature.id);
      try {
        const cleanup = feature.setupEditor({ ...contextFor(feature), editor });
        runningFeatures.set(feature.id, { values, cleanup });
      } catch (error) {
        console.error(`[Confluence Tools CI] Модуль «${feature.title}» не запустился`, error);
      }
    }
  }

  function checkEditor() {
    const found = !disposed && settings?.enabled !== false && settings?.hosts.includes(location.origin) ? findEditor() : null;
    if (found === editor) return false;
    teardownEditor();
    editor = found;
    syncEditorFeatures();
    return true;
  }

  // --- Меню ---
  function actionAvailable(feature: Feature, action: MenuAction): boolean {
    const state = settings?.features[feature.id];
    const mode: PageMode = editor ? 'editor' : 'view';
    if (disposed || settings?.enabled === false || !settings?.hosts.includes(location.origin) || !state?.enabled) return false;
    if (action.mode !== 'any' && action.mode !== mode) return false;
    try {
      return action.visible?.(state.values) ?? true;
    } catch (error) {
      console.error(`[Confluence Tools CI] Ошибка доступности «${feature.title}: ${action.title}»`, error);
      return false;
    }
  }

  function renderMenu() {
    menu.replaceChildren();
    checkEditor();
    let count = 0;
    for (const feature of enabledFeatures()) {
      const actions = (feature.actions ?? []).filter((action) => actionAvailable(feature, action));
      if (!actions.length) continue;
      if (actions.length > 1) {
        const title = document.createElement('div');
        title.className = 'menu-title';
        title.textContent = feature.title;
        menu.append(title);
      }
      for (const action of actions) {
        count++;
        const item = menuItem(action.title, async () => {
            if (disposed) return;
            try {
              checkEditor();
              if (!actionAvailable(feature, action)) {
                notify('Это действие сейчас недоступно. Откройте меню заново.');
                return;
              }
              await action.run(contextFor(feature));
            } catch (error) {
              console.error(`[Confluence Tools CI] ${action.title}`, error);
              notify(`Ошибка: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
          });
        if (action.description) {
          const row = document.createElement('div');
          row.className = 'menu-row';
          const info = document.createElement('button');
          info.type = 'button';
          info.className = 'menu-info';
          info.textContent = 'ⓘ';
          info.setAttribute('aria-label', `О функции «${action.title}»`);
          info.setAttribute('aria-expanded', 'false');
          const help = document.createElement('div');
          help.className = 'menu-help';
          help.id = `help-${feature.id}-${action.id}`;
          help.setAttribute('role', 'tooltip');
          help.hidden = true;
          help.textContent = action.description;
          info.setAttribute('aria-controls', help.id);
          info.setAttribute('aria-describedby', help.id);
          info.addEventListener('click', () => {
            help.hidden = !help.hidden;
            info.setAttribute('aria-expanded', String(!help.hidden));
          });
          info.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              help.hidden = true;
              info.setAttribute('aria-expanded', 'false');
              event.stopPropagation();
            }
          });
          row.append(item, info, help);
          menu.append(row);
        } else menu.append(item);
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
    // Пункты пересоздаются при открытии меню: их обработчики живут вместе с узлами.
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => {
      menu.hidden = true;
      run();
    });
    return item;
  }

  button.addEventListener('mousedown', (event) => event.preventDefault(), events);
  button.addEventListener('click', () => {
    if (menu.hidden) renderMenu();
    menu.hidden = !menu.hidden;
  }, events);
  document.addEventListener('mousedown', (event) => {
    if (event.target !== host) menu.hidden = true;
  }, events);

  // При удалении адреса останавливаем UI, но сохраняем мост для повторного включения.
  function suspend() {
    teardownEditor();
    clearInterval(editorTimer);
    editorTimer = undefined;
    editor = null;
    stopTheme?.();
    stopTheme = undefined;
    clearTimeout(toastTimer);
    toast?.remove();
    toast = null;
    menu.hidden = true;
    menu.replaceChildren();
    host.remove();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    suspend();
    unsubscribe();
    controller.abort();
    delete window.__confluenceExtLoaded;
  }

  // При помещении в back/forward cache браузер сам приостанавливает страницу.
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) dispose();
  }, events);

  // --- Запуск ---
  const unsubscribe = onBridge((message) => {
    if (message.type === 'extension-reloaded') {
      notify('Расширение Confluence Tools CI было обновлено. Перезагрузите страницу.', 'error');
      return;
    }
    if (message.type !== 'settings') return;
    settings = message.settings;
    // Шаблоны доступа Chrome не учитывают порт: соблюдаем точный список адресов.
    if (settings.enabled === false || !settings.hosts.includes(location.origin)) {
      suspend();
      return;
    }
    if (!host.isConnected) {
      stopTheme = watchTheme(host);
      document.documentElement.append(host);
    }
    editorTimer ??= setInterval(checkEditor, EDITOR_POLL_MS);
    if (!checkEditor()) syncEditorFeatures();
  });
  postBridge({ type: 'get-settings' });
  return dispose;
}
