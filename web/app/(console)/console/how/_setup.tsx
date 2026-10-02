"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { createAccessToken, setupTokenName } from "@/lib/pat";
import { scopeHref } from "@/lib/scope";
import { getToken } from "@/lib/token.client";
import { setupCommands } from "@/lib/views/account";
import { type OsId, DEFAULT_OS, OS_IDS, detectOs } from "@/lib/views/how";
import { HOW, HOW_SETUP, HOW_TEXT } from "@/content/screens/how";
import { Button } from "../../ui/button";
import { CommandBlock } from "../../ui/command-block";
import { Notice } from "../../ui/notice";
import { Segmented } from "../../ui/segmented";

/**
 * *How this works* → *Set up* — console D105, 04 §16.1. The first tab of the
 * page and the only dynamic thing on it: five numbered cards, each a title,
 * one sentence and either a line to copy or something to do by hand.
 *
 * Step 1 is a card and not a command because a web page cannot open a
 * terminal; it prints the keystroke for the machine it guesses it is on and
 * lets the person say otherwise. The guess is read through
 * `useSyncExternalStore`, so the server renders the default and React swaps
 * the real answer in at hydration instead of the two disagreeing.
 *
 * `apiOrigin` is `HARNESS_API_ORIGIN`, read on the server by `page.tsx` and
 * handed down — the browser has only the `/v1` rewrite and cannot know the
 * address the CLI should dial (02 D23). A deployed console must set it to the
 * public API URL, or the line prints a placeholder instead of a wrong host.
 * `installOrigin` is the console's own origin, which the server reads off the
 * request (`lib/origin.server.ts`): the install script is served from here.
 *
 * The token is **shown, not stored** (P2): nothing here reaches
 * `localStorage`, there is no `router.refresh()` — it would take the value
 * away — and the raw value is in the create response and nowhere else, so the
 * section says so. Leaving the page is losing it, which is why the sentence
 * says to generate another rather than where to find it again.
 *
 * Every viewer gets this, personal and enterprise alike: a team member
 * installs the CLI the same way an owner does.
 */
export function SetUp({
  apiOrigin,
  installOrigin,
}: {
  apiOrigin: string | null;
  installOrigin: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The machine is the browser's to say, not the server's: read through
  // `useSyncExternalStore` so the server renders the default and React swaps
  // in the real answer at hydration, rather than the two disagreeing. A
  // choice, once made, outranks the guess.
  const guessed = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [chosen, setChosen] = useState<OsId | null>(null);
  const os = chosen ?? guessed;
  const commands = setupCommands(apiOrigin, installOrigin, token);
  const block = (key: "install" | "login" | "register") => (
    <CommandBlock
      label={HOW_SETUP.steps[key].title}
      command={commands.find((command) => command.key === key)?.command ?? ""}
      copyLabel={HOW_TEXT.copy}
      copiedLabel={HOW_TEXT.copied}
    />
  );

  async function generate() {
    setBusy(true);
    setFailure(null);
    try {
      const created = await createAccessToken(await getToken(), setupTokenName(new Date()));
      setToken(created.token);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-setup className="grid max-w-3xl gap-4 px-6 pt-6 pb-12">
      <p className="text-base text-muted">{HOW_SETUP.lede}</p>
      <ol className="grid gap-4">
        <Step n={1} step="terminal">
          <Segmented
            label={HOW_SETUP.os.label}
            options={OS_IDS.map((id) => ({ id, label: HOW_SETUP.os.options[id] }))}
            value={os}
            onChange={(id) => setChosen(id as OsId)}
          />
          <p data-os-keys className="font-mono text-xs text-fg">{HOW_SETUP.os.keys[os]}</p>
        </Step>

        <Step n={2} step="install">{block("install")}</Step>

        <Step n={3} step="login">
          {block("login")}
          {token === null ? (
            <Button
              variant="primary"
              busy={busy}
              explain={HOW.verbs.generateToken.explain}
              onClick={() => void generate()}
            >
              {HOW.verbs.generateToken.label}
            </Button>
          ) : (
            <Notice tone="hold">{HOW_SETUP.tokenOnce}</Notice>
          )}
          {failure && <Notice tone="warn">{failure}</Notice>}
        </Step>

        <Step n={4} step="register">{block("register")}</Step>

        <Step n={5} step="then" />
      </ol>
    </section>
  );
}

/** Nothing to subscribe to: the user agent does not change under the page. */
const subscribe = () => () => {};
const snapshot = () => detectOs(navigator.userAgent, navigator.platform);
const serverSnapshot = () => DEFAULT_OS;

/** One card of the list: its number, its title, its one sentence, and
 *  whatever the step itself is — a block to copy, or something to do. */
function Step({ n, step, children }: { n: number; step: StepKey; children?: ReactNode }) {
  const words = HOW_SETUP.steps[step];
  return (
    <li
      data-setup-step={step}
      className="grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-card"
    >
      <div className="grid gap-1">
        <p className="text-base font-semibold">
          <span className="pr-2 font-mono text-xs text-faint">{n}</span>
          {words.title}
        </p>
        <p className="text-base text-muted">{sentence(words.sentence)}</p>
      </div>
      {children}
    </li>
  );
}

type StepKey = keyof typeof HOW_SETUP.steps;

/** `{link}` in a content sentence is the one link the sentence carries; the
 *  sentence stays whole in `content/` (05 R1) and the screen decides the
 *  type, exactly as `{command}` does on the Account page. */
function sentence(text: string): ReactNode {
  const [before, after] = text.split("{link}");
  if (after === undefined) return text;
  return (
    <>
      {before}
      <Link className="underline" href={scopeHref({ kind: "me" }, "/harnesses")}>
        {HOW_SETUP.thenLink}
      </Link>
      {after}
    </>
  );
}
