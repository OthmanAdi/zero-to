import { defineConfig, devices } from '@playwright/test';

const PORT = 5197;
/** Set E2E_BASE_URL to test a site that is already being served, for example a built copy. */
const EXTERNAL = (process.env.E2E_BASE_URL ?? '').trim().replace(/\/+$/, '');
const ORIGIN = EXTERNAL || `http://127.0.0.1:${PORT}`;

/** Files that only make sense with a touch screen. The desktop project skips them. */
const TOUCH_ONLY = /(touch|phone)\.spec\.ts$/;
/** Files that need a mouse, a keyboard or a desktop media preference. The phone project skips them. */
const DESKTOP_ONLY = /(mouse|keyboard|reduced-motion)\.spec\.ts$/;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  ...(EXTERNAL
    ? {}
    : {
        webServer: {
          command: `npx vite --port ${PORT} --strictPort`,
          url: `${ORIGIN}/index.html`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testIgnore: TOUCH_ONLY,
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      testIgnore: DESKTOP_ONLY,
    },
  ],
});
