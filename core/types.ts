/** Минимальное описание TinyMCE-редактора Confluence (TinyMCE 7). */
export interface TinyEditor {
  initialized?: boolean;
  removed?: boolean;
  iframeElement?: HTMLIFrameElement;
  getDoc(): Document;
  getBody(): HTMLElement;
  focus(): void;
  nodeChanged(): void;
  execCommand(command: string, ui?: boolean, value?: unknown): boolean;
  selection: {
    getRng(): Range;
    setRng(range: Range): void;
    getBookmark(): object;
    moveToBookmark(bookmark: object): void;
    getSel(): Selection | null;
    isCollapsed(): boolean;
  };
  formatter: {
    register(name: string, format: Record<string, unknown>): void;
    apply(name: string, vars?: Record<string, string>): void;
    remove(name: string, vars?: Record<string, string>): void;
  };
  undoManager: {
    transact(callback: () => void): unknown;
  };
}

declare global {
  interface Window {
    tinymce?: { activeEditor?: TinyEditor };
    __confluenceExtLoaded?: boolean;
  }
}

/** Значения всех настроек хранятся строками; у 'boolean' это 'true' или 'false'. */
export type FieldType = 'color' | 'hotkey' | 'text' | 'boolean';

/** Одна настройка модуля. Страница настроек строится из этих описаний. */
export interface SettingField {
  key: string;
  label: string;
  type: FieldType;
  default: string;
  /** Заголовок группы. Соседние настройки с одинаковой группой показываются одним блоком. */
  group?: string;
  /** Ключ настройки-флажка: пока он выключен, эта настройка показана неактивной. */
  enabledBy?: string;
  /** Контекст горячей клавиши. Без ограничения считается доступной на всех страницах. */
  hotkeyMode?: PageMode | 'any';
}

export type PageMode = 'view' | 'editor';

export type NotifyKind = 'info' | 'success' | 'error';

/** То, что каркас даёт модулю во время работы на странице. */
export interface FeatureContext {
  /** Значения настроек модуля (с подставленными значениями по умолчанию). */
  values: Record<string, string>;
  /** Активный редактор или null в режиме просмотра. */
  editor: TinyEditor | null;
  /**
   * Изолированный контейнер (Shadow DOM) для собственных элементов интерфейса.
   * Цвета берите из переменных --ct-* (core/theme.ts): они сами переключаются
   * между светлой и тёмной темой.
   */
  root: ShadowRoot;
  notify(message: string, kind?: NotifyKind): void;
}

/** Пункт плавающего меню. */
export interface MenuAction {
  id: string;
  title: string;
  /** Текст справки по отдельной кнопке рядом с действием. */
  description?: string;
  /** В каком режиме страницы пункт доступен. */
  mode: PageMode | 'any';
  /** Если задано и возвращает false, пункт в меню не показывается (зависит от настроек модуля). */
  visible?(values: Record<string, string>): boolean;
  run(ctx: FeatureContext): void | Promise<void>;
}

/** Только данные: доступны настройкам, хранилищу и мосту без загрузки реализации. */
export interface FeatureDefinition {
  id: string;
  title: string;
  description: string;
  settings: SettingField[];
}

/** Реализация features/<имя>/index.ts, выполняемая только приложением страницы. */
export interface Feature extends FeatureDefinition {
  /** Пункты плавающего меню. */
  actions?: MenuAction[];
  /**
   * Вызывается, когда на странице появился редактор.
   * Возвращает функцию, которая убирает всё, что модуль добавил.
   */
  setupEditor?(ctx: FeatureContext & { editor: TinyEditor }): () => void;
}

export interface FeatureState {
  enabled: boolean;
  values: Record<string, string>;
}

export interface Settings {
  /** Общая приостановка функций; настройки отдельных модулей сохраняются. */
  enabled: boolean;
  /** Адреса Confluence, на которых работает расширение. */
  hosts: string[];
  features: Record<string, FeatureState>;
}

