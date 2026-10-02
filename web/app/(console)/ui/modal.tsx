"use client";

import { useCallback, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Icon } from "./icons";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg";
}

/**
 * A native `<dialog>` opened with `showModal()` (D67): the platform traps
 * focus, restores it on close and handles Escape. No div overlay.
 */
export function Modal({ title, onClose, children, size = "md" }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Opened as the node attaches, so the browser puts it in the top layer
  // before anything steals focus; the cleanup closes it on unmount.
  const attach = useCallback((node: HTMLDialogElement | null) => {
    dialog.current = node;
    if (node && !node.open) node.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
      style={{ maxWidth: size === "lg" ? "760px" : "540px" }}
      className="m-auto w-full rounded-lg border border-line bg-overlay p-0 text-fg shadow-modal backdrop:bg-black/50"
    >
      <div style={{ maxHeight: "80dvh" }} className="grid grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </header>
        <div className="overflow-y-auto px-5 py-4 text-md">{children}</div>
      </div>
    </dialog>
  );
}
