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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
