"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { browserClient } from "@/lib/supabase.client";
import { getToken } from "@/lib/token.client";
import { AFTER_SIGN_IN, AuthShell } from "../auth";
import { Alert, Button, Field } from "../ui";
import { SIGNUP } from "./words";

type Edition = "team" | "personal";
/** Which step is open. Steps behind it collapse to their answer. */
type Step = 1 | 2 | 3;

/**
 * Step 1's answer, under one key, because step 3 runs in whatever tab the
 * person clicked the link in and the server holds nothing to ask: the
 * account the link made has no organisation yet, and which kind it will be
 * is the one fact that has to survive the round trip. `localStorage`, not a
 * cookie — nothing on the server reads it — and its absence is a state the
 * page handles rather than an error (step 3 asks again).
 */
const CHOICE = "harness.signup";

interface Choice {
  edition: Edition;
  orgName: string;
}

function remember(choice: Choice) {
  try {
    localStorage.setItem(CHOICE, JSON.stringify(choice));
  } catch {
    // Storage turned off or full. Nothing to do: step 3 asks again.
  }
}

function recall(): Choice | null {
  try {
    const held = localStorage.getItem(CHOICE);
    if (!held) return null;
    const parsed = JSON.parse(held) as { edition?: unknown; orgName?: unknown };
    if (parsed.edition !== "team" && parsed.edition !== "personal") return null;
    return {
      edition: parsed.edition,
      orgName: typeof parsed.orgName === "string" ? parsed.orgName : "",
    };
  } catch {
    // Unreadable or not ours. Treated as nothing remembered.
    return null;
  }
}

function StepHead({ n, open, onChange }: { n: Step; open: boolean; onChange?: () => void }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
          open ? "bg-accent text-ink" : "bg-overlay text-muted"
        }`}
      >
        {n}
      </span>
      <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{SIGNUP.steps[n - 1]}</h2>
      {!open && onChange && (
        <Button size="sm" variant="bare" className="ml-auto text-[12px] text-accent" onClick={onChange}>
          {SIGNUP.change}
        </Button>
      )}
    </div>
  );
}

function EditionCard({
  edition,
  chosen,
  onPick,
}: {
  edition: Edition;
  chosen: boolean;
  onPick: () => void;
}) {
  const words = SIGNUP[edition];
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onPick}
      className={`cursor-pointer rounded-lg border px-4 py-3.5 text-left transition ${
        chosen ? "border-accent bg-accent-soft/40" : "border-line bg-surface hover:border-accent"
      }`}
    >
      <span className="block text-[14px] font-semibold">{words.label}</span>
      <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{words.sentence}</span>
    </button>
  );
}

/** The two cards, in step 1 and again in step 3 when nothing was remembered. */
function Choose({ chosen, onPick }: { chosen: Edition | null; onPick: (edition: Edition) => void }) {
  return (
    <div className="grid gap-2.5">
      {(["team", "personal"] as const).map((edition) => (
        <EditionCard
          key={edition}
          edition={edition}
          chosen={chosen === edition}
          onPick={() => onPick(edition)}
        />
      ))}
    </div>
  );
}

/**
 * W7-D1, D101a: Team or Personal, your email, then the link. Submitting the
 * email asks the auth provider to mail a sign-in link back to
 * `/signup?finish=1`, so **the link is the confirmation** — email
 * confirmation stays on and nothing here asks the person to go and sign in
 * somewhere else. The link's landing is step 3: the password and the access
 * code on one form.
 *
 * The code is **not** checked here; it travels with `POST /v1/orgs`, the one
 * route that creates the organisation, and a wrong one comes back as
 * `signup.code_wrong` with the server's own words beside the field that
 * caused it.
 *
 * `signedIn` is the session the server component already read, so a person
 * sent here by `AuthApp` (signed in, no organisation) opens at step 3
 * without a flash of step 1. The client's own `getSession` is what decides,
 * though — see the effect.
 */
/** Polls the viewer until the new organisation's index answers (a few seconds at most). */
async function workspaceReady(token: string | null): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await request("/v1/console/me?scope=me", token);
      return;
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export function SignUp({
  signedIn = false,
  finish = false,
}: {
  signedIn?: boolean;
  finish?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(signedIn ? 3 : 1);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [error, setError] = useState("");
  const [dead, setDead] = useState(false);
  const [busy, setBusy] = useState(false);

  // The one thing that decides whether this is step 3: a session. Building
  // the browser client is also what reads the link's token out of the URL
  // (`detectSessionInUrl`), and `getSession` waits for that, so this effect
  // is the landing as well as the question. A session means the address is
  // confirmed and the account exists — from the link, or from signing in and
  // being sent here — and the only things left are the password and the code.
  useEffect(() => {
    let live = true;
    void browserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!live) return;
        if (!data.session) {
          setStep(1);
          // `?finish=1` and no session: the link is the only thing that could
          // have made one, so it did not work. Said once, not guessed at.
          if (finish) setDead(true);
          return;
        }
        // Someone who already has an organisation has nothing to finish: the
        // console is where they belong, not this form (a member here is the
        // console bouncing back a second too early, or a bookmark).
        void getToken()
          .then((token) => request("/v1/console/me?scope=me", token))
          .then(() => {
            if (!live) return;
            router.refresh();
            router.replace(AFTER_SIGN_IN);
          })
          .catch(() => {
            if (!live) return;
            const held = recall();
            if (held) {
              setEdition(held.edition);
              setOrgName(held.orgName);
            }
            setStep(3);
          });
      });
    return () => {
      live = false;
    };
  }, [finish, router]);

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    if (!edition) return;
    setBusy(true);
    setError("");
    // Remembered before the call, not after: the link may be opened in
    // another tab minutes later, and this is the only copy of the answer.
    remember({ edition, orgName });
    const { error: cause } = await browserClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/signup?finish=1`,
      },
    });
    setBusy(false);
    if (cause) {
      setError(cause.message);
      return;
    }
    setSent(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!edition) return;
    setBusy(true);
    setError("");
    setCodeError("");
    try {
      if (!passwordSet) {
        const { error: cause } = await browserClient().auth.updateUser({ password });
        // `same_password` is not a failure here: a wrong code brings the
        // person back to this form with the password already set, and so
        // would a second visit to `/signup` by someone who finished. The
        // password is theirs either way; the organisation is the thing this
        // form is still trying to make.
        if (cause && cause.code !== "same_password") {
          setError(cause.message);
          return;
        }
        setPasswordSet(true);
      }
      try {
        await request("/v1/orgs", await getToken(), {
          method: "POST",
          body: JSON.stringify(
            edition === "personal" ? { code, personal: true } : { code, org_name: orgName },
          ),
        });
      } catch (cause) {
        // A member who found their way back here is already done.
        if (!(cause instanceof ApiError && cause.code === "already_member")) throw cause;
      }
      // The organisation is written to git first and indexed a moment later;
      // the console reads the index. Leaving before it answers lands on the
      // console's "no workspace" branch, which sends the person straight back
      // here. So: wait for the index, then go.
      await workspaceReady(await getToken());
      router.refresh();
      router.replace(AFTER_SIGN_IN);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "signup.code_wrong") {
        // In place: the field that was wrong is still open, with the server's
        // own words under it, and the password is not asked for twice.
        setCodeError(cause.message);
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={SIGNUP.title} description={SIGNUP.description}>
      <div className="mt-6 grid gap-5">
        {dead && <Alert>{SIGNUP.linkDead}</Alert>}

        {step < 3 && (
          <section className="grid gap-3">
            <StepHead n={1} open={step === 1} onChange={sent ? undefined : () => setStep(1)} />
            {step === 1 ? (
              <form
                className="grid gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setStep(2);
                }}
              >
                <Choose chosen={edition} onPick={setEdition} />
                {edition === "team" && (
                  <Field
                    label={SIGNUP.orgName}
                    id="org_name"
                    value={orgName}
                    onChange={(event) => setOrgName(event.target.value)}
                    required
                    autoFocus
                  />
                )}
                <Button variant="primary" full type="submit" disabled={!edition}>
                  {SIGNUP.next}
                </Button>
              </form>
            ) : (
              <p className="pl-[30px] text-[13px] text-muted">
                {edition && SIGNUP[edition].label}
                {edition === "team" && orgName && ` · ${orgName}`}
              </p>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-3 border-t border-line pt-5">
            <StepHead n={2} open />
            {sent ? (
              <p className="text-[13px] leading-relaxed text-muted">{SIGNUP.sent}</p>
            ) : (
              <form className="grid gap-3" onSubmit={sendLink}>
                <Field
                  label={SIGNUP.email}
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
                {error && <Alert>{error}</Alert>}
                <Button variant="primary" full type="submit" disabled={busy}>
                  {busy ? "Working…" : SIGNUP.sendLink}
                </Button>
              </form>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="grid gap-3">
            <StepHead n={3} open />
            <form className="grid gap-3" onSubmit={create}>
              {edition ? (
                <p className="text-[13px] text-muted">
                  {SIGNUP[edition].label}
                  <Button
                    size="sm"
                    variant="bare"
                    className="ml-1.5 text-[12px] text-accent"
                    onClick={() => setEdition(null)}
                  >
                    {SIGNUP.change}
                  </Button>
                </p>
              ) : (
                // Another browser, cleared storage, or a sign-in that came
                // back here: nothing was remembered, so ask the one question
                // again rather than guess at an organisation's shape.
                <>
                  <p className="text-[13px] text-muted">{SIGNUP.choose}</p>
                  <Choose chosen={edition} onPick={setEdition} />
                </>
              )}
              {edition === "team" && (
                <Field
                  label={SIGNUP.orgName}
                  id="org_name"
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  required
                />
              )}
              {!passwordSet && (
                <div className="grid gap-1.5">
                  <Field
                    label={SIGNUP.password}
                    id="password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <Button
                    size="sm"
                    variant="bare"
                    className="justify-self-start px-0 text-[12px] text-accent"
                    onClick={() => setShow(!show)}
                  >
                    {show ? SIGNUP.hide : SIGNUP.show}
                  </Button>
                </div>
              )}
              <Field
                label={SIGNUP.code}
                id="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
              {codeError && <Alert>{codeError}</Alert>}
              {error && <Alert>{error}</Alert>}
              <Button variant="primary" full type="submit" disabled={busy || !edition}>
                {busy ? "Working…" : SIGNUP.finish}
              </Button>
            </form>
          </section>
        )}
      </div>
      <p className="mt-6 text-[12.5px] text-muted">
        {SIGNUP.haveAccount}{" "}
        <Link href="/login" className="text-accent underline underline-offset-2">
          {SIGNUP.signIn}
        </Link>
      </p>
    </AuthShell>
  );
}
