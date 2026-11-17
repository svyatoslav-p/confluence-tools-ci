// Выполняется после сборки: npm run test:bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = '.output/chrome-mv3';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
// Vite выносит общие для options и popup описания/хранилище в отдельный chunk.
function readScript(file, seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  const code = read(file);
  const imports = [...code.matchAll(/\bfrom\s*["'](\.[^"']+\.js)["']|\bimport\s*["'](\.[^"']+\.js)["']/g)];
  return code + imports.map((match) => readScript(path.join(path.dirname(file), match[1] ?? match[2]), seen)).join('');
}
test('версия установленного расширения совпадает с package.json', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(fs.existsSync(path.join(root, 'build-info.json')), false);
  assert.equal(manifest.action.default_popup, 'popup.html');
});

test('popup содержит только описания модулей без реализации', () => {
  const file = fs.readdirSync(path.join(root, 'chunks')).find((name) => name.startsWith('popup-') && name.endsWith('.js'));
  assert.ok(file, 'Popup bundle missing');
  const popup = readScript('chunks/' + file);
  assert.ok(popup.includes('historyHeading'));
  assert.ok(!popup.includes('st-toolbar'));
  assert.ok(!popup.includes('body.storage'));
});
for (const file of ['background.js', 'bridge.js']) {
  test(file + ' не содержит реализацию панели', () => {
    const code = read(file);
    assert.ok(!code.includes('st-toolbar'));
    assert.ok(!code.includes('forecolor'));
  });
}
test('background содержит только адреса, без каталога настроек функций', () => {
  assert.ok(!read('background.js').includes('Панель быстрого форматирования'));
  assert.ok(!read('background.js').includes('hotkeyClean'));
});
test('настройки содержат описание панели, а реализация остаётся только в app.js', () => {
  const file = fs.readdirSync(path.join(root, 'chunks')).find((name) => name.startsWith('options-') && name.endsWith('.js'));
  assert.ok(file, 'Options bundle missing');
  const options = readScript('chunks/' + file);
  assert.ok(options.includes('hotkeyClean'));
  assert.ok(!options.includes('st-toolbar'));
  assert.ok(!options.includes('forecolor'));
  assert.ok(read('app.js').includes('st-toolbar'));
  assert.ok(read('app.js').includes('forecolor'));
});
