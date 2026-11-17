import { defineConfig } from 'wxt';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const builtAt = process.env.CT_BUILD_TIMESTAMP ?? new Date().toISOString();
if (!Number.isFinite(Date.parse(builtAt))) throw new Error('Invalid CT_BUILD_TIMESTAMP');
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const buildInfo = { version, builtAt, downloadUrl: 'https://github.com/svyatoslav-p/confluence-tools-ci/actions' };

export default defineConfig({
  vite: () => ({ define: { __BUILD_TIMESTAMP__: JSON.stringify(builtAt) } }),
  hooks: {
    'build:done': (wxt) => { writeFileSync(resolve(wxt.config.outDir, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n'); },
  },
  manifest: {
    name: 'Confluence Tools CI',
    description: 'Набор инструментов для Confluence: быстрые действия в редакторе и операции со страницами',
    permissions: ['storage', 'scripting'],
    optional_host_permissions: ['*://*/*'],
    action: { default_title: 'Confluence Tools CI — настройки' },
  },
});
