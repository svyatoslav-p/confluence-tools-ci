// Горячие клавиши хранятся по физическим клавишам (event.code), например «Alt+KeyZ»,
// поэтому работают одинаково в русской и английской раскладке.
import type { FeatureDefinition, SettingField, Settings } from './types';

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** Строка сочетания для события клавиатуры или null, если нажат только модификатор. */
export function eventToHotkey(event: KeyboardEvent): string | null {
  if (!event.code || MODIFIER_CODES.test(event.code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(event.code);
  return parts.join('+');
}

/** Проверка сохранённого сочетания с Ctrl, Alt или Meta. */
export function isHotkey(value: string): boolean {
  if (value === '') return true;
  if (!/^(Ctrl\+)?(Alt\+)?(Shift\+)?(Meta\+)?[A-Za-z][A-Za-z0-9]*$/.test(value)) return false;
  const parts = value.split('+');
  const code = parts.pop()!;
  return !MODIFIER_CODES.test(code) && parts.some((part) => ['Ctrl', 'Alt', 'Meta'].includes(part));
}

/** Вид сочетания для показа пользователю: «Alt+KeyZ» → «Alt+Z». */
export function formatHotkey(hotkey: string): string {
  return hotkey.replace(/\b(Key|Digit)(?=\w$)/, '');
}

/** Проверяем и выключенные модули, чтобы их включение не создавало конфликт. */
export function findHotkeyConflict(
  features: FeatureDefinition[], settings: Settings,
  feature: FeatureDefinition, field: SettingField, hotkey: string,
): { feature: FeatureDefinition; field: SettingField } | undefined {
  if (!hotkey) return;
  const mode = field.hotkeyMode ?? 'any';
  for (const otherFeature of features) {
    for (const otherField of otherFeature.settings) {
      if (otherField.type !== 'hotkey') continue;
      if (otherFeature.id === feature.id && otherField.key === field.key) continue;
      const otherMode = otherField.hotkeyMode ?? 'any';
      if (mode !== 'any' && otherMode !== 'any' && mode !== otherMode) continue;
      const value = settings.features[otherFeature.id]?.values[otherField.key] ?? otherField.default;
      if (value === hotkey) return { feature: otherFeature, field: otherField };
    }
  }
}
