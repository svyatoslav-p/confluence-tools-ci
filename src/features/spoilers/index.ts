import type { Feature, FeatureContext } from '../../core/types';
import definition from './definition';

let running = false;

/** Штатные элементы управления сохраняют поведение обоих макросов Confluence. */
export async function setAllSpoilers(expanded?: boolean, values: Record<string, string> = {}) {
  const content = document.querySelector('#main-content');
  const targets: { control: HTMLElement; isExpanded: () => boolean }[] = [];
  // Общая выборка сохраняет порядок родителей/детей и для смешанных вложенных типов.
  for (const container of content?.querySelectorAll<HTMLElement>('.expand-container, .code[data-macro-name="code"]') ?? []) {
    if (container.matches('.expand-container')) {
      if (values.expandMacros === 'false') continue;
      const control = container.querySelector<HTMLButtonElement>(':scope > .expand-control button[aria-expanded]');
      if (control && ['true', 'false'].includes(control.getAttribute('aria-expanded') ?? '')) {
        targets.push({ control, isExpanded: () => control.getAttribute('aria-expanded') === 'true' });
      }
    } else {
      if (values.codeBlocks === 'false') continue;
      const control = container.querySelector<HTMLElement>(':scope > .codeHeader .collapse-source');
      const icon = control?.querySelector<HTMLElement>('.expand-control-icon');
      // Обычный несворачиваемый код и ещё не инициализированные макросы пропускаем.
      if (control && icon && control.style.display !== 'none') {
        targets.push({ control, isExpanded: () => icon.classList.contains('expanded') });
      }
    }
  }
  // Смешанное состояние сначала приводим к полностью раскрытой странице.
  expanded ??= targets.some((target) => !target.isExpanded());
  // Открываем родителей раньше детей; закрываем детей раньше родителей.
  if (!expanded) targets.reverse();
  let changed = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (target.control.isConnected && !(target.control as HTMLButtonElement).disabled && target.isExpanded() !== expanded) {
      target.control.click();
      changed++;
    }
    if ((i + 1) % 20 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  // Даём штатным обработчикам завершить обновление состояния перед сообщением об успехе.
  if (changed) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const failed = targets.filter((target) => !target.control.isConnected || target.isExpanded() !== expanded).length;
  return { found: targets.length, changed, failed, expanded };
}

async function run(ctx: FeatureContext) {
  if (running) { ctx.notify('Обработка спойлеров уже выполняется.'); return; }
  running = true;
  try {
    if (ctx.values?.expandMacros === 'false' && ctx.values?.codeBlocks === 'false') {
      ctx.notify('Выберите типы спойлеров в настройках модуля.'); return;
    }
    const result = await setAllSpoilers(undefined, ctx.values);
    const { expanded } = result;
    if (!result.found) { ctx.notify('Спойлеры выбранных типов на текущей странице не найдены.'); return; }
    if (result.failed) {
      ctx.notify(`Не удалось ${expanded ? 'развернуть' : 'свернуть'} спойлеры: ${result.failed} из ${result.found}.`, 'error');
      return;
    }
    const state = expanded ? 'развернуты' : 'свёрнуты';
    ctx.notify(result.changed ? `Все спойлеры ${state}.` : `Все спойлеры уже ${state}.`, 'success');
  } finally { running = false; }
}

const feature: Feature = {
  ...definition,
  actions: [
    { id: 'toggle-all', title: 'Развернуть/Свернуть спойлеры', mode: 'view', run },
  ],
};

export default feature;
