import { test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { updateShellHash } from '../scripts/update-shell-hash.mjs';

test.each(['/index.html', '/finanzas-personales/index.html'])(
  'updates the deployed offline index hash at %s',
  async (index) => {
    const directory = await mkdtemp(join(tmpdir(), 'finanzas-shell-'));
    try {
      await writeFile(
        join(directory, 'ngsw.json'),
        JSON.stringify({ index, hashTable: { [index]: 'old', '/main.js': 'preserved' } }),
      );
      const html = '<meta name="finanzas-auth" content="same-origin">';
      await updateShellHash(directory, html);
      const manifest = JSON.parse(await readFile(join(directory, 'ngsw.json'), 'utf8'));
      expect(manifest.hashTable[index]).toBe(createHash('sha1').update(html).digest('hex'));
      expect(manifest.hashTable['/main.js']).toBe('preserved');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
