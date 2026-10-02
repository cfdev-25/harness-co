import { readmeOf } from "@/lib/views/header";
import { loadViewer } from "@/lib/views/viewer";
import { HOW } from "@/content/screens/how";
import { SubHeader } from "../../ui/sub-header";
import { Screen } from "../../shell/screen";
import { ConsoleShell } from "../../shell/shell";
import { HowContent, HowIndex } from "./_content";
import { SetUp } from "./_setup";

/**
 * Outside `[scope]`, so every tag's `href` is one URL (00 §5, K4). The page is
 * the destination the hovers point at; it never links back to a legend and it
 * explains nothing twice (05 §9).
 *
 * *Set up* is first and above the filter box (console D105, 04 §16.1): it is
 * the one place the three install commands are printed, so the account page's
 * first two rows link here instead of repeating them. `HARNESS_API_ORIGIN` is
 * read here because it is server-only (02 D23) — a deployed console must set
 * it to the **public** API URL, which is the address the CLI will dial.
 */
export default async function HowPage() {
  const { viewer, notice } = await loadViewer({ kind: "me" });
  const apiOrigin = process.env.HARNESS_API_ORIGIN ?? null;
  return (
    <ConsoleShell scope={{ kind: "me" }} viewer={viewer} fixtureNotice={notice}>
      <Screen
        bar={<SubHeader readme={readmeOf(HOW.title, HOW.lede)} />}
        aside={<HowIndex />}
        asideSide="start"
      >
        <SetUp apiOrigin={apiOrigin} />
        <HowContent />
      </Screen>
    </ConsoleShell>
  );
}
