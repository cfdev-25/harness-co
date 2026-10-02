import { describe, expect, it } from "vitest";
import { REFUSALS } from "@/content/refusals";
import { fill, refusal, refusalSentence } from "./refusals";

/** V1 for the one substitution step in the console (05 §7 R10). */
describe("refusals.fill", () => {
  it("puts the viewer's own chain into a sentence", () => {
    expect(fill("Ask {admin} about {team}.", { admin: "Rae Lindqvist", team: "Marketing" })).toBe(
      "Ask Rae Lindqvist about Marketing.",
    );
  });

  it("fills every occurrence of a name, not only the first", () => {
    expect(fill("{team} decides, so a {team} admin does it.", { team: "Marketing" })).toBe(
      "Marketing decides, so a Marketing admin does it.",
    );
  });

  it("leaves a name it was not given visible rather than blanking a word", () => {
    expect(fill("Ask {admin}.", {})).toBe("Ask {admin}.");
    expect(fill("Ask {admin}.", { admin: undefined })).toBe("Ask {admin}.");
  });

  it("leaves a sentence with no names exactly as authored", () => {
    const authored = REFUSALS["sessions.revoke"].sentence;
    expect(refusalSentence("sessions.revoke")).toBe(authored);
  });

  it("fills the ask line as well as the sentence", () => {
    const entry = refusal("narrow_group.member", { team: "Marketing", admin: "Rae Lindqvist" });
    expect(entry.sentence).toContain("Marketing admin");
    expect(entry.ask?.label).toBe("Ask Rae Lindqvist");
    expect(entry.sentence).not.toContain("{");
  });

  it("carries no ask where 05 §7 gives none", () => {
    expect(refusal("read_member_branch.member", { team: "Marketing" }).ask).toBeUndefined();
  });
});
