// Запускает исходные TS-модули в Node; Chrome/DOM подставляются явно в тестах.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

export function loadTs(filename, { globals = {}, imports = {} } = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = fs.readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const require = (name) => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (!name.startsWith('.')) throw new Error('Unexpected import: ' + name);
      return load(path.resolve(path.dirname(file), name + '.ts'));
    };
    vm.runInNewContext(code, { module, exports: module.exports, require, console, URL, setTimeout, clearTimeout,
      setInterval, clearInterval, AbortController, ...globals }, { filename: file });
    return module.exports;
  }
  return load(filename);
}
