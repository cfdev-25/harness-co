import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { defineConfig, devices } from "@playwright/experimental-ct-react";

/**
 * Two projects (00 §10, 02 rule 30): `component` mounts one `ui/` component
 * at a time against a scratch Vite server (01 D62); `screen` drives a route
 * against a running stack.
 *
 * The `screen` project takes its stack from the environment, because V3 runs
 * against the real `api` over a scratch Postgres and there is one such stack
 * per group of screens (`test/server/stack-a.sh`, `stack-b.sh`) — see
 * `test/server/README.md`. `STACK_URL` is the console's origin and
 * `STACK_STATE` a Playwright storage-state file holding the session cookie.
 * With neither set, the project falls back to the developer's own `next dev`
 * on 3000 and boots it; with `STACK_URL` set, no web server is started here,
 * because the stack script already owns one.
 */
const STACK_URL = process.env.STACK_URL;
const STACK_STATE = process.env.STACK_STATE;
const DEV_URL = "http://localhost:3000";

export default defineConfig({
  // `ctTemplateDir` belongs on the root config's `use`, not a project's —
  // it configures the scratch Vite server the `component` project mounts
  // against; the `screen` project ignores it.
  use: {
    ctTemplateDir: "test/components",
    // The rig builds with Vite, which does not read `postcss.config.mjs`'s
    // string plugin name from this search path, so the same Tailwind plugin
    // the application uses is named here. Without it a mounted component has
    // class names and no rules, and every V2 that measures something would
    // pass against an unstyled page (02 rule 32). No new dependency.
    // The cast is the two copies of `postcss` in the tree declaring
    // structurally different plugin types; the value is the plugin Next uses.
    // A write form reads the browser's session cookie before it calls
    // `request`, and `/signup` also asks the auth provider for a link, a
    // session and a password; the rig has neither the cookie nor the
    // `NEXT_PUBLIC_SUPABASE_*` environment, so `createBrowserClient` throws.
    // The two auth modules — and only they — are the rig's. The data path
    // stays real, and a write spec asserts what went on the wire.
    ctViteConfig: {
      css: { postcss: { plugins: [tailwindcss()] } },
      resolve: {
        alias: [
          {
            find: /^@\/lib\/token\.client$/,
            replacement: path.join(__dirname, "test/components/token.client.ts"),
          },
          {
            find: /^@\/lib\/supabase\.client$/,
            replacement: path.join(__dirname, "test/components/supabase.client.ts"),
          },
        ],
      },
    } as never,
  },
  projects: [
    {
      name: "component",
      testDir: "./test/components",
      testMatch: /.*\.spec\.tsx$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "screen",
      testDir: "./test/screen",
      testMatch: /.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: STACK_URL ?? DEV_URL,
        ...(STACK_STATE ? { storageState: STACK_STATE } : {}),
      },
    },
  ],
  // A stack script owns its own `next dev`; starting a second one here would
  // take a port it does not hold and serve a different tree.
  ...(STACK_URL
    ? {}
    : {
        webServer: {
          command: "next dev",
          url: DEV_URL,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
