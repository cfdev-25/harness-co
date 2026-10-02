import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The console's own additions (docs/console/02-web-standards.md rule 28).
// `eslint-config-next`'s `react-hooks` plugin (v7) already carries the React
// Compiler diagnostics Next 16 ships, most as errors; this promotes the two
// it leaves at `warn`.
const REACT_COMPILER_RULES = {
  "react-hooks/incompatible-library": "error",
  "react-hooks/unsupported-syntax": "error",
};

// A hand-written `/console/…` string belongs behind `scopeHref` once the
// shell exists (02 rule 4); this rule is on today so the console never
// starts without it.
const CLASSNAME_LENGTH_MESSAGE =
  "className over 120 characters — extract a component or an @layer components class (02 rule 28, D25).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      ...REACT_COMPILER_RULES,
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // `lib/api.ts` is the one place `fetch` may be called directly (02 rule
    // 9); `scripts/**` fetches `api`'s OpenAPI document (rule 13) and
    // `test/**` is test code, exempted by rule 28 itself.
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["lib/api.ts", "scripts/**", "test/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Call lib/api.ts's request() instead — it is the one data path (02 rule 9).",
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/org-preview/**"],
              message: "org-preview is a fixture-driven prototype on the delete list (00 §7).",
            },
            {
              group: ["**/team-preview/**"],
              message: "team-preview is a fixture-driven prototype on the delete list (00 §7).",
            },
            {
              group: ["**/user-preview/**"],
              message: "user-preview is a fixture-driven prototype on the delete list (00 §7).",
            },
            {
              group: ["../admin", "**/app/admin", "**/app/admin.tsx"],
              message: "admin.tsx is replaced screen by screen and deleted, not imported (00 D10).",
            },
            {
              group: ["@/lib/types"],
              message:
                "lib/types.ts is hand-maintained and replaced by generated types (00 D3); it is deleted at K-M2.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] > Literal[value.length>120]",
          message: CLASSNAME_LENGTH_MESSAGE,
        },
        {
          selector:
            "JSXAttribute[name.name='className'] JSXExpressionContainer TemplateElement[value.raw.length>120]",
          message: CLASSNAME_LENGTH_MESSAGE,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated; never edited (02 rule 13).
    "lib/api.generated.ts",
    // The engine's fixtures, symlinked in (00 §10) — not console source.
    "test/fixtures/**",
    // Playwright component-test's Vite build cache — a build artifact.
    "test/components/.cache/**",
  ]),
]);

export default eslintConfig;
