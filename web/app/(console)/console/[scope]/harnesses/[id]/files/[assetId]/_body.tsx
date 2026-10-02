"use client";

import type { DiffHunk } from "@/lib/views/types";
import { COMMAND_SHEET } from "@/content/commands.generated";
import { FILE, FILE_WORDS as WORDS } from "@/content/screens/file";
import { UI } from "@/content/ui";
import { CommandBlock } from "../../../../../../ui/command-block";
import { Compare } from "../../../../../../ui/compare";
import { Diff } from "../../../../../../ui/diff";
import { Disclosure } from "../../../../../../ui/disclosure";
import { Notice } from "../../../../../../ui/notice";
import { SectionLabel } from "../../../../../../ui/section-label";

const BODY =
  "overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs whitespace-pre-wrap text-fg";

/** The sheet is the one table (P14, D40); a command is looked up, not typed. */
function sheet(prefix: string, path: string): string {
  for (const group of COMMAND_SHEET) {
    for (const row of group.rows) {
      if (row.run.startsWith(prefix)) return row.run.replace(/(tool|skill|prompt)\/[\w-]+/, path);
    }
  }
  return `${prefix} ${path}`;
}

/**
 * 04 §6's content region. A conflict is the two-column form with the diff
 * beneath it and the three outs as commands; anything else is the file, then
 * *What changed* in plain words with git on demand (P9). Every hunk is the
 * server's — the console never diffs text itself (D8, 01 D66).
 */
export function FileBody({
  conflict,
  mine,
  team,
  content,
  diff,
  path,
}: {
  conflict: boolean;
  mine: string | null;
  team: string | null;
  content: string | null;
  diff: DiffHunk[];
  path: string;
}) {
  // P9, and no invented claim: *matches* is only true when there are two
  // copies to compare. With one copy there is nothing to have changed.
  const bothCopies = mine !== null && team !== null;
  if (conflict) {
    return (
      <div className="grid gap-4">
        <Compare
          left={{ label: WORDS.compareMine, children: <pre className={BODY}>{mine}</pre> }}
          right={{ label: WORDS.compareTeam, children: <pre className={BODY}>{team}</pre> }}
          notice={<Notice tone="warn">{WORDS.conflict}</Notice>}
        />
        {diff.length > 0 && <Diff hunks={diff} />}
        <div data-outs className="grid gap-3 border-t border-hairline pt-4">
          <SectionLabel>{WORDS.outs.label}</SectionLabel>
          <CommandBlock
            label={WORDS.outs.keepMine}
            command={sheet("harness push", path)}
            copyLabel={UI.copy.copy}
            copiedLabel={UI.copy.copied}
          />
          <CommandBlock
            label={WORDS.outs.takeTheirs}
            command={sheet("harness reset ", path)}
            copyLabel={UI.copy.copy}
            copiedLabel={UI.copy.copied}
          />
          <CommandBlock
            label={WORDS.outs.editByHand}
            command={sheet("harness diff", path)}
            copyLabel={UI.copy.copy}
            copiedLabel={UI.copy.copied}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <pre className={BODY}>{content}</pre>
      <section className="grid gap-2">
        <SectionLabel>{WORDS.whatChanged}</SectionLabel>
        {diff.length === 0 ? (
          <p className="text-base text-muted">{bothCopies ? WORDS.noChange : WORDS.oneCopy}</p>
        ) : (
          <Disclosure summary={FILE.verbs.viewAsGit.label}>
            <Diff hunks={diff} />
          </Disclosure>
        )}
      </section>
    </div>
  );
}
