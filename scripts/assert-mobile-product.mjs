import { readdir, readFile } from 'node:fs/promises';
const root = 'dist/mobile/browser/';
const marker = 'Storage instrumentation never contacts an API';
for (const file of await readdir(root)) {
  if (file.endsWith('.js') && (await readFile(root + file, 'utf8')).includes(marker)) {
    throw new Error('Storage instrumentation must never be published as the product APK');
  }
}
