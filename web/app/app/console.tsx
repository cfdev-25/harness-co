"use client";

import { Suspense, lazy, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * The console is a large client bundle, and until this resolves the browser
 * has not asked for it. Loading it behind the session check keeps the whole
 * administrative surface off the wire for anyone who is not signed in.
 */
const AdminApp = lazy(async () => ({ default: (await import("../admin")).AdminApp }));

export function Console() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      if (data.session) setAllowed(true);
      else router.replace("/login");
    });
    return () => {
      live = false;
    };
  }, [router]);

  if (!allowed) return <main className="min-h-screen bg-canvas" />;

  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <AdminApp />
    </Suspense>
  );
}
