import { consoleOrigin } from "@/lib/origin.server";
import { readmeOf } from "@/lib/views/header";
import { howTabs } from "@/lib/views/how";
import { loadViewer } from "@/lib/views/viewer";
import { HOW, HOW_SETUP } from "@/content/screens/how";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { ConsoleShell } from "../../../shell/shell";
import { SetUp } from "../_setup";

/**
 * *Set up* — the first tab of *How this works* (04 §16.1, console D105). A
 * route of its own rather than a section of the reference, because it is the
 * one thing on this page a person is sent to do, and the Account screen's
 * *Getting started* rows link straight at it (`SETUP_HREF`).
 *
 * Two origins, both read here because both are server-only: `HARNESS_API_ORIGIN`
 * is the address the CLI dials (02 D23), and `consoleOrigin()` is this
 * console's own, which is where `/install.sh` is served from (W7-D6).
 */
export default async function SetUpPage() {
  const [{ viewer, notice }, installOrigin] = await Promise.all([
    loadViewer({ kind: "me" }),
    consoleOrigin(),
  ]);
  const apiOrigin = process.env.HARNESS_API_ORIGIN ?? null;
  return (
    <ConsoleShell scope={{ kind: "me" }} viewer={viewer} fixtureNotice={notice}>
      <Screen
        bar={
          <SubHeader
            tabsLabel={HOW.title}
            tabs={howTabs("setup")}
            readme={readmeOf(HOW_SETUP.title, HOW_SETUP.lede)}
          />
        }
      >
        <SetUp apiOrigin={apiOrigin} installOrigin={installOrigin} />
      </Screen>
    </ConsoleShell>
  );
}
