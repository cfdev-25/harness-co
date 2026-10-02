"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

export interface ConfirmProps {
  title: string;
  /** What the action takes with it — the preview, not *Are you sure?* (§18). */
  takes: ReactNode;
  verb: string;
  cancel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  /**
   * The verb waits on something the dialog itself shows: a removal preview
   * still loading, a reason not yet typed (04 §13). It is never a refusal —
   * a verb the viewer lacks is `PermissionNotCleared` and the dialog is not
   * opened at all (P13, 01 §7.1).
   */
  disabled?: boolean;
}

export function Confirm(props: ConfirmProps) {
  const { title, takes, verb, cancel, onConfirm, onClose, busy, disabled } = props;
  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid gap-4">
        <div data-confirm-takes className="grid gap-2">
          {takes}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{cancel}</Button>
          <Button
            variant="danger"
            busy={busy}
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onConfirm}
          >
            {verb}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
