import type { FeatureDefinition } from './types';

// Служебные контексты импортируют только данные, никогда index.ts с реализацией.
const modules = import.meta.glob<{ default: FeatureDefinition }>('../features/*/definition.ts', { eager: true });

// Чистое построение каталога позволяет сборщику убрать его, если нужны только hosts.
export const definitions: FeatureDefinition[] = /* @__PURE__ */ (() => Object.values(modules)
  .map((module) => module.default)
  .sort((a, b) => a.id.localeCompare(b.id)))();
