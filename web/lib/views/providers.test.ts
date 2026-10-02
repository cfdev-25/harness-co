import { describe, expect, it } from "vitest";
import {
  endpointsOf,
  harnessProviderColumns,
  matrixRows,
  modelProviderColumns,
  needsKey,
  noneApproved,
  noneConnected,
  routedSubjects,
  routingMaps,
  runtimeName,
  scopeOf,
  signIn,
  pinOf,
  speaksOf,
  statusOf,
  subjectLabels,
  subjectsOf,
  withApproval,
  withDefault,
  withoutApproval,
} from "./providers";

const runtime = {
  id: "pi",
  name: "Pi",
  approval: "approved",
  speaks: ["openai-completions", "anthropic-messages"],
  pin: { repo: "https://example.com", commit: "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759" },
  reason: null,
  teams: { unit: "teams", items: [], all: true },
  canRun: { unit: "harnesses", items: [] },
};

const model = {
  id: "anthropic",
  endpoints: { "openai-completions": "https://api.anthropic.com" },
  models: ["claude-opus-5"],
  credential: "anthropic-api-key",
  status: "set-up",
  groups: { unit: "groups", items: [] },
  // `ModelProviderRow`'s routing block names all three subjects (03 §5.2);
  // an empty list is how a subject says *nobody*, never a missing key.
  defaultFor: { teams: ["acme"], harnesses: [], providers: [] },
  approvedFor: { teams: ["acme"], harnesses: [], providers: ["pi"] },
};

const HARNESS = "7bb0f4ee-0e8a-4f6a-9df0-4b6bd3f0a001";

/** `GET /v1/console/routing` as the server composes it (W6-D5): the two maps,
 *  what each team resolves to, and the subjects the verbs may pick. */
const MATRIX = {
  defaultFor: { teams: { acme: "anthropic" }, harnesses: {}, providers: { pi: "anthropic" } },
  approvedFor: {
    teams: { acme: ["anthropic"] },
    harnesses: { [HARNESS]: ["openai"] },
    providers: { pi: ["anthropic"] },
  },
  resolved: { acme: { value: "anthropic", provenance: "derived" as const } },
  subjects: {
    teams: [{ id: "acme", label: "acme" }, { id: "acme.marketing", label: "marketing" }],
    harnesses: [{ id: HARNESS, label: "Newsletter" }],
    providers: [{ id: "pi", label: "Pi" }],
  },
};

describe("providers", () => {
  it("shows a pin as a commit or a minimum version, never both", () => {
    expect(pinOf(runtime)).toBe("60e7e76bd7ea");
    expect(pinOf({ ...runtime, pin: { version: "1.2.0" } })).toBe("binary ≥ 1.2.0");
    expect(pinOf({ ...runtime, pin: {} })).toBe("");
    expect(speaksOf(runtime)).toBe("openai-completions, anthropic-messages");
  });

  it("hides approval and its scope at n = 0, where every runtime is available", () => {
    const keys = harnessProviderColumns(true).map((column) => column.key);
    expect(keys).not.toContain("approval");
    expect(keys).not.toContain("approvedFor");
    expect(harnessProviderColumns(false).map((column) => column.key)).toContain("approval");
  });

  it("keeps the endpoints per format", () => {
    expect(endpointsOf(model)).toEqual([
      { format: "openai-completions", url: "https://api.anthropic.com" },
    ]);
  });

  it("reads the status as one of the four, and an absent one as needs-key (W6-D6, W7-D2)", () => {
    expect(statusOf(model)).toBe("set-up");
    expect(needsKey(model)).toBe(false);
    expect(statusOf({ ...model, status: "unreachable" })).toBe("unreachable");
    expect(statusOf({ ...model, status: "sign-in" })).toBe("sign-in");
    // A server that has not landed the field yet, and a value nothing
    // registered: both read as the state that offers *Set up* and routes
    // nowhere, rather than claiming a key is held or a sign-in exists.
    expect(statusOf({ ...model, status: undefined })).toBe("needs-key");
    expect(statusOf({ ...model, status: "wobbly" })).toBe("needs-key");
    expect(needsKey({ ...model, status: undefined })).toBe(true);
  });

  it("W7-D2: a sign-in row is not excluded — it keeps its routing verbs", () => {
    // The broker allows that session, so the one thing `needsKey` drives — the
    // row being out of *Default for* and *Approved for* — must not fire here.
    const row = { ...model, status: "sign-in" };
    expect(needsKey(row)).toBe(false);
    expect(signIn(row)).toBe(true);
    expect(signIn(model)).toBe(false);
    expect(signIn({ ...model, status: "needs-key" })).toBe(false);
  });

  it("makes *Default for* and *Approved for* columns of this table (W6-D5)", () => {
    const keys = modelProviderColumns().map((column) => column.key);
    expect(keys).toEqual([
      "provider", "endpoints", "models", "credentialAlias", "status", "defaultFor", "approvedFor",
    ]);
    // The old *Approved for providers* column was routing's `providers`
    // dimension under a heading that called it derived (D95); it is one of the
    // three dimensions the new column shows whole.
    expect(keys).not.toContain("approvedForProviders");
    const status = modelProviderColumns().find((column) => column.key === "status");
    expect(status).toMatchObject({ kind: "scale", scale: "providerStatus" });
  });

  it("names a runtime by its contract name, and falls back to the id (W6-D3)", () => {
    expect(runtimeName(runtime)).toBe("Pi");
    expect(runtimeName({ ...runtime, name: undefined })).toBe("pi");
  });

  it("sends the row's own scope back, and never widens it to every team", () => {
    expect(scopeOf({ ...runtime, scope: { teams: ["acme.marketing"] } })).toEqual({
      teams: ["acme.marketing"],
    });
    expect(scopeOf({ ...runtime, scope: { teams: "all" } })).toEqual({ teams: "all" });
    // No `scope` on the row: the *Approved for* cell is what the server showed.
    expect(scopeOf(runtime)).toEqual({ teams: "all" });
    expect(
      scopeOf({
        ...runtime,
        teams: { unit: "teams", items: [{ id: "acme.ops", label: "Ops", href: "/console/acme.ops" }] },
      }),
    ).toEqual({ teams: ["acme.ops"] });
  });

  it("raises the first-run notice only while nothing is approved or connected", () => {
    expect(noneApproved([{ ...runtime, approval: "not_approved" }])).toBe(true);
    expect(noneApproved([{ ...runtime, approval: "beta" }])).toBe(true);
    expect(noneApproved([runtime, { ...runtime, id: "claude-code" }])).toBe(false);
    // An organization with no rows at all reads its empty state, not a notice.
    expect(noneApproved([])).toBe(false);
    expect(noneConnected([{ ...model, credential: null }])).toBe(true);
    expect(noneConnected([model])).toBe(false);
    expect(noneConnected([])).toBe(false);
  });

  it("builds the matrix over three dimensions, and one row at a team", () => {
    const all = matrixRows(MATRIX, null);
    expect(all.map((row) => row.dimension)).toEqual(["teams", "harnesses", "providers"]);
    expect(all[0]).toMatchObject({ subject: "acme", defaultFor: "anthropic", resolved: "anthropic" });
    // W6-D5: a harness id is a uuid, so the matrix reads the server's label.
    expect(all[1]).toMatchObject({ subject: HARNESS, label: "Newsletter" });
    expect(matrixRows(MATRIX, "acme")).toHaveLength(1);
    expect(matrixRows(MATRIX, "acme.other")).toHaveLength(0);
  });

  it("offers the subjects the server listed, each with its word (W6-D5)", () => {
    expect(subjectsOf(MATRIX, "teams")).toEqual([
      { id: "acme", label: "acme" },
      { id: "acme.marketing", label: "marketing" },
    ]);
    expect(subjectsOf(MATRIX, "harnesses")).toEqual([{ id: HARNESS, label: "Newsletter" }]);
    expect(subjectsOf(MATRIX, "providers")).toEqual([{ id: "pi", label: "Pi" }]);
    // No `subjects` from the server is an empty picker, never an invented one.
    expect(subjectsOf({ ...MATRIX, subjects: undefined } as unknown as typeof MATRIX, "teams")).toEqual([]);
    expect(subjectLabels(MATRIX)[HARNESS]).toBe("Newsletter");
  });

  it("reads a row's *Default for* and *Approved for* with those words", () => {
    expect(routedSubjects(model.defaultFor, subjectLabels(MATRIX))).toEqual([
      { dimension: "teams", id: "acme", label: "acme" },
    ]);
    expect(
      routedSubjects({ teams: ["acme"], harnesses: [HARNESS], providers: ["pi"] },
                     subjectLabels(MATRIX)),
    ).toEqual([
      { dimension: "teams", id: "acme", label: "acme" },
      { dimension: "harnesses", id: HARNESS, label: "Newsletter" },
      { dimension: "providers", id: "pi", label: "Pi" },
    ]);
  });

  it("sends the whole routing file back, with one cell changed (W6-D5)", () => {
    // The write replaces the file, so every other cell has to travel with it.
    expect(routingMaps(MATRIX)).toEqual({
      defaultFor: { teams: { acme: "anthropic" }, harnesses: {}, providers: { pi: "anthropic" } },
      approvedFor: {
        teams: { acme: ["anthropic"] },
        harnesses: { [HARNESS]: ["openai"] },
        providers: { pi: ["anthropic"] },
      },
    });

    // A default is an approval too: a default outside *approved for* is a cell
    // that resolves to a provider the broker refuses.
    const asDefault = withDefault(MATRIX, "teams", "acme.marketing", "openai");
    expect(asDefault.defaultFor.teams).toEqual({ acme: "anthropic", "acme.marketing": "openai" });
    expect(asDefault.approvedFor.teams).toEqual({
      acme: ["anthropic"],
      "acme.marketing": ["openai"],
    });

    const approved = withApproval(MATRIX, "harnesses", HARNESS, "anthropic");
    expect(approved.approvedFor.harnesses[HARNESS]).toEqual(["openai", "anthropic"]);
    // Twice is once: the list is a set in the file's clothing.
    expect(withApproval(MATRIX, "harnesses", HARNESS, "openai").approvedFor.harnesses[HARNESS])
      .toEqual(["openai"]);

    // Removing an approval takes the default that relied on it with it.
    const removed = withoutApproval(MATRIX, "teams", "acme", "anthropic");
    expect(removed.approvedFor.teams.acme).toEqual([]);
    expect(removed.defaultFor.teams).toEqual({});
    // Another provider's default on the same subject stays.
    expect(withoutApproval(MATRIX, "providers", "pi", "openai").defaultFor.providers).toEqual({
      pi: "anthropic",
    });
  });
});
