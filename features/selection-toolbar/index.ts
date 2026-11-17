// Панель быстрого форматирования: появляется над выделенным текстом в редакторе,
// пока зажат Ctrl. Те же действия доступны по горячим клавишам.
import { eventToHotkey, formatHotkey } from '../../core/hotkeys';
import type { Feature, FeatureContext, TinyEditor } from '../../core/types';

type Values = Record<string, string>;

/** Задержка перед показом, чтобы панель не мигала на Ctrl+C / Ctrl+V и при выделении мышью. */
const SHOW_DELAY_MS = 200;

/**
 * Цвета штатной палитры Confluence записываем так же, как кнопка цвета в редакторе:
 * через переменную темы. Тогда текст выглядит правильно и в светлой, и в тёмной теме.
 */
const CONFLUENCE_COLORS: Record<string, string> = {
  '#1f845a': 'var(--ds-background-accent-green-bolder, #1F845A)',
  '#c9372c': 'var(--ds-background-accent-red-bolder, #C9372C)',
  '#946f00': 'var(--ds-chart-yellow-bold-hovered, #946F00)',
};

function editorColor(color: string): string {
  return CONFLUENCE_COLORS[color.toLowerCase()] ?? color;
}

function setStyleAttr(element: Element, style: string | null) {
  // TinyMCE хранит копию стиля в data-mce-style и при сохранении берёт её.
  for (const name of ['style', 'data-mce-style']) {
    if (style) element.setAttribute(name, style);
    else element.removeAttribute(name);
  }
}

/**
 * TinyMCE при полностью выделенном пункте списка ставит цвет на сам <li>,
 * и его наследуют номера всех вложенных пунктов. Возвращаем <li> исходный стиль,
 * чтобы красился только выделенный текст.
 */
function keepListItemStyles(editor: TinyEditor, action: () => void) {
  const before = new Map<Element, string | null>();
  for (const li of editor.getBody().querySelectorAll('li')) before.set(li, li.getAttribute('style'));
  action();
  for (const [li, style] of before) {
    if (li.getAttribute('style') !== style) setStyleAttr(li, style);
  }
}

/** Снимает цвет с самих пунктов списка, текст которых попал в выделение. */
function cleanListItemColors(editor: TinyEditor, range: Range) {
  for (const li of editor.getBody().querySelectorAll<HTMLElement>('li[style]')) {
    const ownContent = [...li.childNodes].filter((node) => !/^(OL|UL)$/.test(node.nodeName));
    if (!li.style.color || !ownContent.some((node) => range.intersectsNode(node))) continue;
    li.style.color = '';
    setStyleAttr(li, li.getAttribute('style'));
  }
}

function clean(editor: TinyEditor) {
  editor.undoManager.transact(() => {
    const range = editor.selection.getRng().cloneRange();
    editor.execCommand('RemoveFormat');
    cleanListItemColors(editor, range);
  });
  editor.nodeChanged();
}

function paint(editor: TinyEditor, color: string) {
  editor.undoManager.transact(() => {
    keepListItemStyles(editor, () => {
      editor.formatter.apply('forecolor', { value: editorColor(color) });
    });
  });
  editor.nodeChanged();
}

function green(editor: TinyEditor, values: Values) {
  paint(editor, values.greenColor);
}

function yellow(editor: TinyEditor, values: Values) {
  paint(editor, values.yellowColor);
}

function redStrike(editor: TinyEditor, values: Values) {
  editor.undoManager.transact(() => {
    keepListItemStyles(editor, () => {
      editor.formatter.apply('forecolor', { value: editorColor(values.redColor) });
      editor.formatter.apply('strikethrough');
    });
  });
  editor.nodeChanged();
}

const STYLE = `
  .st-toolbar {
    position: fixed; display: none; gap: 4px; padding: 4px;
    background: var(--ct-bg); border: 1px solid var(--ct-border); border-radius: 6px;
    box-shadow: 0 2px 8px var(--ct-shadow);
    font: 600 14px/1 Arial, sans-serif;
  }
  .st-toolbar button {
    width: 30px; height: 30px; padding: 0; cursor: pointer;
    background: none; border: 1px solid transparent; border-radius: 4px;
    font: inherit; color: var(--ct-text);
  }
  .st-toolbar button:hover { background: var(--ct-bg-hover); border-color: var(--ct-border); }
`;

function setupEditor(ctx: FeatureContext & { editor: TinyEditor }): () => void {
  const { editor, values, root } = ctx;
  const editorDoc = editor.getDoc();
  const cleanups: Array<() => void> = [];

  function listen(target: EventTarget, type: string, handler: (event: any) => void) {
    target.addEventListener(type, handler, true);
    cleanups.push(() => target.removeEventListener(type, handler, true));
  }

  // --- Панель ---
  const style = document.createElement('style');
  style.textContent = STYLE;
  const toolbar = document.createElement('div');
  toolbar.className = 'st-toolbar';
  root.append(style, toolbar);
  cleanups.push(() => {
    style.remove();
    toolbar.remove();
  });

  function addButton(label: HTMLElement, title: string, hotkey: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.append(label);
    button.title = hotkey ? `${title} (${formatHotkey(hotkey)})` : title;
    // mousedown + preventDefault: фокус и выделение остаются в редакторе.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      action();
      hide();
    });
    toolbar.append(button);
  }

  function label(text: string, color?: string, strike = false) {
    const span = document.createElement('span');
    span.textContent = text;
    if (color) span.style.color = color;
    if (strike) span.style.textDecoration = 'line-through';
    return span;
  }

  addButton(label('Tx'), 'Очистить стиль', values.hotkeyClean, () => clean(editor));
  addButton(label('A', editorColor(values.redColor), true), 'Красный зачёркнутый', values.hotkeyRed, () =>
    redStrike(editor, values),
  );
  addButton(label('A', editorColor(values.greenColor)), 'Зелёный', values.hotkeyGreen, () => green(editor, values));
  addButton(label('A', editorColor(values.yellowColor)), 'Жёлтый', values.hotkeyYellow, () =>
    yellow(editor, values),
  );

  // Режим «без Ctrl»: панель показывается сразу, как только появилось выделение.
  const always = values.showWithoutCtrl === 'true';
  let ctrlAlone = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    toolbar.style.display = 'none';
  }

  /**
   * Точка, где закончили выделять (там, где стоит курсор), в координатах редактора.
   * forward — выделяли слева направо / сверху вниз.
   */
  function selectionEnd(): { x: number; top: number; bottom: number; forward: boolean } {
    const whole = editor.selection.getRng().getBoundingClientRect();
    const sel = editor.selection.getSel();
    let forward = true;
    if (sel?.anchorNode && sel.focusNode) {
      forward =
        sel.anchorNode === sel.focusNode
          ? sel.anchorOffset <= sel.focusOffset
          : Boolean(sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING);
      const caret = editorDoc.createRange();
      caret.setStart(sel.focusNode, sel.focusOffset);
      caret.collapse(true);
      const rect = caret.getClientRects()[0];
      if (rect) return { x: rect.left, top: rect.top, bottom: rect.bottom, forward };
    }
    // Курсор стоит на границе элемента и своих координат не имеет — берём край всего выделения.
    const x = whole.left + whole.width / 2;
    return forward
      ? { x, top: whole.bottom, bottom: whole.bottom, forward }
      : { x, top: whole.top, bottom: whole.top, forward };
  }

  function show() {
    if ((!always && !ctrlAlone) || editor.selection.isCollapsed()) return hide();
    const end = selectionEnd();
    const frame = editor.iframeElement?.getBoundingClientRect();
    const frameLeft = frame?.left ?? 0;
    const frameTop = frame?.top ?? 0;
    toolbar.style.display = 'flex';
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const minTop = Math.max(4, frameTop);
    const maxTop = window.innerHeight - height - 4;
    const above = frameTop + end.top - height - 8;
    const below = frameTop + end.bottom + 8;
    // Панель ставим с той стороны от курсора, где нет выделенного текста:
    // под курсором, если выделяли вниз, и над ним, если вверх.
    let top = end.forward ? below : above;
    if (top > maxTop) top = above;
    if (top < minTop) top = below;
    top = Math.max(4, Math.min(top, maxTop));
    const left = Math.max(4, Math.min(frameLeft + end.x - width / 2, window.innerWidth - width - 4));
    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
  }

  // --- Клавиатура ---
  const hotkeys: Record<string, () => void> = {};
  if (values.hotkeyClean) hotkeys[values.hotkeyClean] = () => clean(editor);
  if (values.hotkeyGreen) hotkeys[values.hotkeyGreen] = () => green(editor, values);
  if (values.hotkeyRed) hotkeys[values.hotkeyRed] = () => redStrike(editor, values);
  if (values.hotkeyYellow) hotkeys[values.hotkeyYellow] = () => yellow(editor, values);

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(show, SHOW_DELAY_MS);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (always) return;
    if (event.key === 'Control') {
      if (event.repeat) return;
      ctrlAlone = true;
      schedule();
      return;
    }
    // Нажата другая клавиша — это сочетание вроде Ctrl+C, панель не нужна.
    ctrlAlone = false;
    hide();
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!always && event.key === 'Control') {
      ctrlAlone = false;
      hide();
    }
  }

  function onEditorHotkey(event: KeyboardEvent) {
    const hotkey = eventToHotkey(event);
    const action = hotkey && hotkeys[hotkey];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  for (const doc of [editorDoc, document]) {
    listen(doc, 'keydown', onKeyDown);
    listen(doc, 'keyup', onKeyUp);
  }
  listen(editorDoc, 'keydown', onEditorHotkey);
  if (always) {
    // Пока тянут мышью, панель не показываем — только когда кнопку отпустили.
    let selecting = false;
    listen(editorDoc, 'mousedown', (event: MouseEvent) => {
      if (event.button !== 0) return;
      selecting = true;
      hide();
    });
    for (const doc of [editorDoc, document]) {
      listen(doc, 'mouseup', (event: MouseEvent) => {
        if (event.button !== 0 || !selecting) return;
        selecting = false;
        schedule();
      });
    }
    // Выделение с клавиатуры (Shift+стрелки) и двойным щелчком.
    listen(editorDoc, 'selectionchange', () => {
      if (!selecting) schedule();
    });
  }
  // При прокрутке панель переезжает вслед за выделением.
  for (const target of [editorDoc, window]) {
    listen(target, 'scroll', () => {
      if (toolbar.style.display !== 'none') show();
    });
  }
  listen(window, 'blur', () => {
    // Фокус между страницей и iframe редактора переходит без потери Ctrl,
    // поэтому сбрасываем состояние только когда окно действительно неактивно.
    if (!document.hasFocus()) {
      ctrlAlone = false;
      hide();
    }
  });

  return () => {
    clearTimeout(timer);
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // Документ редактора мог быть уже удалён.
      }
    }
  };
}

const HOTKEYS_GROUP = 'Горячие клавиши';

const feature: Feature = {
  id: 'selection-toolbar',
  title: 'Панель быстрого форматирования',
  description:
    'В редакторе выделите текст и зажмите Ctrl — над выделением появится панель: очистить стиль, красный зачёркнутый, зелёный, жёлтый. Панель можно показывать и без Ctrl.',
  settings: [
    { key: 'showWithoutCtrl', label: 'Показывать панель сразу при выделении, без Ctrl', type: 'boolean', default: 'false' },
    { key: 'greenColor', label: 'Цвет «зелёный»', type: 'color', default: '#1f845a' },
    { key: 'redColor', label: 'Цвет «красный»', type: 'color', default: '#c9372c' },
    { key: 'yellowColor', label: 'Цвет «жёлтый»', type: 'color', default: '#946f00' },
    { key: 'hotkeyClean', label: 'Очистить стиль', type: 'hotkey', default: 'Alt+KeyZ', group: HOTKEYS_GROUP },
    { key: 'hotkeyRed', label: 'Красный зачёркнутый', type: 'hotkey', default: 'Alt+KeyX', group: HOTKEYS_GROUP },
    { key: 'hotkeyGreen', label: 'Зелёный', type: 'hotkey', default: 'Alt+KeyC', group: HOTKEYS_GROUP },
    { key: 'hotkeyYellow', label: 'Жёлтый', type: 'hotkey', default: 'Alt+KeyV', group: HOTKEYS_GROUP },
  ],
  setupEditor,
};

export default feature;
