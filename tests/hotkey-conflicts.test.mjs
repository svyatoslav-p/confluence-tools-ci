import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTs } from './load-ts.mjs';

const { findHotkeyConflict } = loadTs('core/hotkeys.ts');

test('сочетания проверяются между модулями только при пересечении контекстов', () => {
  const field = { key: 'key', type: 'hotkey', hotkeyMode: 'editor', default: 'Alt+KeyB' };
  const panel = { id: 'panel', settings: [field] };
  const otherField = { ...field };
  const other = { id: 'other', settings: [otherField] };
  const features = [panel, other];
  const settings = { features: { panel: { enabled: true, values: { key: 'Alt+KeyB' } },
    other: { enabled: false, values: { key: 'Alt+KeyB' } } } };
  assert.equal(findHotkeyConflict(features, settings, panel, field, 'Alt+KeyB').feature.id, 'other');
  otherField.hotkeyMode = 'view';
  assert.equal(findHotkeyConflict(features, settings, panel, field, 'Alt+KeyB'), undefined);
  delete otherField.hotkeyMode;
  assert.equal(findHotkeyConflict(features, settings, panel, field, 'Alt+KeyB').feature.id, 'other');
  settings.features.other.values.key = '';
  assert.equal(findHotkeyConflict(features, settings, panel, field, 'Alt+KeyB'), undefined);
  assert.equal(findHotkeyConflict(features, settings, panel, field, ''), undefined);
});
