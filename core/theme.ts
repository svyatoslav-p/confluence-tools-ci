// Светлая и тёмная тема интерфейса расширения на странице Confluence.
// Тема повторяет тему самого Confluence и переключается автоматически.
// Модули не задают цвета напрямую, а используют переменные --ct-*.

export type Theme = 'light' | 'dark';

export const THEME_CSS = `
  :host {
    --ct-bg: #ffffff;
    --ct-bg-hover: #ebecf0;
    --ct-text: #172b4d;
    --ct-text-muted: #6b778c;
    --ct-border: #dfe1e6;
    --ct-shadow: rgba(9, 30, 66, .25);
    --ct-accent: #0052cc;
    --ct-accent-hover: #0065ff;
    --ct-accent-text: #ffffff;
    --ct-info-bg: #deebff;    --ct-info-text: #0747a6;
    --ct-success-bg: #e3fcef; --ct-success-text: #006644;
    --ct-error-bg: #ffebe6;   --ct-error-text: #bf2600;
  }
  :host([data-theme="dark"]) {
    --ct-bg: #282e33;
    --ct-bg-hover: #38414a;
    --ct-text: #c7d1db;
    --ct-text-muted: #8c9bab;
    --ct-border: #454f59;
    --ct-shadow: rgba(0, 0, 0, .6);
    --ct-accent: #579dff;
    --ct-accent-hover: #85b8ff;
    --ct-accent-text: #1d2125;
    --ct-info-bg: #09326c;    --ct-info-text: #cce0ff;
    --ct-success-bg: #164b35; --ct-success-text: #baf3db;
    --ct-error-bg: #5d1f1a;   --ct-error-text: #ffd5d2;
  }
`;

/** Текущая тема Confluence (атрибут data-color-mode появился в Confluence 9). */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-color-mode') === 'dark' ? 'dark' : 'light';
}

/** Проставляет тему контейнеру интерфейса и следит за её сменой в Confluence. */
export function watchTheme(host: HTMLElement): void {
  const apply = () => host.setAttribute('data-theme', currentTheme());
  apply();
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode'],
  });
}
