// Горячие клавиши хранятся по физическим клавишам (event.code), например «Alt+KeyZ»,
// поэтому работают одинаково в русской и английской раскладке.

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
