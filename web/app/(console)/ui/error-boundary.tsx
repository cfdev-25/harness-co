"use client";

import { useEffect } from "react";
import { Button } from "./button";

export interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Per route segment as `error.tsx`: message, remedy, *Try again* (D27). */
export function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error(error);
  }, [error]);
  const remedy = "remedy" in error && typeof error.remedy === "string" ? error.remedy : null;
  return (
    <div className="grid justify-items-start gap-3 px-6 py-10">
      <p className="text-md text-fg">{error.message}</p>
      {remedy && <p className="text-base text-muted">{remedy}</p>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
