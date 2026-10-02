"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * 04 §13: an active session's freshness is observed, re-read every 15 s —
 * the supervise tick — so *Endpoints reached* fills while you watch. The
 * refetch is the server component's (`router.refresh()`), because a client
 * `request()` on an interval would be a second data path (02 rules 9, 12).
 */
export function Tick({ everyMs = 15000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, everyMs]);
  return null;
}
