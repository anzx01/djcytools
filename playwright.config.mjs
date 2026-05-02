import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5174);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node --no-warnings=ExperimentalWarning ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DJCYTOOLS_DATA_DIR: ".e2e-data",
      DJCYTOOLS_ADMIN_EMAIL: "e2e-owner@example.test",
      DJCYTOOLS_ADMIN_PASSWORD: "E2EPassword2026",
      DJCYTOOLS_ADMIN_NAME: "E2E 所有者",
      DJCYTOOLS_TEAM_NAME: "E2E 测试团队",
      DJCYTOOLS_APP_URL: baseURL,
      DJCYTOOLS_PUBLIC_API_TOKEN: "e2e-public-token",
      DJCYTOOLS_PUBLIC_API_BASE_URL: baseURL,
      DEEPSEEK_API_KEY: "",
      DJCYTOOLS_VIDEO_API_KEY: "",
      DJCYTOOLS_REAL_VIDEO_API_KEY: "",
      DJCYTOOLS_AI_API_KEY: "",
      DOUBAO_API_KEY: "",
      ARK_API_KEY: "",
    },
  },
});
