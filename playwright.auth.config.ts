import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'auth.system.ts',
  timeout: 60000,
  workers: 1,
  use: { trace: 'off', screenshot: 'off' },
  reporter: [['list']],
});
