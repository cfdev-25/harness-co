"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { createAccessToken, setupTokenName } from "@/lib/pat";
import { getToken } from "@/lib/token.client";
import { setupCommands } from "@/lib/views/account";
import { HOW, HOW_SETUP, HOW_TEXT } from "@/content/screens/how";
import { Button } from "../../ui/button";
import { CommandBlock } from "../../ui/command-block";
import { Notice } from "../../ui/notice";
import { SectionLabel } from "../../ui/section-label";

/**
 * *Set up* — console D105, 04 §16.1. The first thing on *How this works*, and
 * the only dynamic thing on it: three commands a person pastes in order, each
 * with a copy button, and a token for the middle one.
 *
 * `apiOrigin` is `HARNESS_API_ORIGIN`, read on the server by `page.tsx` and
 * handed down — the browser has only the `/v1` rewrite and cannot know the
 * address the CLI should dial (02 D23). A deployed console must set it to the
 * public API URL, or the line prints a placeholder instead of a wrong host.
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
export function SetUp({ apiOrigin }: { apiOrigin: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const steps = setupCommands(apiOrigin, token);

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
    <section id="setup" data-setup className="grid gap-4 px-6 pt-6 pb-8">
      <SectionLabel>{HOW_SETUP.title}</SectionLabel>
      <ol className="grid gap-4">
        {steps.map((step, index) => (
          <li key={step.key} data-setup-step={step.key} className="grid gap-2">
            <CommandBlock
              label={`${index + 1}. ${HOW_SETUP.steps[step.key]}`}
              command={step.command}
              copyLabel={HOW_TEXT.copy}
              copiedLabel={HOW_TEXT.copied}
            />
            {step.key === "login" &&
              (token === null ? (
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
              ))}
          </li>
        ))}
      </ol>
      {failure && <Notice tone="warn">{failure}</Notice>}
      <p className="text-base text-muted">{HOW_SETUP.then}</p>
    </section>
  );
}
