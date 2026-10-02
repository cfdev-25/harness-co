import { HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { runHref, shortPath, type HarnessCard } from "@/lib/views/harness";
import { Mono } from "../../../ui/mono";

/**
 * W5-D13, the one action row of a harness card (04 §4). The runtimes are the
 * **server's** (`HarnessCard.runners` — approval, scope and wire format are
 * its three clauses, never this page's); the page chooses only between the
 * two shapes the row has.
 *
 * D107: when this person has run the harness somewhere, carrying on is the
 * thing they came to do, so the row is **one primary verb** — *Resume*, the
 * first runtime in the last workspace — with the folder beside it in muted
 * text and any further runtime as a small second link. With no workspace it
 * is what it has always been: *Open in …*, one link per runtime. One row
 * either way, and never both.
 *
 * A plain `<a>`, not `next/link` and not `Button` (whose `href` is a
 * `next/link`): the destination is not a route, it is the operating system.
 * The row sits above the card's overlay link (`z-10`, the way the meta row
 * does), so pressing a runtime opens a terminal and not the harness page.
 */

const PRIMARY = "inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3"
  + " text-base font-semibold whitespace-nowrap text-ink no-underline hover:bg-accent-deep";
const LINK = "inline-flex h-6 items-center rounded-md border border-line bg-surface px-2 text-xs"
  + " font-semibold whitespace-nowrap text-fg no-underline hover:border-accent";
const QUIET = "text-accent-text hover:underline";

export function Launch({ card }: { card: HarnessCard }) {
  const runners = card.runners ?? [];
  if (runners.length === 0) return null;
  // W5-D14: the backend nulls another person's workspace (and every workspace
  // under `?as`), so the shape is chosen from presence and nothing else.
  const workspace = card.lastWorkspace ?? null;
  return (
    <div className="relative z-10 flex flex-wrap items-center gap-2">
      {workspace ? (
        <>
          <a href={runHref(card.id, runners[0].id, workspace)} className={PRIMARY}>
            {WORDS.resume}
          </a>
          {/* Outside the link: *Resume* is the verb and the folder is the
              fact. `~` is display only — the href carries the absolute path,
              because the CLI refuses a relative one (`cli.link_malformed`). */}
          <span className="min-w-0 truncate text-xs text-muted">
            {WORDS.resumeAt.replace("{workspace}", shortPath(workspace))}
          </span>
          {runners.slice(1).map((runner) => (
            <a
              key={runner.id}
              href={runHref(card.id, runner.id, workspace)}
              aria-label={WORDS.resumeIn.replace("{runner}", runner.name)}
              className={LINK}
            >
              {runner.name}
            </a>
          ))}
        </>
      ) : (
        <>
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
        </>
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
