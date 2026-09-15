import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Build-time metadata changes must also update the generated offline shell hash.
// manifest.index includes the deployment base path (e.g. GitHub Pages).
export async function updateShellHash(directory, index) {
  const path = directory + '/ngsw.json';
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (!manifest.hashTable?.[manifest.index]) throw new Error('Missing offline index hash');
  manifest.hashTable[manifest.index] = createHash('sha1').update(index).digest('hex');
  await writeFile(path, JSON.stringify(manifest));
}
