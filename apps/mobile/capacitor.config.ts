import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.finanzas.personales.demo',
  appName: 'Finanzas DEMO',
  webDir: '../../dist/mobile/browser',
  android: { allowMixedContent: false },
};
export default config;
