import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: 'chromium', testIgnore: /app\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    // Android app screens (`npm run dev:app` on port 5174), at a phone size.
    { name: 'app', testMatch: /app\.spec\.ts/, use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:5174', locale: 'ko-KR', timezoneId: 'Asia/Seoul' } },
  ],
})
