"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import { PEOPLE, PEOPLE_TEXT } from "@/content/screens/people";
import { Button } from "../../../ui/button";
import { Checkbox } from "../../../ui/checkbox";
import { Confirm } from "../../../ui/confirm";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";

export interface PeopleVerbsProps {
  /** The team an invitation or a sub-team is created under, as its dotted
   *  path — `POST /v1/invites` and `POST /v1/org-units` both resolve an id
   *  *or* a path, which is what every `/v1/console/*` payload carries. */
  team: string;
  members: Array<{ id: string; name: string }>;
  /** The teams an invitation may name. At the organization scope `team` is
   *  the org path and the route refuses `invite_target_not_team`, so the
   *  page hands down the teams to choose from; at a team scope it is empty
   *  and `team` is that path. */
  teams: Array<{ path: string; name: string }>;
}

/**
 * Invite and **New sub-team** — 04 §15. The sub-team dialog is *name*, *who*
 * and the notice that it starts empty and inherits, and that keeping
 * something out of it means placing that thing somewhere else (PRD §5.4).
 */
export function PeopleVerbs({ team, members, teams }: PeopleVerbsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<"none" | "invite" | "subteam">("none");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [into, setInto] = useState(teams[0]?.path ?? team);
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);

  async function call(path: `/v1/${string}`, body: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      await request(path, await getToken(), { method: "POST", body: JSON.stringify(body) });
      setOpen("none");
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button explain={PEOPLE.verbs.newSubTeam.explain} onClick={() => setOpen("subteam")}>
        {PEOPLE.verbs.newSubTeam.label}
      </Button>
      <Button variant="primary" explain={PEOPLE.verbs.invite.explain} onClick={() => setOpen("invite")}>
        {PEOPLE.verbs.invite.label}
      </Button>
      {open === "invite" && (
        <Modal title={PEOPLE_TEXT.inviteTitle} onClose={() => setOpen("none")}>
          <div className="grid gap-4">
            {teams.length > 0 && (
              <Select
                label={PEOPLE_TEXT.inviteTeam}
                hint={PEOPLE_TEXT.inviteTeamHint}
                value={into}
                onChange={(event) => setInto(event.target.value)}
              >
                {teams.map((node) => (
                  <option key={node.path} value={node.path}>
                    {node.name}
                  </option>
                ))}
              </Select>
            )}
            <Field
              label={PEOPLE_TEXT.inviteEmail}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen("none")}>{PEOPLE_TEXT.cancel}</Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void call("/v1/invites", { team: teams.length > 0 ? into : team, email })}
              >
                {PEOPLE_TEXT.inviteSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {open === "subteam" && (
        <Modal title={PEOPLE_TEXT.subTeamTitle} onClose={() => setOpen("none")}>
          <div className="grid gap-4">
            <Field
              label={PEOPLE_TEXT.subTeamName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <fieldset className="grid gap-2">
              <legend className="text-xs font-bold tracking-label text-muted uppercase">
                {PEOPLE_TEXT.subTeamWho}
              </legend>
              <p className="text-xs text-faint">{PEOPLE_TEXT.subTeamWhoHint}</p>
              {members.map((member) => (
                <Checkbox
                  key={member.id}
                  label={member.name}
                  checked={chosen.includes(member.id)}
                  onChange={(event) =>
                    setChosen((was) =>
                      event.target.checked ? [...was, member.id] : was.filter((id) => id !== member.id),
                    )
                  }
                />
              ))}
            </fieldset>
            <Notice tone="hold">{PEOPLE_TEXT.subTeamNotice}</Notice>
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen("none")}>{PEOPLE_TEXT.cancel}</Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() =>
                  // 00 §4.11's form. `TeamIn.members` takes the emails of people to
                  // invite, and the tick boxes hold the ids of people already
                  // on the team, so the chosen are reported, not sent.
                  void call("/v1/org-units", { kind: "team", parent: team, name })
                }
              >
                {PEOPLE_TEXT.subTeamSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export interface CancelInviteProps {
  /** `org_invites.id` — the only handle an invited row has; it names no
   *  person yet (03 §4.8). */
  invite: string;
  email: string;
}

/** `DELETE /v1/invites/{id}` (04 §15) — the row verb on an invited person. */
export function CancelInvite({ invite, email }: CancelInviteProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/invites/${invite}`, await getToken(), { method: "DELETE" });
      setConfirming(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    // `Table` lays the row's link over the whole row; a positioned element
    // later in the DOM takes the click back.
    <div className="relative">
      <Button
        size="sm"
        variant="danger"
        explain={PEOPLE.verbs.cancelInvite.explain}
        onClick={() => setConfirming(true)}
      >
        {PEOPLE.verbs.cancelInvite.label}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming && (
        <Confirm
          title={fill(PEOPLE_TEXT.cancelInviteTitle, { email })}
          takes={<p>{fill(PEOPLE_TEXT.cancelInviteTakes, { email })}</p>}
          verb={PEOPLE.verbs.cancelInvite.label}
          cancel={PEOPLE_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void cancel()}
        />
      )}
    </div>
  );
}
