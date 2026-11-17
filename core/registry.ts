import type { Feature } from './types';

// Только приложение страницы импортирует реализации; служебные части используют definitions.ts.
const modules = import.meta.glob<{ default: Feature }>('../features/*/index.ts', { eager: true });

export const features: Feature[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id));
