import { describe, expect, it } from "vitest";
import { NAV_LABELS, navFor, navKeyOf } from "@/app/(console)/shell/nav";
import type { Scope, Viewer } from "@/lib/views/types";

/**
 * V1 for the sidebar (01 §4.4): one case per row of the table, because the
 * table is the decision and this file is where it is kept honest. Nothing
 * else in the console decides what is in the sidebar.
 */

const ME: Scope = { kind: "me" };
const TEAM: Scope = { kind: "team", path: "acme.marketing" };
const ORG: Scope = { kind: "org" };

function viewer(over: Partial<Viewer> = {}): Viewer {
  return {
    user: { id: "u", email: "jo@acme.example", name: "Jo" },
    role: { level: "member", at: "acme.marketing" },
    edition: "enterprise",
    staff: false,
    teams: [{ path: "acme.marketing", name: "Marketing", admin: false }],
    visibility: { boundaries: true, logs: true },
    waiting: {},
    adminHere: false,
    ...over,
  };
}

/** The labels, in the order the sidebar draws them. */
function rows(scope: Scope, over: Partial<Viewer> = {}): string[] {
  return navFor(scope, viewer(over)).flatMap((group) => group.items.map((item) => item.label));
}

describe("navFor — the sidebar shows what you manage", () => {
  it("me: harnesses, assets, logs, account", () => {
    // Your own branch is always yours, so `adminHere` is true here and still
    // adds nothing: there is nobody else's permission to hand out.
    expect(rows(ME, { adminHere: true })).toEqual(["Harnesses", "Assets", "Logs", "Account"]);
  });

  it("team, on it: harnesses, assets, logs, people", () => {
    expect(rows(TEAM)).toEqual(["Harnesses", "Assets", "Logs", "People"]);
  });

  it("team, administering it: the permission screens and Teams as well", () => {
    expect(rows(TEAM, { adminHere: true })).toEqual([
      "Harnesses", "Assets", "Security groups", "Boundaries", "Providers", "Logs",
      "People", "Teams",
    ]);
    expect(rows(TEAM, { adminHere: true })).not.toContain("Key vaults");
  });

  it("org, on it: harnesses, assets, logs, people", () => {
    expect(rows(ORG)).toEqual(["Harnesses", "Assets", "Logs", "People"]);
  });

  it("org, administering it: the permission screens, key vaults and Teams", () => {
    expect(rows(ORG, { adminHere: true })).toEqual([
      "Harnesses", "Assets", "Security groups", "Boundaries", "Providers", "Key vaults",
      "Logs", "People", "Teams",
    ]);
  });

  it("personal: harnesses, assets, boundaries, logs, account — reach lives there", () => {
    const personal = { edition: "personal" as const, adminHere: true, teams: [] };
    expect(rows(ME, personal)).toEqual([
      "Harnesses", "Assets", "Boundaries", "Logs", "Account",
    ]);
    // The same five wherever a personal account stands: there is one person
    // and no organisation above them (07 §2).
    expect(rows(ORG, personal)).toEqual(rows(ME, personal));
  });

  it("Sessions and Endpoints have left the sidebar for the Logs tabs", () => {
    for (const scope of [ME, TEAM, ORG]) {
      for (const admin of [false, true]) {
        const labels = rows(scope, { adminHere: admin });
        expect(labels).not.toContain(NAV_LABELS.sessions);
        expect(labels).not.toContain(NAV_LABELS.endpoints);
      }
    }
  });

  it("Logs opens on Changes, and the waiting count rides on its key", () => {
    const [logs] = navFor(ORG, viewer({ waiting: { harnesses: 2 } }))
      .flatMap((group) => group.items)
      .filter((item) => item.key === "logs");
    expect(logs.href).toBe("/console/org/logs/changes");
    const harnesses = navFor(ORG, viewer({ waiting: { harnesses: 2 } }))
      .flatMap((group) => group.items)
      .find((item) => item.key === "harnesses");
    expect(harnesses?.count).toBe(2);
  });
});

describe("navKeyOf", () => {
  it("marks Logs for every tab under it, and for the old Sessions address", () => {
    expect(navKeyOf("/console/me/logs/changes")).toBe("logs");
    expect(navKeyOf("/console/me/logs/sessions")).toBe("logs");
    expect(navKeyOf("/console/me/logs/sessions/s_1")).toBe("logs");
    expect(navKeyOf("/console/acme.marketing/logs/endpoints")).toBe("logs");
    expect(navKeyOf("/console/me/sessions/s_1")).toBe("logs");
  });

  it("reads the one scope segment, dotted team path and all (00 D2)", () => {
    expect(navKeyOf("/console/acme.marketing/boundaries")).toBe("boundaries");
    expect(navKeyOf("/console/org/harnesses")).toBe("harnesses");
    expect(navKeyOf("/console/how")).toBe("how");
    expect(navKeyOf("/console/org/nothing-here")).toBe(null);
  });
});
