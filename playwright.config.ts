import { defineConfig, devices } from "@playwright/test";

// A small smoke suite, not a full e2e framework -- this repo had zero
// browser-level test coverage. Covers exactly what's easy to regress
// silently and hard to notice by reading code: the sign-in gate actually
// gating, tab navigation actually navigating, and the mobile shell
// actually showing one nav (see AGENTS/HANDOFF for the bugs this suite
// exists to catch: a phantom desktop nav strip on mobile, a duplicate
// "Dashboard" center action, and a stale demo project crashing render).
export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5190",
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Desktop-viewport specs only: navigation-and-shell.spec.ts's
      // "primary navigation" describe block, which clicks the desktop
      // tab strip (hidden below the 760px breakpoint, so it can't run
      // under the mobile project below), plus auth-gate.spec.ts.
      name: "chromium",
      grepInvert: /mobile application shell/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile-viewport specs only ("mobile application shell" describe
      // block) -- everything else assumes the desktop tab strip exists.
      name: "mobile",
      testMatch: /navigation-and-shell\.spec\.ts/,
      grep: /mobile application shell/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      // No Supabase env vars -- persistence isn't configured, so the app
      // runs in its local-only mode with no sign-in gate. Used by the
      // navigation/mobile-shell specs, which need to reach the app UI
      // without a real backend or session.
      command: "npm run dev -- --port 5190 --strictPort",
      url: "http://127.0.0.1:5190",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      // Dummy-but-present Supabase env vars -- isRemotePersistenceConfigured()
      // is now true, so the app requires a real session. Never a live
      // project; only used to prove the sign-in gate actually blocks
      // access without one. Used by auth-gate.spec.ts only.
      command: "npm run dev -- --port 5191 --strictPort",
      url: "http://127.0.0.1:5191",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: {
        VITE_SUPABASE_URL: "https://smoke-test.supabase.co",
        VITE_SUPABASE_ANON_KEY: "smoke-test-anon-key",
      },
    },
  ],
});
