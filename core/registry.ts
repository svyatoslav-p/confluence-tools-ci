import type { Feature } from './types';

// Модули подхватываются автоматически: достаточно создать features/<имя>/index.ts.
const modules = import.meta.glob<{ default: Feature }>('../features/*/index.ts', { eager: true });

export const features: Feature[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id));
