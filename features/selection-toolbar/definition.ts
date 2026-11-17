import type { FeatureDefinition } from '../../core/types';

const HOTKEYS_GROUP = 'Горячие клавиши';
const BUTTONS_GROUP = 'Кнопки панели';

const definition: FeatureDefinition = {
  id: 'selection-toolbar',
  title: 'Панель быстрого форматирования',
  description:
    'После завершения выделения появляется панель форматирования. Красный зачёркнутый текст — «Удалено», зелёный — «Добавлено», жёлтый — «Устарело». Можно включить показ только по Ctrl.',
  settings: [
    { key: 'showWithoutCtrl', label: 'Показывать панель сразу при выделении, без Ctrl', type: 'boolean', default: 'true' },
    { key: 'greenColor', label: 'Цвет «Добавлено»', type: 'color', default: '#1f845a' },
    { key: 'redColor', label: 'Цвет «Удалено»', type: 'color', default: '#c9372c' },
    { key: 'yellowColor', label: 'Цвет «Устарело»', type: 'color', default: '#946f00' },
    { key: 'showClean', label: 'Очистить стиль', type: 'boolean', default: 'false', group: BUTTONS_GROUP },
    { key: 'showDefault', label: 'Стиль по умолчанию', type: 'boolean', default: 'true', group: BUTTONS_GROUP },
    { key: 'showRed', label: 'Удалено', type: 'boolean', default: 'true', group: BUTTONS_GROUP },
    { key: 'showGreen', label: 'Добавлено', type: 'boolean', default: 'true', group: BUTTONS_GROUP },
    { key: 'showYellow', label: 'Устарело', type: 'boolean', default: 'true', group: BUTTONS_GROUP },
    { key: 'hotkeyClean', label: 'Очистить стиль', type: 'hotkey', default: 'Alt+KeyZ', group: HOTKEYS_GROUP },
    { key: 'hotkeyDefault', label: 'Стиль по умолчанию', type: 'hotkey', default: 'Alt+KeyB', group: HOTKEYS_GROUP },
    { key: 'hotkeyRed', label: 'Удалено', type: 'hotkey', default: 'Alt+KeyX', group: HOTKEYS_GROUP },
    { key: 'hotkeyGreen', label: 'Добавлено', type: 'hotkey', default: 'Alt+KeyC', group: HOTKEYS_GROUP },
    { key: 'hotkeyYellow', label: 'Устарело', type: 'hotkey', default: 'Alt+KeyV', group: HOTKEYS_GROUP },
  ],
};

export default definition;
