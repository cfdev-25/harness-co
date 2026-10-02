"use client";

import { useState } from "react";
import { Modal } from "./modal";

export interface ReadmeProps {
  /** The modal's heading — *About {name}*, from `content/shell.ts`. It is
   *  also the mark's accessible name, which is the whole of its label. */
  title: string;
  /** The screen's lede, then any further explanatory paragraphs it has. */
  body: string[];
}

const MARK =
  "cursor-help rounded-full border border-line px-1 font-mono text-2xs text-muted hover:text-fg";

/**
 * What this screen is, read on demand (01 §7.5).
 *
 * `HelpMark`'s idiom — the console's one mark for *there is an explanation
 * here* — on the sub-header bar rather than on a column heading, and a
 * `Modal` rather than a tooltip, because a screen's explanation is
 * paragraphs. A screen with nothing to say passes no readme and the bar has
 * no mark: a mark that opens an empty dialog is a lie about what is behind
 * it.
 */
export function Readme({ title, body }: ReadmeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={title} className={MARK} onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <div className="grid gap-3">
            {body.map((paragraph) => (
              <p key={paragraph} className="text-md text-fg">
                {paragraph}
              </p>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
