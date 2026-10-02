"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { narrowPreview } from "@/lib/views/groups";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { Button } from "../../../ui/button";
import { Checkbox } from "../../../ui/checkbox";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";

export interface NarrowProps {
  /** The grants this team already holds; a narrow may only take away. */
  grants: Array<{ id: string; group: string; aliases: string[] }>;
  subTeams: Array<{ path: string; name: string }>;
}

/**
 * **Narrow to a sub-team** — 04 §8. Pick a sub-team, untick entries, read the
 * one-sentence preview, *Create the grant* → `POST /v1/grants`. There is
 * nothing here that adds an entry: a narrowed grant only takes away (PRD §6.4),
 * and the modal says so rather than leaving it to be discovered.
 */
export function Narrow({ grants, subTeams }: NarrowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [grantId, setGrantId] = useState(grants[0]?.id ?? "");
  const [team, setTeam] = useState(subTeams[0]?.path ?? "");
  const [dropped, setDropped] = useState<string[]>([]);

  const grant = grants.find((item) => item.id === grantId) ?? grants[0];
  const kept = (grant?.aliases ?? []).filter((alias) => !dropped.includes(alias));
  const teamName = subTeams.find((item) => item.path === team)?.name ?? team;

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      await request("/v1/grants", await getToken(), {
        method: "POST",
        body: JSON.stringify({
          group: grant?.group,
          scope: { teams: [team] },
          narrowedFrom: { grant: grantId },
          aliases: kept,
        }),
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        explain={GROUPS.verbs.narrowToSubTeam.explain}
        onClick={() => setOpen(true)}
      >
        {GROUPS.verbs.narrowToSubTeam.label}
      </Button>
      {open && (
        <Modal title={GROUPS_TEXT.narrowTitle} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Select
              label={GROUPS.columns.group.heading}
              value={grantId}
              onChange={(event) => {
                setGrantId(event.target.value);
                setDropped([]);
              }}
            >
              {grants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.group}
                </option>
              ))}
            </Select>
            <Select
              label={GROUPS_TEXT.narrowTeamLabel}
              value={team}
              onChange={(event) => setTeam(event.target.value)}
            >
              {subTeams.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.name}
                </option>
              ))}
            </Select>
            <fieldset className="grid gap-2">
              <legend className="text-xs font-bold tracking-label text-muted uppercase">
                {GROUPS_TEXT.narrowEntriesLabel}
              </legend>
              {(grant?.aliases ?? []).map((alias) => (
                <Checkbox
                  key={alias}
                  label={alias}
                  checked={!dropped.includes(alias)}
                  onChange={(event) =>
                    setDropped((was) =>
                      event.target.checked ? was.filter((item) => item !== alias) : [...was, alias],
                    )
                  }
                />
              ))}
            </fieldset>
            <Notice tone="accent">{narrowPreview(teamName, kept, dropped)}</Notice>
            <p className="text-base text-muted">{GROUPS_TEXT.narrowCannotAdd}</p>
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{GROUPS_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void submit()}>
                {GROUPS_TEXT.narrowSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
