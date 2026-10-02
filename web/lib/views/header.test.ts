import { describe, expect, it } from "vitest";
import { readmeOf, searchIn } from "./header";
import { LOGS } from "@/content/screens/logs";

describe("readmeOf", () => {
  it("heads the readme with the page's own name", () => {
    const readme = readmeOf("Harnesses", "A new harness starts empty.");
    expect(readme?.title).toBe("About Harnesses");
  });

  it("puts the lede first and the screen's further paragraphs after it", () => {
    const readme = readmeOf("Logs", "Everything recorded about you.", LOGS.about);
    expect(readme?.body[0]).toBe("Everything recorded about you.");
    expect(readme?.body.length).toBe(1 + (LOGS.about?.length ?? 0));
  });

  it("is absent where a screen has nothing to say", () => {
    expect(readmeOf("gpl-3.0.md", "")).toBeUndefined();
    expect(readmeOf("gpl-3.0.md", null, [])).toBeUndefined();
  });

  it("drops a blank paragraph rather than rendering an empty line", () => {
    expect(readmeOf("Assets", "  ", ["A kind is a folder."])?.body).toEqual([
      "A kind is a folder.",
    ]);
  });
});

describe("searchIn", () => {
  it("takes the control's words from the shell and the placeholder from the screen", () => {
    const search = searchIn("/console/me/harnesses", "brief", "Name or description");
    expect(search.label).toBe("Search");
    expect(search.closeLabel).toBe("Close search");
    expect(search.placeholder).toBe("Name or description");
    expect(search.param).toBe("q");
    expect(search.value).toBe("brief");
  });

  it("keeps the screen's other search params on the base it writes against", () => {
    expect(searchIn("/console/me/assets?tab=browse", "", "Search").base).toBe(
      "/console/me/assets?tab=browse",
    );
  });
});
