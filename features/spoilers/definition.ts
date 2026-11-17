import type { FeatureDefinition } from '../../core/types';

const definition: FeatureDefinition = {
  id: 'spoilers',
  title: 'Спойлеры',
  description: 'Разворачивает или сворачивает все спойлеры на текущей странице, включая вложенные.',
  settings: [
    { key: 'expandMacros', label: 'Обычные спойлеры (Expand)', type: 'boolean', default: 'true', group: 'Типы спойлеров' },
    { key: 'codeBlocks', label: 'Блоки кода (Code Block)', type: 'boolean', default: 'true', group: 'Типы спойлеров' },
  ],
};

export default definition;
