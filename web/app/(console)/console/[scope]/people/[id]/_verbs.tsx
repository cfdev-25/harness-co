"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import { PEOPLE, PEOPLE_TEXT } from "@/content/screens/people";
import { Button } from "../../../../ui/button";
import { Checkbox } from "../../../../ui/checkbox";
import { Confirm } from "../../../../ui/confirm";
import { Notice } from "../../../../ui/notice";

export interface PersonVerbsProps {
  personId: string;
  name: string;
  /** The person's direct team — `PersonRow.team`, the parent of their own
   *  node, which is the one the members and admins routes key on. */
  teamPath: string;
  /** The person's own org unit — `PersonRow.unit`. Visibility is set on a
   *  node, and a person's node is theirs, never their auth id. */
  unitPath: string;
  /** Whether they already administer `teamPath` — the verb is Appoint or
   *  Revoke, never both, and never one that would change nothing (P6). */
  admin: boolean;
  orgAdmin: boolean;
  /** W5-D15 adds `store`, the Assets screen's *Browse* tab. Optional on
   *  the wire for one release: a response written before it existed is
   *  read as on, which is the default the server applies too. */
  visibility: { boundaries: boolean; logs: boolean; store?: boolean };
  /** `RemovalPreview` from the server: the confirmation *is* the preview. */
  preview: { loses: Array<{ group: string; via: string }>; rotate: Array<{ ref: string; group: string }> };
}

/**
 * Remove, deactivate and the visibility switch — 04 §15. Removing shows the
 * `RemovalPreview` before the button, never a generic *Are you sure?* (§18),
 * and the visibility switch is an organization admin's alone.
 */
export function PersonVerbs(props: PersonVerbsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"none" | "remove" | "deactivate" | "revokeAdmin">("none");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function call(path: `/v1/${string}`, method: string, body?: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      await request(path, await getToken(), {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      setConfirming("none");
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" explain={PEOPLE.verbs.remove.explain} onClick={() => setConfirming("remove")}>
          {PEOPLE_TEXT.removeVerb}
        </Button>
        {props.orgAdmin && (
          <Button
            variant="danger"
            explain={PEOPLE.verbs.deactivate.explain}
            onClick={() => setConfirming("deactivate")}
          >
            {PEOPLE_TEXT.deactivateVerb}
          </Button>
        )}
        {props.orgAdmin &&
          (props.admin ? (
            <Button
              variant="danger"
              explain={PEOPLE.verbs.revokeAdmin.explain}
              onClick={() => setConfirming("revokeAdmin")}
            >
              {PEOPLE.verbs.revokeAdmin.label}
            </Button>
          ) : (
            <Button
              explain={PEOPLE.verbs.appointAdmin.explain}
              busy={busy}
              onClick={() =>
                void call(`/v1/org-units/${props.teamPath}/admins/${props.personId}`, "PUT", {
                  level: "admin",
                })
              }
            >
              {PEOPLE.verbs.appointAdmin.label}
            </Button>
          ))}
      </div>
      {props.orgAdmin && (
        <fieldset className="grid gap-2">
          <legend className="text-xs font-bold tracking-label text-muted uppercase">
            {PEOPLE_TEXT.visibilityTitle}
          </legend>
          <Checkbox
            label={PEOPLE_TEXT.visibilityBoundaries}
            checked={props.visibility.boundaries}
            onChange={(event) =>
              void call(`/v1/org-units/${props.unitPath}/visibility`, "PATCH", {
                boundaries: event.target.checked,
                logs: props.visibility.logs,
              })
            }
          />
          <Checkbox
            label={PEOPLE_TEXT.visibilityLogs}
            checked={props.visibility.logs}
            onChange={(event) =>
              void call(`/v1/org-units/${props.unitPath}/visibility`, "PATCH", {
                boundaries: props.visibility.boundaries,
                logs: event.target.checked,
              })
            }
          />
          {/* W5-D15: the store. Off hides the Assets screen's *Browse* tab;
              what the person already holds is untouched. */}
          <Checkbox
            label={PEOPLE_TEXT.visibilityStore}
            checked={props.visibility.store !== false}
            onChange={(event) =>
              void call(`/v1/org-units/${props.unitPath}/visibility`, "PATCH", {
                store: event.target.checked,
              })
            }
          />
          <p className="text-xs text-faint">{PEOPLE_TEXT.visibilityNote}</p>
        </fieldset>
      )}
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming === "remove" && (
        <Confirm
          title={fill(PEOPLE_TEXT.removeTitle, { name: props.name })}
          takes={<RemovalTakes preview={props.preview} />}
          verb={PEOPLE_TEXT.removeVerb}
          cancel={PEOPLE_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming("none")}
          onConfirm={() =>
            void call(`/v1/org-units/${props.teamPath}/members/${props.personId}`, "DELETE")
          }
        />
      )}
      {confirming === "revokeAdmin" && (
        <Confirm
          title={fill(PEOPLE_TEXT.revokeAdminTitle, { name: props.name })}
          takes={<p>{PEOPLE_TEXT.revokeAdminTakes}</p>}
          verb={PEOPLE.verbs.revokeAdmin.label}
          cancel={PEOPLE_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming("none")}
          onConfirm={() =>
            void call(`/v1/org-units/${props.teamPath}/admins/${props.personId}`, "DELETE")
          }
        />
      )}
      {confirming === "deactivate" && (
        <Confirm
          title={fill(PEOPLE_TEXT.deactivateTitle, { name: props.name })}
          takes={<p>{PEOPLE_TEXT.deactivateTakes}</p>}
          verb={PEOPLE_TEXT.deactivateVerb}
          cancel={PEOPLE_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming("none")}
          onConfirm={() =>
            void call(`/v1/people/${props.personId}`, "PATCH", { state: "deactivated" })
          }
        />
      )}
    </div>
  );
}

function RemovalTakes({ preview }: { preview: PersonVerbsProps["preview"] }) {
  if (preview.loses.length === 0 && preview.rotate.length === 0) {
    return <p>{PEOPLE_TEXT.removeNothing}</p>;
  }
  return (
    <>
      {preview.loses.length > 0 && (
        <div data-removal-loses>
          <p>{PEOPLE_TEXT.removeLoses}</p>
          <ul className="list-disc pl-5">
            {preview.loses.map((item) => (
              <li key={item.via}>{item.group}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.rotate.length > 0 && (
        <div data-removal-rotate>
          <p>{PEOPLE_TEXT.removeRotate}</p>
          <ul className="list-disc pl-5">
            {preview.rotate.map((item) => (
              <li key={item.ref}>{item.ref}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
