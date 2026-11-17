import type { FeatureDefinition } from '../../core/types';

const HOTKEYS_GROUP = 'Горячие клавиши';

const definition: FeatureDefinition = {
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
};

export default definition;
