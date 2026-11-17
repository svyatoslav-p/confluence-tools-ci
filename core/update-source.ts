export const UPDATE_REPOSITORY_KEY = 'updateRepository';

/** Для проверки нужен только публичный GitHub-репозиторий и ветка main. */
export function parseUpdateRepository(input: unknown): { url: string; api: string } | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const url = new URL(input.trim());
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
    if (!match || match[2] === '.' || match[2] === '..') return null;
    const project = `${match[1]}/${match[2]}`;
    return { url: `https://github.com/${project}`, api: `https://api.github.com/repos/${project}` };
  } catch {
    return null;
  }
}
