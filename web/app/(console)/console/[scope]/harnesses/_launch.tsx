import { HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { openAgainLine, runHref, type HarnessCard } from "@/lib/views/harness";
import { Mono } from "../../../ui/mono";

/**
 * W5-D13, the launch row of a harness card (04 §4). One `harness://` link per
 * runtime the **server** says can start this harness here (`HarnessCard.runners`
 * — approval, scope and wire format are its three clauses, never this page's),
 * plus W5-D14's breadcrumb when this person has run it somewhere before.
 *
 * A plain `<a>`, not `next/link`: the destination is not a route, it is the
 * operating system. The row sits above the card's overlay link (`z-10`, the
 * way the team cell does), so pressing a runtime opens a terminal and does
 * not open the harness page.
 */

const LINK = "rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-semibold"
  + " text-fg no-underline hover:border-accent";
const QUIET = "text-accent-text hover:underline";

export function Launch({ card }: { card: HarnessCard }) {
  const runners = card.runners ?? [];
  if (runners.length === 0) return null;
  // W5-D14: the backend nulls another person's workspace (and every workspace
  // under `?as`), so the breadcrumb is drawn from presence and nothing else.
  const again = openAgainLine(card, WORDS);
  return (
    <div className="relative z-10 grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{WORDS.openIn}</span>
        {runners.map((runner) => (
          <a
            key={runner.id}
            href={runHref(card.id, runner.id)}
            aria-label={WORDS.openInOne.replace("{runner}", runner.name)}
            className={LINK}
          >
            {runner.name}
          </a>
        ))}
      </div>
      {again && (
        <p className="text-xs text-muted">
          {runners.length === 1 ? (
            // One runtime: the sentence is the link.
            <a href={runHref(card.id, runners[0].id, card.lastWorkspace)} className={QUIET}>
              {again}
            </a>
          ) : (
            // More than one: the sentence says where, and each runtime is its
            // own quiet link after it — a menu would be a client component and
            // a popover for two words.
            <>
              {again}
              {runners.map((runner) => (
                <a
                  key={runner.id}
                  href={runHref(card.id, runner.id, card.lastWorkspace)}
                  className={`${QUIET} ms-2`}
                >
                  {runner.name}
                </a>
              ))}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The line under the grid (W5-D13). A web page cannot detect a registered
 * link type — there is no API for it — so the console says what the buttons
 * do and links the guide rather than guessing and warning wrongly.
 */
export function LaunchNote() {
  return (
    <p className="pb-2 text-xs text-muted">
      {WORDS.launchNote}{" "}
      <a href={WORDS.installHref} className={QUIET}>
        {WORDS.installLink}
      </a>{" "}
      {WORDS.launchRun} <Mono>{WORDS.setupCommand}</Mono>
    </p>
  );
}
