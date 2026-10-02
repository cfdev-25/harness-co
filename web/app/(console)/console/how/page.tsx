import { readmeOf } from "@/lib/views/header";
import { howTabs } from "@/lib/views/how";
import { loadViewer } from "@/lib/views/viewer";
import { HOW } from "@/content/screens/how";
import { SubHeader } from "../../ui/sub-header";
import { Screen } from "../../shell/screen";
import { ConsoleShell } from "../../shell/shell";
import { HowContent, HowIndex } from "./_content";

/**
 * Outside `[scope]`, so every tag's `href` is one URL (00 §5, K4). The page is
 * the destination the hovers point at; it never links back to a legend and it
 * explains nothing twice (05 §9).
 *
 * This is the **Reference** tab. *Set up* is the other one, at
 * `/console/how/setup` (04 §16.1): what a person does once per machine is a
 * route of its own, so the reference is only the reference and the account
 * page's *Getting started* rows link straight at the instructions.
 */
export default async function HowPage() {
  const { viewer, notice } = await loadViewer({ kind: "me" });
  return (
    <ConsoleShell scope={{ kind: "me" }} viewer={viewer} fixtureNotice={notice}>
      <Screen
        bar={
          <SubHeader
            tabsLabel={HOW.title}
            tabs={howTabs("reference")}
            readme={readmeOf(HOW.title, HOW.lede)}
          />
        }
        aside={<HowIndex />}
        asideSide="start"
      >
        <HowContent />
      </Screen>
    </ConsoleShell>
  );
}
