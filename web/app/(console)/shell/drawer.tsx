"use client";

import { useRef, useState } from "react";
import type { Scope, Viewer } from "@/lib/views/types";
import { Button } from "../ui/button";
import { Icon } from "../ui/icons";
import { Sidebar } from "./sidebar";

export interface DrawerProps {
  scope: Scope;
  viewer: Viewer;
}

/** Below 960 the sidebar is a `<dialog>`: the platform traps focus (01 §4.1). */
export function Drawer({ scope, viewer }: DrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <span className="drawer-only">
      <Button
        size="icon"
        aria-label="Navigation"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Icon name="menu" />
      </Button>
      <dialog
        ref={dialog}
        data-drawer
        onClose={() => {
          setOpen(false);
          button.current?.focus();
        }}
        className="mr-auto h-dvh max-h-dvh w-64 bg-surface p-0 text-fg"
      >
        <Sidebar scope={scope} viewer={viewer} inDrawer />
      </dialog>
    </span>
  );
}
