import { defineConfig } from 'wxt';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const projectDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
let buildCommit = process.env.GITHUB_SHA ?? '';
if (!buildCommit) {
  try {
    buildCommit = execFileSync('git', ['-c', `safe.directory=${projectDir.replace(/\\/g, '/')}`, 'rev-parse', 'HEAD'],
      { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* При сборке архива без Git первая проверка запомнит текущий main. */ }
}

export default defineConfig({
  vite: () => ({ define: { __BUILD_COMMIT__: JSON.stringify(buildCommit) } }),
  manifest: {
    name: 'Confluence Tools CI',
    description: 'Набор инструментов для Confluence: быстрые действия в редакторе и операции со страницами',
    permissions: ['storage', 'scripting', 'notifications'],
    // Адреса Confluence задаются в настройках, доступ к ним запрашивается у пользователя.
    optional_host_permissions: ['*://*/*'],
    action: { default_title: 'Confluence Tools CI — настройки' },
  },
});
