import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
for (const args of [
  ['node_modules/@angular/cli/bin/ng.js', 'build', 'web'],
  ['node_modules/typescript/bin/tsc', '-p', 'packages/domain/tsconfig.json'],
  ['node_modules/typescript/bin/tsc', '-p', 'backend/api/tsconfig.json'],
])
  execFileSync(process.execPath, args, { stdio: 'inherit' });
const path = 'dist/web/browser/';
const original = await readFile(path + 'index.html', 'utf8');
if (!original.includes('name="finanzas-auth" content="disabled"'))
  throw new Error('Unexpected auth build configuration');
const index = original
  .replace('name="finanzas-auth" content="disabled"', 'name="finanzas-auth" content="same-origin"')
  .replace('</head>', '<meta name="finanzas-stage" content="private"></head>');
await writeFile(path + 'index.html', index);
const sw = JSON.parse(await readFile(path + 'ngsw.json', 'utf8'));
sw.hashTable['/index.html'] = createHash('sha1').update(index).digest('hex');
await writeFile(path + 'ngsw.json', JSON.stringify(sw));
process.stdout.write('Private staging build ready; no credentials included in assets.\n');
