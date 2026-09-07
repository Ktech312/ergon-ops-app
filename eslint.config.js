import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

// Baseline lint setup -- this repo had none at all. Deliberately not
// strict-type-checked (that would need a much bigger cleanup pass
// across a very large existing codebase, out of scope for "add an
// appropriate, maintainable baseline") -- catches real correctness
// issues (unused vars, hook-rule violations, unreachable code) without
// re-litigating every existing stylistic choice in main.tsx/persistence.ts.
export default tseslint.config(
  // tmp/ is local, gitignored scratch (found to contain an unrelated
  // VLTD source tree, `tmp/vltd-src-*` -- confirmed untracked by git,
  // not part of this repo; left alone per "keep VLTD completely
  // separate," not this task's concern to clean up or lint).
  { ignores: ["dist", "node_modules", "tmp", "api/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The PWA service worker runs in its own worker global scope (`self`,
    // not `window`), never through the browser/src bundle -- give it the
    // matching globals instead of flagging every `self`/`fetch` as undefined.
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.serviceworker,
    },
  },
  {
    // Vitest-run Node tests for the api/*.js serverless routes -- real
    // Node globals (process, global), not browser ones.
    files: ["tests/api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // react-hooks v7's recommended set includes several new, strict
      // rules (set-state-in-effect, purity) tuned for React Compiler
      // compatibility. They found real, worth-tracking spots (~40) in
      // this existing ~25k-line file, but fixing them all is its own
      // sizable, separate refactor with real regression risk -- not
      // this task's "add a baseline" scope. Downgraded to warn so they
      // stay visible (and `npm run lint` still exits 0) rather than
      // either hiding them or blocking on a mass rewrite done fast.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
