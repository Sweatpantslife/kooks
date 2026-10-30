import js from "@eslint/js";
import globals from "globals";

// ESLint's recommended rules only: Prettier owns formatting. Each block names
// the runtime its files run in, so a browser global in server code (or the
// reverse) is reported.
export default [
  {
    ignores: [
      "android/",
      "ios/",
      "dist/",
      "build/",
      "coverage/",
      "test-results/",
      "playwright-report/",
      ".data/",
      // Generated from Lucide by scripts/icons.mjs
      "shared/icons.js",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // `const { omitted, ...kept } = value` is how this codebase drops fields.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["mcp/**", "web/*.js", "scripts/**", "test/**", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["web/public/**", "app/**"],
    languageOptions: {
      globals: { ...globals.browser, __KOOKS_VERSION__: "readonly" },
    },
  },
  {
    // Imported by both apps and the server.
    files: ["shared/**"],
    languageOptions: { globals: globals["shared-node-browser"] },
  },
  {
    // Served to both apps, never imported by the server.
    files: ["shared/a11y.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Playwright callbacks passed to page.evaluate() run in the browser.
    files: ["test/*-e2e/**"],
    languageOptions: { globals: globals.browser },
  },
];
