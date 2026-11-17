import { readFileSync, writeFileSync } from 'node:fs';

const builtAt = process.env.CT_BUILD_TIMESTAMP;
if (!builtAt || !Number.isFinite(Date.parse(builtAt))) throw new Error('CT_BUILD_TIMESTAMP is required');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const metadata = { version, builtAt, downloadUrl: 'https://github.com/svyatoslav-p/confluence-tools-ci/actions' };
writeFileSync(process.argv[2] ?? new URL('../update.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
