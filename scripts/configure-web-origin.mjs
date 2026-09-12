import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const origin = process.env['FINANZAS_API_ORIGIN']?.trim();
if (!origin) {
  process.stdout.write('FINANZAS_API_ORIGIN is not set; web login remains safely disabled.\n');
  process.exit(0);
}
const parsed = new URL(origin);
if (
  parsed.protocol !== 'https:' ||
  parsed.username ||
  parsed.password ||
  parsed.pathname !== '/' ||
  parsed.search ||
  parsed.hash
)
  throw new Error('FINANZAS_API_ORIGIN must be a bare HTTPS origin.');

const indexPath = 'dist/web/browser/index.html';
const original = await readFile(indexPath, 'utf8');
if (
  !original.includes('name="finanzas-auth" content="disabled"') ||
  !original.includes('name="finanzas-api-origin" content=""')
)
  throw new Error('Unexpected web authentication metadata.');
const index = original
  .replace('name="finanzas-auth" content="disabled"', 'name="finanzas-auth" content="remote"')
  .replace('name="finanzas-api-origin" content=""', `name="finanzas-api-origin" content="${parsed.origin}"`);
await writeFile(indexPath, index);

try {
  const swPath = 'dist/web/browser/ngsw.json';
  const sw = JSON.parse(await readFile(swPath, 'utf8'));
  if (sw.hashTable?.['/index.html']) {
    sw.hashTable['/index.html'] = createHash('sha1').update(index).digest('hex');
    await writeFile(swPath, JSON.stringify(sw));
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
process.stdout.write(`Web client configured for ${parsed.origin}.\n`);
