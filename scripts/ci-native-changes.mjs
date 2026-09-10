import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
const requested = process.env['BASE_SHA'];
const base =
  requested && /^[a-f0-9]{40}$/.test(requested) && !/^0+$/.test(requested) ? requested : 'HEAD^';
const files = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
  .trim()
  .split('\n');
const native = files.some((file) =>
  /^(apps\/mobile\/|packages\/(shared|domain|ui)\/|package(-lock)?\.json$|angular\.json$|tsconfig.*\.json$|scripts\/(normalize-native\.mjs|test-android-offline\.sh)$)/.test(
    file,
  ),
);
appendFileSync(process.env['GITHUB_OUTPUT'], `native=${native}\n`);
