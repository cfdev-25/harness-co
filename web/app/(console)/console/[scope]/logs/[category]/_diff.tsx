"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import type { DiffHunk } from "@/lib/views/types";
import { LOGS_TEXT } from "@/content/screens/logs";
import { Diff } from "../../../../ui/diff";
import { Disclosure } from "../../../../ui/disclosure";

export interface LogDiffProps {
  category: string;
  id: string;
  label: string;
}

/**
 * P9: plain words first, git on demand. `ui/disclosure` renders a native
 * `<details>` and exposes no `onToggle`, so the `toggle` event is attached
 * through a wrapper ref; the hunks are fetched the first time it opens and
 * never before (the list would otherwise diff every row it drew).
 */
export function LogDiff({ category, id, label }: LogDiffProps) {
  const box = useRef<HTMLDivElement>(null);
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    const details = box.current?.querySelector("details");
    if (!details) return;
    async function load() {
      if (!details?.open || hunks !== null || state === "loading") return;
      setState("loading");
      try {
        const body = await request<DiffHunk[]>(
          `/v1/console/logs/${category}/${id}/diff`,
          await getToken(),
        );
        setHunks(body);
        setState("idle");
      } catch (error) {
        setFailure(error instanceof ApiError ? error.message : String(error));
        setState("failed");
      }
    }
    details.addEventListener("toggle", load);
    return () => details.removeEventListener("toggle", load);
  }, [category, id, hunks, state]);

  return (
    <div ref={box} className="min-w-0">
      <Disclosure summary={label}>
        {hunks && hunks.length > 0 && <Diff hunks={hunks} />}
        {hunks && hunks.length === 0 && <p className="text-base text-muted">{LOGS_TEXT.noDiff}</p>}
        {state === "failed" && <p className="text-base text-warn">{failure}</p>}
      </Disclosure>
    </div>
  );
}
