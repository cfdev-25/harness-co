"use client";

import { CommandBlock } from "./command-block";
import { Modal } from "./modal";
import { SectionLabel } from "./section-label";

export interface CommandSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The shared sheet, grouped as the CLI groups it (P14, 05 §6). */
  groups: Array<{ group: string; rows: Array<{ what: string; run: string; note?: string }> }>;
  copyLabel: string;
  copiedLabel: string;
  /**
   * *How this works* prints the same sheet as a section of the page rather
   * than in a dialog (05 §9). Same rows, same grouping, same copy button —
   * so it is this component with its `Modal` left off, not a second rendering
   * of the sheet in the screen (K6).
   */
  inline?: boolean;
}

function Sheet(props: Pick<CommandSheetProps, "groups" | "copyLabel" | "copiedLabel">) {
  return (
    <div className="grid gap-5">
      {props.groups.map((group) => (
        <div key={group.group} className="grid gap-3">
          <SectionLabel>{group.group}</SectionLabel>
          {group.rows.map((row) => (
            <CommandBlock
              key={row.run}
              label={row.what}
              command={row.run}
              hint={row.note}
              copyLabel={props.copyLabel}
              copiedLabel={props.copiedLabel}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CommandSheet(props: CommandSheetProps) {
  if (props.inline) return <Sheet {...props} />;
  if (!props.open) return null;
  return (
    <Modal title={props.title} onClose={props.onClose} size="lg">
      <Sheet {...props} />
    </Modal>
  );
}
