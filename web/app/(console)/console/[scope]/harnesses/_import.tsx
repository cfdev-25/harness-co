"use client";

import Link from "next/link";
import { useState } from "react";
import { fill } from "@/lib/views/refusals";
import { SETUP_HREF } from "@/lib/views/account";
import { HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { UI } from "@/content/ui";
import { Button } from "../../../ui/button";
import { CommandBlock } from "../../../ui/command-block";
import { Modal } from "../../../ui/modal";
import { Segmented } from "../../../ui/segmented";

type Provider = keyof typeof WORDS.importCommands;

const PROVIDERS = Object.keys(WORDS.importCommands) as Provider[];

/**
 * *Import*, beside *New harness* (04 §4). A dialog, not a link: importing is
 * something that happens on the person's own machine — `harness import`
 * reads `~/.claude` or `~/.pi` there (engine 08 §11.19) — and no page can do
 * it or watch it happen. So the dialog says that in one sentence, asks which
 * setup, and hands over the one line that does it.
 *
 * The two lines under the block are what the command itself prints when it
 * finishes (`commands/import.ts`), written as text and not as blocks: they
 * carry the name of a harness that does not exist yet, so copying one would
 * be copying a command with a hole in it.
 *
 * `installed` is `viewer.setup.installed` (console D100). False — including
 * on a server one deploy behind, which sends no `setup` — puts one line above
 * the block, because a command is no use on a machine with no `harness` on
 * it. It is never a reason to hide the dialog: the console cannot see a
 * machine (D45), and this fact is only ever *has a session ever run*.
 */
export function Import({ installed }: { installed: boolean }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("claude");

  return (
    <>
      <Button explain={WORDS.importExplain} onClick={() => setOpen(true)}>
        {WORDS.importLabel}
      </Button>
      {open && (
        <Modal title={WORDS.importLabel} onClose={() => setOpen(false)}>
          <div data-import className="grid gap-4">
            <p className="text-base text-muted">{WORDS.importLede}</p>
            <Segmented
              label={WORDS.importWhich}
              options={PROVIDERS.map((id) => ({ id, label: WORDS.importProviders[id] }))}
              value={provider}
              onChange={(id) => setProvider(id as Provider)}
            />
            {!installed && (
              <p className="text-base">
                <Link data-install-first className="underline" href={SETUP_HREF}>
                  {WORDS.importInstallFirst}
                </Link>
              </p>
            )}
            <CommandBlock
              label={WORDS.importProviders[provider]}
              command={WORDS.importCommands[provider]}
              copyLabel={UI.copy.copy}
              copiedLabel={UI.copy.copied}
            />
            <div className="grid gap-1">
              <p className="text-base text-muted">{WORDS.importThen}</p>
              <div data-import-next className="grid gap-0.5 font-mono text-xs text-faint">
                <span>{WORDS.importThenSwitch}</span>
                <span>{fill(WORDS.importThenRun, { provider })}</span>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
