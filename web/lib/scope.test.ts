import { describe, expect, it } from "vitest";
import { howHref, readScope, scopeHref, scopeLabel, scopeQuery, scopeSegment } from "./scope";

/**
 * V1 for the two spellings of a scope (00 D2, 02 rule 4): the one segment a
 * URL carries, and the one value `api` reads in a query string (03 §4).
 */
describe("scope", () => {
  it("reads the three scopes from one segment, and nothing else", () => {
    expect(readScope({ scope: "org" })).toEqual({ kind: "org" });
    expect(readScope({ scope: "me" })).toEqual({ kind: "me" });
    expect(readScope({ scope: "acme.marketing" })).toEqual({ kind: "team", path: "acme.marketing" });
    expect(readScope({ scope: "marketing" })).toBeNull();
    expect(readScope({})).toBeNull();
  });

  it("spells a scope for the URL", () => {
    expect(scopeSegment({ kind: "team", path: "acme.marketing" })).toBe("acme.marketing");
    expect(scopeHref({ kind: "org" }, "/harnesses")).toBe("/console/org/harnesses");
  });

  it("carries `?as`, never stores it (02 rule 17)", () => {
    expect(scopeHref({ kind: "me" }, "/harnesses", { as: "u 1" })).toBe(
      "/console/me/harnesses?as=u%201",
    );
    expect(scopeHref({ kind: "me" }, "/harnesses", { as: null })).toBe("/console/me/harnesses");
  });

  it("spells a scope the way `api` reads it (03 §4)", () => {
    expect(scopeQuery({ kind: "org" })).toBe("org");
    expect(scopeQuery({ kind: "me" })).toBe("me");
    expect(scopeQuery({ kind: "team", path: "acme.marketing" })).toBe("team:acme.marketing");
  });

  it("names a scope in the viewer's words, and links every tag into How", () => {
    expect(scopeLabel({ kind: "team", path: "acme.marketing" })).toBe("marketing");
    expect(scopeLabel({ kind: "team", path: "acme.marketing" }, "Marketing")).toBe("Marketing");
    expect(howHref("approval")).toBe("/console/how#approval");
  });
});
