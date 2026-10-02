import { Suspense } from "react";
import type { ReactNode } from "react";
import type { Scope, Viewer } from "@/lib/views/types";
import { ScopeAsBanner } from "./as-banner";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import "./shell.css";

export interface ConsoleShellProps {
  scope: Scope;
  viewer: Viewer;
  /** Dev-only when `/v1/console/me` is absent (K7); never set in production. */
  fixtureNotice?: string;
  children: ReactNode;
}

/** The grid, once (K5, D5). Two props, three consumers, no context (01 §4.2). */
export function ConsoleShell({ scope, viewer, fixtureNotice, children }: ConsoleShellProps) {
  return (
    <div className="shell">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <Header scope={scope} viewer={viewer} />
      <Sidebar scope={scope} viewer={viewer} />
      <main id="content">
        {/* 02 rule 17: the shell shows the `?as` banner whenever it is set,
            on every screen, so no screen renders one of its own. */}
        <Suspense fallback={null}>
          <ScopeAsBanner />
        </Suspense>
        {fixtureNotice && (
          <p className="border-b border-hold/40 bg-hold-soft px-6 py-2 text-xs text-hold">
            {fixtureNotice}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
