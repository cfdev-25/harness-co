"use client";

import { useState, type FormEvent } from "react";
import { createBrowserClient } from "@supabase/ssr";

const FIELD =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[14px] text-fg outline-none transition placeholder:text-faint focus:border-accent";
const LABEL = "text-[11px] font-bold tracking-[0.13em] text-muted uppercase";

export function RequestForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");

    // A bot that fills the hidden field gets the same answer as everyone else.
    if (String(form.get("company_website") ?? "")) {
      setState("sent");
      return;
    }

    /* Straight to Postgres through a definer function: the public site needs
       no API of its own, and `anon` can write a request without being able to
       read one back. */
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error: cause } = await supabase.rpc("request_access", {
      p_email: String(form.get("email") ?? ""),
      p_name: form.get("name") || null,
      p_company: form.get("company") || null,
      p_team_size: form.get("team_size") || null,
      p_note: form.get("note") || null,
    });

    if (cause) {
      setState("idle");
      setError(
        cause.message.includes("invalid_email")
          ? "Please enter a valid email address."
          : "Something went wrong. Please try again.",
      );
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="rounded-2xl border border-accent bg-accent-soft/40 p-8">
        <h2 className="font-serif text-2xl tracking-[-0.02em]">Thank you — we have your request.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          We read every one. If Harness Manager is a fit for your team, we&apos;ll email you an
          invitation from this address.
        </p>
      </div>
    );
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={LABEL}>Work email</span>
          <input name="email" type="email" required autoComplete="email" className={FIELD} />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL}>Your name</span>
          <input name="name" autoComplete="name" className={FIELD} />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL}>Company</span>
          <input name="company" autoComplete="organization" className={FIELD} />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL}>People who would use it</span>
          <select name="team_size" defaultValue="" className={FIELD}>
            <option value="">Select…</option>
            <option value="just-me">Just me</option>
            <option value="2-10">2 – 10</option>
            <option value="11-50">11 – 50</option>
            <option value="51-200">51 – 200</option>
            <option value="200+">200+</option>
          </select>
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className={LABEL}>What are you hoping to run? (optional)</span>
        <textarea name="note" rows={4} className={`${FIELD} resize-y`} />
      </label>

      {/* Not shown to people, not filled by browsers. Anything here is a bot. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Company website
          <input name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-fg">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={state === "sending"}
          className="inline-flex items-center justify-center rounded-full bg-ink px-6 py-3 text-[13px] font-semibold text-ink-text transition hover:bg-ink-raised disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Request an account"}
        </button>
        <p className="text-[12px] text-faint">
          We use this only to reply to you. See our <a href="/privacy" className="text-accent underline underline-offset-2">Privacy Policy</a>.
        </p>
      </div>
    </form>
  );
}
