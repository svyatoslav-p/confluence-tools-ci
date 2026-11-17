// Панель быстрого форматирования: появляется над выделенным текстом в редакторе,
// пока зажат Ctrl. Те же действия доступны по горячим клавишам.
import definition from './definition';
import { eventToHotkey, formatHotkey } from '../../core/hotkeys';
import type { Feature, FeatureContext, TinyEditor } from '../../core/types';

type Values = Record<string, string>;

/** Ограничиваем обход DOM областью выделения и её родительскими пунктами. */
function selectedListItems(editor: TinyEditor): HTMLLIElement[] {
  const range = editor.selection.getRng();
  const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!(element instanceof editor.getDoc().defaultView!.Element)) return [];
  const items = new Set<HTMLLIElement>();
  for (const li of element.querySelectorAll<HTMLLIElement>('li')) {
    if (range.intersectsNode(li)) items.add(li);
  }
  for (let li = element.closest('li'); li; li = li.parentElement?.closest('li') ?? null) items.add(li);
  return [...items];
}

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
  for (const li of selectedListItems(editor)) before.set(li, li.getAttribute('style'));
  try {
    action();
  } finally {
    for (const [li, style] of before) {
      if (li.getAttribute('style') !== style) setStyleAttr(li, style);
    }
  }
}

/** Снимает цвет с самих пунктов списка, текст которых попал в выделение. */
function cleanListItemColors(items: HTMLLIElement[]) {
  for (const li of items) {
    if (!li.style.color) continue;
    li.style.color = '';
    setStyleAttr(li, li.getAttribute('style'));
  }
}

function clean(editor: TinyEditor) {
  editor.undoManager.transact(() => {
    const range = editor.selection.getRng();
    // Определяем пункты до RemoveFormat: команда может удалить узлы границ Range.
    const items = selectedListItems(editor).filter((li) =>
      [...li.childNodes].some((node) => !/^(OL|UL)$/.test(node.nodeName) && range.intersectsNode(node)),
    );
    editor.execCommand('RemoveFormat');
    cleanListItemColors(items);
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
  const controller = new AbortController();
  const events = { capture: true, signal: controller.signal };

  // --- Панель ---
  const style = document.createElement('style');
  style.textContent = STYLE;
  const toolbar = document.createElement('div');
  toolbar.className = 'st-toolbar';
  root.append(style, toolbar);
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Быстрое форматирование');

  function addButton(label: HTMLElement, title: string, hotkey: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.append(label);
    button.title = hotkey ? `${title} (${formatHotkey(hotkey)})` : title;
    button.setAttribute('aria-label', title);
    // mousedown + preventDefault: фокус и выделение остаются в редакторе.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('click', () => { run(action); });
    toolbar.append(button);
  }

  function label(text: string, color?: string, strike = false) {
    const span = document.createElement('span');
    span.textContent = text;
    if (color) span.style.color = color;
    if (strike) span.style.textDecoration = 'line-through';
    return span;
  }

  const actions = [
    { text: 'Tx', title: 'Очистить стиль', hotkey: values.hotkeyClean, run: () => clean(editor) },
    { text: 'A', title: 'Красный зачёркнутый', color: values.redColor, strike: true, hotkey: values.hotkeyRed, run: () => redStrike(editor, values) },
    { text: 'A', title: 'Зелёный', color: values.greenColor, hotkey: values.hotkeyGreen, run: () => paint(editor, values.greenColor) },
    { text: 'A', title: 'Жёлтый', color: values.yellowColor, hotkey: values.hotkeyYellow, run: () => paint(editor, values.yellowColor) },
  ];
  for (const action of actions) {
    addButton(label(action.text, action.color && editorColor(action.color), action.strike), action.title, action.hotkey, action.run);
  }

  // Режим «без Ctrl»: показываем панель после завершения выделения.
  const always = values.showWithoutCtrl === 'true';
  let ctrlAlone = false;
  let selecting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function run(action: () => void) {
    if (editor.selection.isCollapsed()) return;
    try { action(); } catch (error) {
      console.error('[Confluence Tools CI] Ошибка форматирования', error);
      ctx.notify('Не удалось изменить форматирование.', 'error');
    }
    hide();
  }

  function hide() {
    clearTimeout(timer);
    toolbar.style.display = 'none';
  }

  /**
   * Точка, где закончили выделять (там, где стоит курсор), в координатах редактора.
   * forward — выделяли слева направо / сверху вниз.
   */
  function selectionEnd(): { x: number; top: number; bottom: number; forward: boolean } {
    const range = editor.selection.getRng();
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
    const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
    const whole = (forward ? rects.at(-1) : rects[0]) ?? range.getBoundingClientRect();
    const x = forward ? whole.right : whole.left;
    return forward
      ? { x, top: whole.bottom, bottom: whole.bottom, forward }
      : { x, top: whole.top, bottom: whole.top, forward };
  }

  function show() {
    if (selecting || !editorDoc.hasFocus() || (!always && !ctrlAlone) || editor.selection.isCollapsed()) return hide();
    const end = selectionEnd();
    const frame = editor.iframeElement?.getBoundingClientRect();
    const frameLeft = frame?.left ?? 0;
    const frameTop = frame?.top ?? 0;
    const caretTop = frameTop + end.top;
    const caretBottom = frameTop + end.bottom;
    if (caretBottom < Math.max(0, frameTop) || caretTop > Math.min(window.innerHeight, frame?.bottom ?? window.innerHeight)) return hide();
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
  const hotkeys = new Map(actions.filter((action) => action.hotkey).map((action) => [action.hotkey, action.run]));

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
    if (event.isComposing || editor.selection.isCollapsed()) return;
    const hotkey = eventToHotkey(event);
    const action = hotkey && hotkeys.get(hotkey);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    run(action);
  }

  for (const doc of [editorDoc, document]) {
    doc.addEventListener('keydown', onKeyDown, events);
    doc.addEventListener('keyup', onKeyUp, events);
  }
  editorDoc.addEventListener('keydown', onEditorHotkey, events);
  if (always) {
    // Пока тянут мышью, панель не показываем — только когда кнопку отпустили.
    editorDoc.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      selecting = true;
      hide();
    }, events);
    for (const doc of [editorDoc, document]) {
      doc.addEventListener('mouseup', (event) => {
        if (event.button !== 0 || !selecting) return;
        selecting = false;
        schedule();
      }, events);
    }
    // Выделение с клавиатуры (Shift+стрелки) и двойным щелчком.
    editorDoc.addEventListener('selectionchange', () => {
      if (!selecting) schedule();
    }, events);
  }
  // При прокрутке панель переезжает вслед за выделением.
  for (const target of [editorDoc, window]) {
    target.addEventListener('scroll', () => {
      if (toolbar.style.display !== 'none') show();
    }, events);
  }
  editorDoc.defaultView?.addEventListener('blur', () => {
    selecting = false;
    ctrlAlone = false;
    hide();
  }, events);
  window.addEventListener('resize', hide, events);
  window.addEventListener('blur', () => {
    // Фокус между страницей и iframe редактора переходит без потери Ctrl,
    // поэтому сбрасываем состояние только когда окно действительно неактивно.
    if (!document.hasFocus()) {
      selecting = false;
      ctrlAlone = false;
      hide();
    }
  }, events);

  return () => {
    clearTimeout(timer);
    controller.abort();
    style.remove();
    toolbar.remove();
  };
}

const feature: Feature = { ...definition, setupEditor };

export default feature;
