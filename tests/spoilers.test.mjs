import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

function fixture(states, { disabled = [], broken = [], missing = [], noContent = false, code = [], uninitialized = [] } = {}) {
  const clicks = []; let frames = 0;
  const buttons = states.map((expanded, i) => ({
    expanded, isConnected: true, disabled: disabled.includes(i),
    style: { display: uninitialized.includes(i) ? 'none' : '' },
    getAttribute: () => String(buttons[i].expanded),
    querySelector: () => ({ classList: { contains: () => buttons[i].expanded } }),
    click() { clicks.push(i); if (!broken.includes(i)) this.expanded = !this.expanded; },
  }));
  const containers = buttons.map((button, i) => ({ matches: () => !code.includes(i), querySelector: () => missing.includes(i) ? null : button }));
  const api = loadTs('features/spoilers/index.ts', { globals: {
    document: { querySelector: (selector) => {
      assert.equal(selector, '#main-content');
      return noContent ? null : { querySelectorAll: () => containers };
    } },
    requestAnimationFrame: (callback) => { frames++; callback(); },
  } });
  return { ...api, buttons, clicks, get frames() { return frames; } };
}

test('разворачивание меняет только закрытые блоки, повторный вызов ничего не переключает', async () => {
  const f = fixture([false, true, false]);
  let result = await f.setAllSpoilers(true);
  assert.deepEqual(f.clicks, [0, 2]); assert.equal(result.failed, 0); assert.equal(result.changed, 2);
  result = await f.setAllSpoilers(true);
  assert.equal(result.changed, 0); assert.deepEqual(f.clicks, [0, 2]);
});

test('вложенные спойлеры сворачиваются от детей к родителям', async () => {
  const f = fixture([true, true, true]);
  const result = await f.setAllSpoilers(false);
  assert.deepEqual(f.clicks, [2, 1, 0]); assert.equal(result.failed, 0);
});

test('нет содержимого или спойлеров — нет изменений; неизвестные элементы пропускаются', async () => {
  for (const f of [fixture([]), fixture([false], { noContent: true }), fixture([false], { missing: [0] })]) {
    const result = await f.setAllSpoilers(true);
    assert.equal(result.found, 0); assert.equal(result.changed, 0); assert.equal(result.failed, 0);
  }
});

test('заблокированные и неработающие кнопки не объявляются успешно переключёнными', async () => {
  const f = fixture([false, false, false], { disabled: [0], broken: [1] });
  const result = await f.setAllSpoilers(true);
  assert.deepEqual(f.clicks, [1, 2]); assert.equal(result.failed, 2);
});

test('большое число спойлеров обрабатывается с передачей управления браузеру', async () => {
  const f = fixture(Array(45).fill(false));
  await f.setAllSpoilers(true);
  assert.equal(f.clicks.length, 45); assert.equal(f.frames, 3);
});

test('один пункт меню при повторном вызове разворачивает и сворачивает все блоки', async () => {
  const f = fixture([false]); const messages = [];
  assert.equal(f.default.actions.length, 1);
  const [toggle] = f.default.actions;
  assert.equal(toggle.mode, 'view');
  assert.equal(toggle.title, 'Развернуть/Свернуть спойлеры');
  await toggle.run({ notify: (...args) => messages.push(args) });
  assert.equal(f.buttons[0].expanded, true);
  assert.equal(messages.at(-1)[1], 'success');
  await toggle.run({ notify: (...args) => messages.push(args) });
  assert.equal(f.buttons[0].expanded, false);
});

test('при смешанном состоянии общая команда сначала разворачивает все спойлеры', async () => {
  const f = fixture([true, false, true]);
  await f.default.actions[0].run({ notify() {} });
  assert.deepEqual(f.clicks, [1]);
  assert.ok(f.buttons.every((button) => button.expanded));
  await f.default.actions[0].run({ notify() {} });
  assert.ok(f.buttons.every((button) => !button.expanded));
});

test('блоки кода и Expand переключаются вместе с учётом смешанной вложенности', async () => {
  const f = fixture([false, false, true], { code: [1, 2] });
  await f.setAllSpoilers();
  assert.deepEqual(f.clicks, [0, 1]);
  await f.setAllSpoilers();
  assert.deepEqual(f.clicks, [0, 1, 2, 1, 0]);
  assert.ok(f.buttons.every((button) => !button.expanded));
});

test('выбор типов исключает неподходящие блоки из переключения и определения общего состояния', async () => {
  const f = fixture([true, false], { code: [1] });
  await f.setAllSpoilers(undefined, { codeBlocks: 'false' });
  assert.deepEqual(f.clicks, [0]); // Закрытый код не мешает свернуть все выбранные Expand.
  await f.setAllSpoilers(undefined, { expandMacros: 'false' });
  assert.deepEqual(f.clicks, [0, 1]);
  const result = await f.setAllSpoilers(undefined, { expandMacros: 'false', codeBlocks: 'false' });
  assert.equal(result.found, 0);
});

test('несворачиваемый и неинициализированный код пропускается', async () => {
  const f = fixture([false, false], { code: [0, 1], missing: [0], uninitialized: [1] });
  const result = await f.setAllSpoilers();
  assert.equal(result.found, 0); assert.deepEqual(f.clicks, []);
});
