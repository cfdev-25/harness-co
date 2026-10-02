/* The Playwright component-test register file (01 D62, 02 rule 30). Nothing
   here is product code — it only mounts whatever `mount()` is given.

   `globals.css` is imported so a mounted component is drawn with the tokens
   it is written against: without it the rig renders class names and no rules,
   and every V2 that asserts a measurement (does the title wrap at 800, is the
   drawing left of it) would pass on an unstyled page and prove nothing (02
   rule 32). Vite picks up `postcss.config.mjs` from the project root, so this
   is the whole wiring. `@source "../app"` in `globals.css` is relative to
   that file, so the same utilities are generated as in the application.

   The app router context is provided because `useRouter()` throws outside it,
   and every write form calls `router.refresh()` after its `request()` (02
   rule 20). The stub records nothing: a write spec asserts the request that
   went out, and the refresh is Next's to make.

   The pathname context is provided for the same reason: `usePathname()`
   answers `null` without it, and the shell's own components — `Sidebar`,
   `Section` — are a route's answer to *where am I*. A spec that cares which
   route passes its own `pathname` prop; this is the default anything else
   mounts against. */
import { beforeMount } from "@playwright/experimental-ct-react/hooks";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import "@/app/globals.css";

const ROUTER = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  // Required by `AppRouterInstance`; a mounted component never reads it.
  bfcacheId: "",
};

const ROUTE = "/console/acme.marketing/assets";

beforeMount(async ({ App }) => (
  <AppRouterContext.Provider value={ROUTER}>
    <PathnameContext.Provider value={ROUTE}>
      <App />
    </PathnameContext.Provider>
  </AppRouterContext.Provider>
));
