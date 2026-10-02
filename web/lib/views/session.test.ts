import { describe, expect, it } from "vitest";
import type { Viewer } from "./types";
import {
  endpointsCell,
  hostOf,
  isNative,
  lastActiveFact,
  mayRevoke,
  modelCell,
  needCell,
  providerCell,
  reachRows,
  readFilters,
  resolvedFromCell,
  revokeLabel,
  sessionsQuery,
  slotRows,
  slotsOf,
  viaCell,
  type PreflightReport,
  type SessionRow,
  type SessionView,
  type Slot,
} from "./session";

const WORDS = { group: "group", via: "via grant", vault: "vault", local: "local" };
const REACH = {
  reach: "Reach",
  notDecided: "not decided yet",
  model: "Model endpoint",
  deny: "Denied",
  host: "Host",
  provider: "provider",
};

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s1",
    person: { id: "u1", name: "Jo" },
    harness: { id: "h1", name: "Campaign drafts" },
    provider: { id: "pi", version: "0.4.2" },
    model: { provider: "anthropic", model: "claude-opus-5" },
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    lastActiveAt: "2026-01-01T00:05:00Z",
    endpoints: { reached: 3, refused: 1 },
    ...over,
  };
}

function viewer(over: Partial<Viewer> = {}): Viewer {
  return {
    user: { id: "u1", email: "a@b.c", name: "Jo" },
    role: { level: "member", at: "acme.marketing" },
    edition: "enterprise",
    staff: false,
    teams: [],
    visibility: { boundaries: true, logs: true },
    waiting: {},
    adminHere: false,
    ...over,
  };
}

describe("the list", () => {
  it("native_session_not_metered", () => {
    const native = row({ model: { provider: "", model: "" } });
    expect(isNative(native)).toBe(true);
    expect(modelCell(native, "not metered")).toBe("not metered");
    expect(modelCell(native, "not metered")).not.toContain("0");
    expect(modelCell(row(), "not metered")).toBe("anthropic claude-opus-5");
  });

  it("reads the provider as id and version", () => {
    expect(providerCell(row())).toBe("pi 0.4.2");
  });

  it("says how many endpoints were reached and refused", () => {
    expect(endpointsCell(row(), { reached: "reached", refused: "refused" })).toBe(
      "reached 3 · refused 1",
    );
  });

  it("observes last active only while the session runs (P2)", () => {
    expect(lastActiveFact(row()).provenance).toBe("observed");
    expect(lastActiveFact(row({ status: "closed" })).provenance).toBe("declared");
  });

  it("keeps the three filters in the URL (02 rule 16)", () => {
    expect(readFilters({ status: "active", person: "u1", harness: "" })).toEqual({
      person: "u1",
      harness: undefined,
      status: "active",
    });
    expect(readFilters({ status: "nonsense" }).status).toBeUndefined();
    expect(sessionsQuery({ status: "revoked", person: "u1" })).toBe("?person=u1&status=revoked");
    expect(sessionsQuery({})).toBe("");
  });
});

describe("the slots table", () => {
  const credential: Slot = {
    need: { kind: "credential", alias: "anthropic-api-key" },
    state: "satisfied",
    evidence: "verified",
    resolvedFrom: { source: "vault", vault: "bundled", group: "marketing-keys", grant: "g1" },
  };
  const deferred: Slot = {
    need: { kind: "credential", alias: "crm-token" },
    state: "deferred",
    evidence: "declared",
    resolvedFrom: null,
    via: { grant: "g1", group: "marketing-keys", sources: "vault-or-local" },
  };
  const login: Slot = {
    need: { kind: "login", tool: "gh" },
    state: "satisfied",
    evidence: "harness-reported",
    resolvedFrom: { source: "local", tool: "gh" },
  };

  it("session_slots_show_resolved_from", () => {
    expect(resolvedFromCell(credential, WORDS)).toBe(
      "group marketing-keys via grant g1 · vault bundled",
    );
    expect(resolvedFromCell(login, WORDS)).toBe("local: gh");
    expect(resolvedFromCell(deferred, WORDS)).toBe("");
  });

  it("names each need by its kind (04 §13)", () => {
    expect(needCell(credential)).toBe("credential:anthropic-api-key");
    expect(needCell(login)).toBe("login:gh");
    expect(needCell({ ...credential, need: { kind: "asset", name: "prompt/house-style" } })).toBe(
      "asset:prompt/house-style",
    );
  });

  it("shows via only for a deferred slot (engine D60)", () => {
    expect(viaCell(deferred)).toBe("marketing-keys · vault-or-local");
    expect(viaCell(credential)).toBe("");
  });

  it("prefers the CLI's own slots over api's lossy rebuild", () => {
    const record: Slot[] = [{ ...login, need: { kind: "credential", alias: "gh" } }];
    const session = {
      ...row(), commits: {}, slots: record, endpointsTally: [],
      preflight: {
        sessionId: "s1", at: "x", slots: [login], drift: [], passing: true, blockers: [],
      },
    };
    expect(needCell(slotsOf(session)[0])).toBe("login:gh");
    expect(needCell(slotsOf({ ...session, preflight: null })[0])).toBe("credential:gh");
  });

  it("no_value_string_anywhere_on_session_page", () => {
    const rows = slotRows([credential, deferred, login], WORDS);
    const rendered = JSON.stringify(rows);
    // The record holds provenance only (engine 04 B6); nothing here can leak a
    // value because there is no field for one.
    expect(rendered).not.toContain("sk-");
    expect(rendered).not.toContain("secret://");
    expect(rows.map((slot) => slot.state)).toEqual(["satisfied", "deferred", "satisfied"]);
    expect(rows.map((slot) => slot.evidence)).toEqual(["verified", "declared", "harness-reported"]);
  });
});

describe("the reach card", () => {
  const report: PreflightReport = {
    sessionId: "s1",
    at: "2026-01-01T00:00:00Z",
    choices: {
      grants: [{ id: "g1", group: "marketing-keys" }],
      model: { provider: "anthropic", model: "claude-opus-5", endpoint: "https://api.anthropic.com" },
    },
    // D131: the plan carries the session's reach; nothing derives it here.
    plan: {
      hosts: ["api.anthropic.com"],
      deny: [],
      reach: { mode: "allow", hosts: ["pypi.org", "crates.io"], setBy: "acme.marketing" },
    },
    slots: [],
    drift: [],
    passing: true,
    blockers: [],
  };
  const onTeam = viewer({
    teams: [{ path: "acme.marketing", name: "Marketing", admin: false }],
  });

  it("reach_rows_name_deciding_object", () => {
    const rows = reachRows(report, REACH, onTeam);
    // The composed reach, in words, and the level that last narrowed it —
    // never the dotted path (01 §4.4).
    expect(rows[0].what).toBe("Reach: allow-list, 2 hosts");
    expect(rows[0].decidedBy).toBe("Marketing");
    expect(rows[1].what).toBe("Host api.anthropic.com");
    expect(rows[1].decidedBy).toBe("provider anthropic");
  });

  it("says not decided yet for a report written before the plan", () => {
    const rows = reachRows({ ...report, plan: undefined }, REACH, onTeam);
    expect(rows[0].what).toBe("Reach: not decided yet");
    expect(rows[0].decidedBy).toBe("");
  });

  it("is empty when the CLI posted no report", () => {
    expect(reachRows(null, REACH, onTeam)).toEqual([]);
  });

  it("reads a host out of an endpoint, and leaves a non-URL alone", () => {
    expect(hostOf("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
    expect(hostOf("api.anthropic.com")).toBe("api.anthropic.com");
  });
});

describe("revoke", () => {
  const view = (over: Partial<SessionView> = {}): SessionView => ({
    ...row(),
    commits: {},
    slots: [],
    preflight: null,
    endpointsTally: [],
    ...over,
  });

  it("member_revoke_not_cleared", () => {
    expect(mayRevoke(view(), viewer())).toBe(false);
    expect(mayRevoke(view(), viewer({ role: { level: "org-admin", at: "acme" } }))).toBe(true);
    expect(mayRevoke(view(), viewer({ role: { level: "team-admin", at: "acme.marketing" } }))).toBe(true);
  });

  it("offers nothing on a session that has already ended", () => {
    expect(mayRevoke(view({ status: "closed" }), viewer({ role: { level: "org-admin", at: "a" } }))).toBe(false);
  });

  it("reads *End session* at a personal account (07 §3)", () => {
    expect(mayRevoke(view(), viewer({ edition: "personal" }))).toBe(true);
    expect(revokeLabel(viewer({ edition: "personal" }), { revoke: "Revoke", endSession: "End session" })).toBe(
      "End session",
    );
    expect(revokeLabel(viewer(), { revoke: "Revoke", endSession: "End session" })).toBe("Revoke");
  });
});
