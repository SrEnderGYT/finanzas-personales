import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
await writeFile(
  'dist/build-info.json',
  JSON.stringify(
    {
      commit: process.env.BUILD_COMMIT ?? 'local',
      version: pkg.version,
      date: new Date().toISOString(),
      environment: 'synthetic-demo',
      buildType: 'android-debug',
      financialData: false,
    },
    null,
    2,
  ),
);
