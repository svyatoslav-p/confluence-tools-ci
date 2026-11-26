import type { FeatureDefinition } from '../../core/types';

const definition: FeatureDefinition = {
  id: 'change-history',
  title: 'Добавить в историю',
  description: 'Создает запись в таблице История родительской страницы. Выполняется с дочерней страницы',
  settings: [
    { key: 'historyHeading', label: 'Заголовок раздела (пусто — искать по колонкам)', type: 'text', default: 'История', group: 'Поиск таблицы истории' },
    { key: 'historyTaskHeader', label: 'Название колонки SA Task', type: 'text', default: 'SA Task', group: 'Поиск таблицы истории' },
    { key: 'historyStoryHeader', label: 'Название колонки Story', type: 'text', default: 'Story', group: 'Поиск таблицы истории' },
    { key: 'historyAnalystHeader', label: 'Название колонки ответственного аналитика', type: 'text', default: 'Ответственный аналитик', group: 'Поиск таблицы истории' },
    { key: 'historyDescriptionHeader', label: 'Название колонки описания', type: 'text', default: 'Описание', group: 'Поиск таблицы истории' },
    { key: 'historyVersionHeader', label: 'Название колонки версии', type: 'text', default: 'Версия', group: 'Поиск таблицы истории' },
  ],
};

export default definition;
