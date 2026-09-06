import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.finanzas.personales.demo',
  appName: 'Finanzas DEMO',
  webDir: '../../dist/mobile/browser',
  android: { allowMixedContent: false },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: true,
      iosKeychainPrefix: 'finanzas-prototype',
      androidIsEncryption: true,
    },
  },
};
export default config;
