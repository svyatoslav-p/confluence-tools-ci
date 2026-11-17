import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

test('у каждого модуля есть согласованные описание и реализация с уникальным id', () => {
  const folders = fs.readdirSync('features', { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const ids = new Set();
  for (const folder of folders) {
    const directory = path.join('features', folder.name);
    for (const file of ['definition.ts', 'index.ts']) {
      assert.ok(fs.existsSync(path.join(directory, file)), `${directory}: отсутствует ${file}`);
    }
    const definition = loadTs(path.join(directory, 'definition.ts')).default;
    const feature = loadTs(path.join(directory, 'index.ts')).default;
    assert.equal(typeof definition.id, 'string', `${directory}: id должен быть строкой`);
    assert.ok(definition.id.trim(), `${directory}: пустой id`);
    assert.equal(feature.id, definition.id, `${directory}: id описания и реализации различаются`);
    assert.equal(ids.has(definition.id), false, `${directory}: повторный id ${definition.id}`);
    ids.add(definition.id);
  }
});
