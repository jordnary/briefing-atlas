import { defineConfig } from '@playwright/test';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const origin = 'http://127.0.0.1:4179';
export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-output/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: { baseURL: `${origin}${base}/`, browserName: 'chromium', trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: `${origin}${base}/search/`,
    env: { PORT: '4179' },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
