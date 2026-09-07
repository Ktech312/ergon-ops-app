import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts on purpose -- that one is part of the
// production build's own tsc -b project (tsconfig.node.json) and stays
// minimal; this one only matters for `npm test` and never ships.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // api/*.test.js live under tests/api/, not api/ itself -- Vercel's
    // zero-config Node runtime treats every top-level .js file directly
    // under api/ as its own serverless function route (matching how the
    // real send-*.js routes work), and a test file with no `export
    // default function handler` broke that build outright the first
    // time one was placed there (2026-09-07). _lib/ and files already
    // prefixed with `_` are exempt by Vercel's own convention, but a
    // *.test.js name isn't, so these live outside api/ entirely instead.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/api/**/*.test.js"],
    pool: "threads",
    // Real Supabase env values (dummy, see .env.test) come from that
    // file, loaded automatically by Vite for mode "test" -- confirmed
    // empirically that vi.stubEnv and this block's own `env` option
    // only reach the *test file's* own import.meta.env, not a module
    // it imports (persistence.ts's dynamic env?.[key] lookup never saw
    // either). A real .env.test avoids that module-boundary gap since
    // Vite resolves it once, consistently, for every module.
  },
});
