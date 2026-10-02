import { describe, expect, it } from "vitest";
import {
  BUNDLED,
  MACHINE,
  filterSecrets,
  findingOf,
  isBundled,
  isMachine,
  listable,
  reachableText,
  secretColumns,
  secretReady,
  vaultColumns,
} from "./vaults";

const bundled = {
  id: BUNDLED, handsUs: "stored", issues: "stored", contents: "listable",
  reachable: { value: true, provenance: "observed" as const },
  groups: { unit: "groups", items: [] },
};
const machine = { ...bundled, id: MACHINE, contents: "not listable", reachable: { value: null, provenance: "observed" as const } };

const secret = (over: object) => ({
  ref: "secret://acme/crm", group: "bundled",
  groups: { unit: "groups", items: [] },
  ready: { value: true, provenance: "observed" as const },
  lastUsed: null, uncovered: false, dangling: false, ...over,
});

describe("vaults", () => {
  it("makes the person's machine a row, with no reachability we did not check", () => {
    expect(isMachine(machine)).toBe(true);
    expect(isBundled(bundled)).toBe(true);
    expect(reachableText(machine, "yes", "no", "unknown")).toBe("unknown");
    expect(reachableText(bundled, "yes", "no", "unknown")).toBe("yes");
    expect(reachableText({ ...bundled, reachable: { value: false, provenance: "observed" } }, "yes", "no", "u")).toBe("no");
  });

  it("degrades honestly when a vault grants no list permission", () => {
    expect(listable(bundled)).toBe(true);
    expect(listable(machine)).toBe(false);
  });

  it("carries no rotation age and no hygiene column (PRD §6.5)", () => {
    const keys = [...vaultColumns(), ...secretColumns()].map((column) => column.key);
    expect(keys).not.toContain("rotationAge");
    expect(keys).not.toContain("hygiene");
    expect(keys).toContain("lastUsed");
  });

  it("turns PRD §6.7's two findings into filters over the one list", () => {
    const rows = [secret({}), secret({ ref: "a", uncovered: true }), secret({ ref: "b", dangling: true })];
    expect(filterSecrets(rows, "all")).toHaveLength(3);
    expect(filterSecrets(rows, "uncovered").map((row) => row.ref)).toEqual(["a"]);
    expect(filterSecrets(rows, "dangling").map((row) => row.ref)).toEqual(["b"]);
    expect(findingOf("nonsense")).toBe("all");
    expect(findingOf("dangling")).toBe("dangling");
  });

  it("reads a secret's readiness as observed, null when unchecked", () => {
    expect(secretReady(secret({}))).toBe(true);
    expect(secretReady(secret({ ready: { provenance: "observed" } }))).toBe(null);
  });
});
