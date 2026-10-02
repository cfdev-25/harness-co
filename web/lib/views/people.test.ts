import { describe, expect, it } from "vitest";
import type { PersonRow } from "./people";
import { loginsOf, personColumns, personDetail, personName, removalLists, roleOf, signInCommand, teamDisplay, topLevel } from "./people";

const team = (path: string, parent: string | null) => ({
  path, name: path.split(".").slice(-1)[0], parent,
  children: { unit: "teams", items: [] }, people: 1,
  groups: { unit: "groups", items: [] }, admins: { unit: "people", items: [] },
});

describe("people", () => {
  it("collapses the tree to the top level (PRD §12)", () => {
    const rows = [team("acme.marketing", "acme"), team("acme.marketing.interns", "acme.marketing")];
    expect(topLevel(rows).map((row) => row.path)).toEqual(["acme.marketing"]);
    expect(teamDisplay(rows[0])).toMatchObject({ team: "marketing", inside: "acme", teamsPeople: 1 });
  });

  it("carries no per-person permission list, only a role (PRD §12)", () => {
    const keys = personColumns().map((column) => column.key);
    expect(keys).toEqual(["name", "email", "teams", "role", "state", "lastActive"]);
    expect(keys).not.toContain("permissions");
  });

  it("falls back to the email when `api` sends no name", () => {
    // `PersonRow.state` is a closed set now the response model is narrow.
    const row: PersonRow = {
      id: "u1", name: "", email: "jo@acme.example",
      team: "acme.marketing", unit: "acme.marketing.jo",
      teams: { unit: "teams", items: [] }, role: { scale: "role", value: "member" },
      state: "active",
    };
    expect(personName(row)).toBe("jo@acme.example");
    expect(roleOf(row)).toBe("member");
  });

  it("reads the person's own visibility, not the viewer's (03 §4.8)", () => {
    const row: PersonRow = {
      id: "u1", name: "Jo", email: "jo@acme.example",
      team: "acme.marketing", unit: "acme.marketing.jo",
      teams: { unit: "teams", items: [] }, role: { scale: "role", value: "member" },
      state: "active", visibility: { boundaries: false, logs: true },
    };
    expect(personDetail(row).visibility).toEqual({ boundaries: false, logs: true });
    // Transparency is the default, so an absent switch is on (PRD §16).
    expect(personDetail({ ...row, visibility: undefined }).visibility).toEqual({
      boundaries: true, logs: true,
    });
  });

  it("lists what removing a person takes with them (PRD §18)", () => {
    const preview = {
      person: {
        id: "u1", name: "Jo", email: "jo@x", team: "acme.marketing",
        unit: "acme.marketing.jo", teams: { unit: "teams", items: [] },
        role: { scale: "role", value: "member" }, state: "active" as const,
      },
      loses: [{ group: "crm", via: "g1" }],
      sharedKeysToRotate: [{ ref: "secret://acme/crm", group: "crm" }],
    };
    expect(removalLists(preview).loses).toEqual([{ group: "crm", via: "g1" }]);
    expect(removalLists(preview).rotate).toEqual([{ ref: "secret://acme/crm", group: "crm" }]);
  });

  it("reads the logins from the last session's `login` slots (D45)", () => {
    // `SessionView`'s own shape (00 §4.6): `PersonRef` carries an id, and
    // `hosts`/`deny` are lists the response always sends, empty or not.
    const session = {
      id: "s1", person: { id: "u1" }, provider: { id: "claude-code" },
      model: { provider: "anthropic", model: "claude-opus-5" }, status: "closed" as const,
      startedAt: "2026-09-25T09:00:00Z", lastActiveAt: "2026-09-25T10:00:00Z",
      endpoints: { reached: 0, refused: 0 }, commits: {}, endpointsTally: [],
      hosts: [], deny: [],
      slots: [
        { need: "login:claude", state: "unsatisfied" },
        { need: "credential:crm", state: "satisfied" },
      ],
      refusals: [],
      preflight: null,
    };
    expect(loginsOf(session)).toEqual([
      { tool: "claude", present: "unsatisfied", asOf: "2026-09-25 10:00", command: "harness auth claude" },
    ]);
    expect(loginsOf(null)).toEqual([]);
  });

  it("takes the sign-in command from the shared sheet, never from here (P14)", () => {
    expect(signInCommand("claude")).toBe("harness auth claude");
    expect(signInCommand("pi")).toBe("harness auth pi");
  });
});
