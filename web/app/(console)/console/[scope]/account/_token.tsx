"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { createAccessToken } from "@/lib/pat";
import { getToken } from "@/lib/token.client";
import { loginCommand } from "@/lib/views/people";
import { ACCOUNT, ACCOUNT_TEXT } from "@/content/screens/account";
import { UI } from "@/content/ui";
import { Button } from "../../../ui/button";
import { CommandBlock } from "../../../ui/command-block";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";

/**
 * Engine 08 §11.14: `harness login` pastes a token, and this is where one is
 * minted — `POST /v1/personal-access-tokens`, whose response carries the raw
 * value once and never again. It is shown, not stored (P2): nothing here
 * reaches `localStorage`, and `router.refresh()` would only take it away, so
 * the card holds it until the person leaves the screen. The console cannot
 * know the address the CLI should use — `HARNESS_API_ORIGIN` is server-only
 * and the browser has only the `/v1` rewrite (02 D23) — so the next command
 * is the sheet's bare `harness login`, which asks for the rest.
 */
export function CreateToken() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const created = await createAccessToken(await getToken(), name);
      setToken(created.token);
      setOpen(false);
      setName("");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-base text-muted">{ACCOUNT.verbs.createToken.explain}</p>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {ACCOUNT.verbs.createToken.label}
      </Button>
      {token && (
        <div data-token className="grid w-full gap-2">
          <CommandBlock
            label={ACCOUNT_TEXT.tokenLabel}
            command={token}
            copyLabel={UI.copy.copy}
            copiedLabel={UI.copy.copied}
          />
          <Notice tone="hold">{ACCOUNT_TEXT.tokenOnce}</Notice>
          <CommandBlock
            label={ACCOUNT_TEXT.tokenNext}
            command={loginCommand()}
            copyLabel={UI.copy.copy}
            copiedLabel={UI.copy.copied}
          />
        </div>
      )}
      {open && (
        <Modal title={ACCOUNT.verbs.createToken.label} onClose={() => setOpen(false)}>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <Field
              label={ACCOUNT_TEXT.tokenName}
              name="name"
              hint={ACCOUNT_TEXT.tokenNameHint}
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{ACCOUNT_TEXT.cancel}</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {ACCOUNT_TEXT.tokenSubmit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
