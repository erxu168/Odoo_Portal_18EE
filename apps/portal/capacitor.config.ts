import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.krawings.portal',
  appName: 'Krawings Portal',
  webDir: 'www',
  server: {
    url: 'https://portal.krawings.de',
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
