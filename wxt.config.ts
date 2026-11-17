import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Confluence Tools CI',
    description: 'Набор инструментов для Confluence: быстрые действия в редакторе и операции со страницами',
    permissions: ['storage', 'scripting'],
    optional_host_permissions: ['*://*/*'],
    action: { default_title: 'Confluence Tools CI — настройки' },
  },
});
