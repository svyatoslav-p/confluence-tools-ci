import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { loadTs } from './load-ts.mjs';

const version = '0.1.5';
const name = 'Confluence Tools CI';
const manifest = { name, version, manifest_version: 3 };
const files = Object.fromEntries(['background.js', 'bridge.js', 'app.js', 'options.html', 'popup.html']
  .map((path) => [path, strToU8(path)]));
files['manifest.json'] = strToU8(JSON.stringify(manifest));

const dependencies = { fflate: { strFromU8, unzipSync } };
const { readReleaseZip } = loadTs('core/update-release.ts', { imports: dependencies });

test('выбор папки передаёт Chrome допустимый идентификатор и запрашивает запись', async () => {
  const folder = {};
  const window = { async showDirectoryPicker({ id, mode }) {
    assert.equal(this, window);
    assert.match(id, /^[a-zA-Z0-9_-]{1,32}$/);
    assert.equal(mode, 'readwrite');
    return folder;
  } };
  const { chooseInstallFolder } = loadTs('core/local-install.ts', { globals: { window } });
  assert.equal(await chooseInstallFolder(), folder);
});

test('кнопка установки видна до обнаружения новой версии и активируется после проверки', async () => {
  const controls = new Map(['panel', 'hint', 'button', 'folder', 'status'].map((key) =>
    [key, { hidden: true, disabled: true, textContent: '', addEventListener() {} }]));
  const selectors = {
    '#install-update-panel': 'panel', '#install-update-hint': 'hint', '#install-update': 'button',
    '#choose-update-folder': 'folder', '#install-update-status': 'status',
  };
  const { createUpdateInstaller } = loadTs('entrypoints/options/install-update.ts', {
    globals: {
      document: { querySelector: (selector) => controls.get(selectors[selector]) },
      chrome: {
        management: { getSelf: async () => ({ installType: 'development' }) },
        runtime: { getManifest: () => manifest },
        permissions: { contains: async () => true, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
      },
    },
    imports: {
      '../../core/local-install': { supportsLocalInstall: () => true, loadInstallFolder: async () => undefined },
      '../../core/update-release': { RELEASE_PERMISSIONS: { origins: [] } },
    },
  });
  const render = createUpdateInstaller();
  const panel = controls.get('panel');
  const button = controls.get('button');
  const hint = controls.get('hint');
  await render(null, true);
  assert.equal(panel.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Установить обновление');
  assert.match(hint.textContent, /после обнаружения новой версии/);
  await render('0.1.6', true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Установить обновление 0.1.6');
  await render(null, false);
  assert.equal(panel.hidden, false);
  assert.equal(button.disabled, true);
  assert.match(hint.textContent, /официального источника/);
});

test('распаковка проверяет версию, состав и пути ZIP перед установкой Windows', () => {
  assert.equal(readReleaseZip(zipSync(files), version, name).size, 6);
  assert.throws(() => readReleaseZip(zipSync(files), '0.1.6', name), /Манифест/);
  const { 'bridge.js': omitted, ...incomplete } = files;
  assert.throws(() => readReleaseZip(zipSync(incomplete), version, name), /bridge\.js/);
  for (const path of ['../other.js', '/abc.js', 'chunks/../../app.js', 'assets/aux.txt', 'icon\\extra.png', '_metadata/file']) {
    assert.throws(() => readReleaseZip(zipSync({ ...files, [path]: strToU8('bad') }), version, name), /Недопустимый путь/);
  }
  assert.throws(() => readReleaseZip(zipSync({ ...files, 'APP.js': strToU8('duplicate') }), version, name), /Повторяющийся путь/);
});

test('установщик загружает только ZIP заданного выпуска и сверяет SHA-256', async () => {
  const bytes = zipSync(files);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const filename = 'confluence-tools-ci-chrome-' + version + '.zip';
  const url = 'https://github.com/svyatoslav-p/confluence-tools-ci/releases/download/v' + version + '/' + filename;
  const asset = { name: filename, state: 'uploaded', size: bytes.length, digest: 'sha256:' + digest, browser_download_url: url };
  const paths = [];
  const release = { tag_name: 'v' + version, draft: false, prerelease: false, assets: [asset] };
  const { downloadRelease } = loadTs('core/update-release.ts', { imports: dependencies, globals: {
    AbortSignal, crypto, Uint8Array, fetch: async (request, options) => {
      paths.push(request);
      assert.equal(options.credentials, 'omit');
      if (request === url) {
        const response = new Response(bytes);
        return { ok: response.ok, body: response.body, url: 'https://release-assets.githubusercontent.com/zip' };
      }
      return Response.json(release);
    },
  } });
  assert.equal((await downloadRelease(version, name)).size, 6);
  assert.deepEqual(paths, ['https://api.github.com/repos/svyatoslav-p/confluence-tools-ci/releases/tags/v' + version, url]);
  asset.digest = 'sha256:' + '0'.repeat(64);
  await assert.rejects(downloadRelease(version, name), /Контрольная сумма/);
  asset.browser_download_url = 'https://example.com/other.zip';
  paths.length = 0;
  await assert.rejects(downloadRelease(version, name), /SHA-256/);
  assert.equal(paths.length, 1);
});

function directory(storage = new Map(), failOn = '') {
  return {
    storage,
    async getFileHandle(name, { create = false } = {}) {
      if (!storage.has(name)) {
        if (!create) throw new DOMException('missing', 'NotFoundError');
        storage.set(name, new Blob());
      }
      return {
        getFile: async () => storage.get(name),
        createWritable: async () => {
          let changes;
          return {
            write: async (data) => { changes = new Blob([data]); },
            close: async () => {
              if (name === failOn) throw new DOMException('write denied', 'NotAllowedError');
              storage.set(name, changes);
            },
            abort: async () => {},
          };
        },
      };
    },
    removeEntry: async (name) => { storage.delete(name); },
  };
}

test('проверка папки отличает установленную копию от каталога с идентичным манифестом', async () => {
  const contents = [['manifest.json', new Blob([JSON.stringify(manifest)])]];
  const installed = directory(new Map(contents));
  const sameBuild = directory(new Map(contents));
  const { validateInstallFolder } = loadTs('core/local-install.ts', { globals: { crypto, chrome: { runtime: {
    getManifest: () => manifest,
    getPackageDirectoryEntry: (callback) => callback({
      getFile: (name, options, found, missing) => installed.storage.has(name) ? found() : missing(),
    }),
  } } } });
  await validateInstallFolder(installed);
  await assert.rejects(validateInstallFolder(sameBuild), /именно это расширение/);
  assert.deepEqual([...installed.storage.keys()], ['manifest.json']);
  assert.deepEqual([...sameBuild.storage.keys()], ['manifest.json']);
});

test('при ошибке записи нового манифеста возвращаются старые файлы', async () => {
  const { replaceBundle } = loadTs('core/local-install.ts', { globals: { Blob, DOMException } });
  const folder = directory(new Map([['manifest.json', new Blob(['old manifest'])], ['app.js', new Blob(['old app'])]]), 'manifest.json');
  const update = new Map([['manifest.json', strToU8('new manifest')], ['app.js', strToU8('new app')], ['new.js', strToU8('new asset')]]);
  await assert.rejects(replaceBundle(folder, update), /write denied/);
  assert.equal(await folder.storage.get('manifest.json').text(), 'old manifest');
  assert.equal(await folder.storage.get('app.js').text(), 'old app');
  assert.equal(folder.storage.has('new.js'), false);
});
