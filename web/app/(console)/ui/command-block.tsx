"use client";

import { useState } from "react";
import { Button } from "./button";

const CODE =
  "min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs whitespace-pre text-fg";

export interface CommandBlockProps {
  label: string;
  command: string;
  hint?: string;
  copyLabel: string;
  copiedLabel: string;
}

export function CommandBlock({ label, command, hint, copyLabel, copiedLabel }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs font-bold tracking-eyebrow text-muted uppercase">{label}</span>
        {hint && <span className="font-mono text-xs text-faint">{hint}</span>}
      </div>
      <div className="flex min-w-0 items-stretch gap-2">
        <code className={CODE}>
          {command}
        </code>
        <Button variant={copied ? "default" : "primary"} onClick={() => void copy()}>
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  );
}
