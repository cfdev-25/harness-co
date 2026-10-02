import { permanentRedirect } from "next/navigation";

/**
 * `/app` was the old console's one route. The console lives under
 * `/console/<scope>/…` now (00 D2), so the old address is a permanent
 * redirect rather than a page: bookmarks and anything still pointing here
 * land on the console's own first screen. The literal is repeated rather
 * than imported from `auth.tsx`, which is a client module and would drag the
 * whole sign-in bundle into a route that only sets a `Location` header.
 */
export default function AppPage(): never {
  permanentRedirect("/console/me/harnesses");
}
