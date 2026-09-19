"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Alert, BrandMark, Button, Eyebrow, Field } from "./ui";

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

export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const action =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error: cause } = await action;
    setBusy(false);
    if (cause) setError(cause.message);
  }

  return (
    <AuthShell
      title={mode === "signin" ? "Sign in" : "Create account"}
      description={
        mode === "signin"
          ? "Manage harnesses for yourself or your organization."
          : "Your workspace is created when you accept an invite or start an organization."
      }
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
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <Button variant="primary" full type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      <Button
        full
        className="mt-3"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "Need an account?" : "Have an account?"}
      </Button>
    </AuthShell>
  );
}

export function Onboarding({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request("/v1/orgs", {
        method: "POST",
        body: JSON.stringify({
          org_name: form.get("org_name"),
          team_name: form.get("team_name") || "General",
        }),
      });
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <AuthShell
      eyebrow="First run"
      title="Create an organization"
      description="Or ask an admin to invite this email to their team."
    >
      <form className="mt-6 grid gap-4" onSubmit={submit}>
        <Field label="Organization name" id="org_name" name="org_name" required autoFocus />
        <Field label="First team" id="team_name" name="team_name" defaultValue="General" />
        {error && <Alert>{error}</Alert>}
        <Button variant="primary" full type="submit">
          Create
        </Button>
      </form>
    </AuthShell>
  );
}

export function AuthApp() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [needsOrg, setNeedsOrg] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = Boolean(session);
      setSignedIn(next);
      setReady(true);
      if (!next) {
        setNeedsOrg(false);
        setPending(false);
        return;
      }
      setPending(true);
      request("/v1/tree")
        .then(() => {
          setNeedsOrg(false);
          router.replace("/app");
        })
        .catch((cause) => {
          if (cause instanceof ApiError && cause.status === 404) {
            setNeedsOrg(true);
            return;
          }
          router.replace("/app");
        })
        .finally(() => setPending(false));
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  if (!ready || (signedIn && pending && !needsOrg)) {
    return <main className="min-h-screen bg-canvas" />;
  }
  if (!signedIn) return <Login />;
  if (needsOrg) return <Onboarding onCreated={() => router.replace("/app")} />;
  return <main className="min-h-screen bg-canvas" />;
}
