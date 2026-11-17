import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Confluence Tools CI',
    description: 'Набор инструментов для Confluence: быстрые действия в редакторе и операции со страницами',
    permissions: ['storage', 'scripting'],
    // Адреса Confluence задаются в настройках, доступ к ним запрашивается у пользователя.
    optional_host_permissions: ['*://*/*'],
    action: { default_title: 'Confluence Tools CI — настройки' },
  },
});
