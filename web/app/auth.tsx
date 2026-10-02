"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { browserClient } from "@/lib/supabase.client";
import { getToken } from "@/lib/token.client";
import { BrandMark } from "./(console)/ui/brand-mark";
import { Alert, Button, Eyebrow, Field } from "./ui";

/** Where a signed-in person lands when nothing else is asked for (02 rule 11). */
export const AFTER_SIGN_IN = "/console/me/harnesses";

/**
 * `?next=` is a path on this site and nothing else: a value that does not
 * start with a single `/` would send the person to another origin.
 */
export function safeNext(next?: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return AFTER_SIGN_IN;
  return next;
}

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="brand-wash grid min-h-screen place-items-center bg-canvas p-6">
      <section className="w-full max-w-[460px] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
        <div className="relative flex items-center gap-3 overflow-hidden bg-ink px-8 py-7 text-ink-text max-sm:px-6">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-20 -bottom-28 size-52 rounded-full border-[20px] border-accent/25"
          />
          <Link href="/" className="relative">
            <BrandMark />
          </Link>
        </div>
        <div className="p-8 max-sm:p-6">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="mt-1.5 text-[26px] font-bold tracking-[-0.03em]">{title}</h1>
          {description && (
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{description}</p>
          )}
          {children}
        </div>
      </section>
    </main>
  );
}

/**
 * Sign-in only. Making an account is `/signup` (W7-D1, D101a) — Team or
 * Personal, your email, then a link that brings you back to set the password
 * and give the access code. The invite path is the same shape and unchanged:
 * an admin invites the address, GoTrue mails the link, and the person signs
 * in here afterwards.
 */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    // Signing in writes the session cookie; `AuthApp`'s subscription sees it
    // and decides where the person goes, so there is one redirect, not two.
    const { error: cause } = await browserClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (cause) setError(cause.message);
  }

  return (
    <AuthShell
      title="Sign in"
      description="Manage harnesses for yourself or your organisation."
    >
      <form className="mt-6 grid gap-4" onSubmit={submit}>
        <Field
          label="Email"
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoFocus
        />
        <Field
          label="Password"
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <Button variant="primary" full type="submit" disabled={busy}>
          {busy ? "Working…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-[12.5px] text-muted">
        New here?{" "}
        <Link href="/signup" className="text-accent underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

/**
 * Sign-in, and the one place that decides where a signed-in person goes.
 * `next` comes from the server component that read the query string, so this
 * file needs no `useSearchParams` and `/login` needs no Suspense boundary.
 */
export function AuthApp({ next }: { next?: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const enter = useCallback(() => {
    // `refresh()` first: the console is server-rendered, and without it Next
    // may answer the navigation from a cache taken before the cookie existed.
    router.refresh();
    router.replace(safeNext(next));
  }, [router, next]);

  useEffect(() => {
    const supabase = browserClient();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const live = Boolean(session);
      setSignedIn(live);
      setReady(true);
      if (!live) return;
      // An account with no org unit has nowhere to land; `/v1/tree` answers
      // 404 for exactly that case. Making the first organisation is `/signup`
      // and nowhere else, because the access code is checked on that write
      // (W7-D1) — so this is where someone who followed the link on another
      // machine, or left at the access code, resumes: `/signup` sees the
      // session and opens its last step.
      getToken()
        .then((token) => request("/v1/tree", token))
        .then(enter)
        .catch((cause) => {
          if (cause instanceof ApiError && cause.status === 404) {
            router.replace("/signup");
            return;
          }
          enter();
        });
    });
    return () => data.subscription.unsubscribe();
  }, [enter, router]);

  // Signed in and on the way somewhere — the console, or `/signup` to finish
  // making the organisation — is a blank canvas, never a flash of the form.
  if (!ready || signedIn) return <main className="min-h-screen bg-canvas" />;
  return <Login />;
}
