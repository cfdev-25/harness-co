"use client";

import { useState } from "react";
import { COMMAND_SHEET } from "@/content/commands.generated";
import { HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { UI } from "@/content/ui";
import { Button } from "../../../../ui/button";
import { CommandSheet } from "../../../../ui/command-sheet";

/** P14: one table, two renderers — the CLI's `harness commands` and this. */
export function Commands() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)} explain={WORDS.aside.commands}>
        {WORDS.aside.commands}
      </Button>
      <CommandSheet
        open={open}
        onClose={() => setOpen(false)}
        title={UI.commands.title}
        groups={COMMAND_SHEET}
        copyLabel={UI.copy.copy}
        copiedLabel={UI.copy.copied}
      />
    </div>
  );
}
