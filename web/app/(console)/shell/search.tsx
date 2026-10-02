"use client";

import { useEffect, useRef, useState } from "react";
import type { Scope } from "@/lib/views/types";
import { Button } from "../ui/button";
import { Icon } from "../ui/icons";

export interface SearchButtonProps {
  scope: Scope;
}

const SHORTCUTS = [
  "/ — search",
  "Escape — close what is open",
  "? — this list",
];

/** The palette and the three shortcuts, and no more (D61). */
export function SearchButton({ scope }: SearchButtonProps) {
  const palette = useRef<HTMLDialogElement>(null);
  const help = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "/") {
        event.preventDefault();
        palette.current?.showModal();
        input.current?.focus();
      } else if (event.key === "?") {
        event.preventDefault();
        help.current?.showModal();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Button size="icon" aria-label="Search" onClick={() => palette.current?.showModal()}>
        <Icon name="search" />
      </Button>
      <dialog ref={palette} data-palette className="m-auto w-full rounded-lg border border-line bg-overlay p-0 text-fg shadow-modal" style={{ maxWidth: "540px" }}>
        <input
          ref={input}
          type="search"
          value={query}
          aria-label="Search this scope"
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent px-4 py-3 text-md text-fg outline-none"
        />
        <p className="border-t border-hairline px-4 py-3 font-mono text-xs text-faint">
          {scope.kind}
        </p>
      </dialog>
      <dialog ref={help} className="m-auto rounded-lg border border-line bg-overlay p-4 text-fg shadow-modal">
        <ul className="grid gap-2 font-mono text-xs text-muted">
          {SHORTCUTS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
