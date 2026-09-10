import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch:
    process.env['P10_BROWSER_ONLY'] === '1'
      ? ['corrections.system.ts']
      : ['auth.system.ts', 'sync.system.ts', 'corrections.system.ts'],
  timeout: 60000,
  workers: 1,
  use: { trace: 'off', screenshot: 'off' },
  reporter: [['list']],
});
