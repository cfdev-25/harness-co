import { describe, expect, it } from "vitest";
import { entriesOf, givesOf, grantColumns, grantLabel, narrowPreview, narrowable, sourcesOf } from "./groups";

const grant = { id: "g1", group: "crm", gives: "entries" as const, entryCount: 3, sources: "vault", teams: { unit: "teams", items: [] }, harnesses: { unit: "harnesses", items: [] } };
const reach = { ...grant, id: "g2", group: null, gives: "reach" as const, entryCount: 0 };

describe("groups", () => {
  it("tells a group grant from a reach grant by Gives alone (PRD §8)", () => {
    expect(givesOf(grant)).toBe("3 entries");
    expect(givesOf({ ...grant, entryCount: 1 })).toBe("1 entry");
    expect(givesOf(reach)).toBe("nothing — reach is set under Boundaries");
    expect(grantLabel(reach)).toBe("Reach grant, retired");
  });

  it("reads sources as a rule with two values, not a scale (D41)", () => {
    expect(sourcesOf("vault-or-local")).toBe("vault or local");
    expect(sourcesOf("vault")).toBe("vault only");
    expect(sourcesOf(null)).toBe("vault only");
  });

  it("hides granted-to, only-for and narrowed-from at n = 0 (07 §3)", () => {
    const keys = grantColumns(true).map((column) => column.key);
    expect(keys).not.toContain("grantedTo");
    expect(keys).not.toContain("narrowedFrom");
    expect(grantColumns(false).map((column) => column.key)).toContain("grantedTo");
  });

  it("writes the narrowing preview as one sentence that updates", () => {
    expect(narrowPreview("Interns", ["crm"], ["email"])).toBe(
      "Interns will be able to resolve crm. They will not get email.",
    );
    expect(narrowPreview("Interns", ["crm", "email"], [])).toBe(
      "Interns will be able to resolve crm and email.",
    );
    expect(narrowPreview("Interns", [], ["crm"])).toContain("untick fewer entries");
  });

  it("offers only the group grants a team already holds", () => {
    expect(narrowable([grant, reach]).map((row) => row.id)).toEqual(["g1"]);
  });

  it("reads an entry as the policy holds it (03 §4.5)", () => {
    const entries = entriesOf([
      {
        alias: "crm-key",
        secret: { vault: "bundled", ref: "secret://acme/crm" },
        upstream: "https://crm.example.com",
        attach: { header: "Authorization", prefix: "Bearer " },
      },
    ]);
    expect(entries[0]).toEqual({
      alias: "crm-key",
      vault: "bundled",
      ref: "secret://acme/crm",
      upstream: "https://crm.example.com",
      header: "Authorization",
    });
  });
});
