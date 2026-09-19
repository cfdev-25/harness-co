"use client";

/* docs/scoping.md §5.2: a name that collides with an ancestor's is caught the
   moment it would be created — at push (`409 name_collision`) or at scope
   grant (`PUT .../scopes` refusing it). "Rename" needs nothing here: submit
   the create again under a different name. "Take theirs" needs nothing here
   either: disable this unit's own copy (asset-manage.tsx's Availability
   control) and the ancestor's resolves instead. What is new, and what this
   file is for, is the other two resolutions — confirming "keep mine" and
   merging by hand — because both need this unit's own history and the
   ancestor's side by side, which nothing else on the asset screen shows. */

import { useEffect, useState } from "react";
import { list } from "@/lib/api";
import { decodeText, diffLines, DiffRow } from "@/lib/diff";
import { Api, AssetFile, LineageRow } from "@/lib/types";
import { Button, Modal, Mono, Notice } from "./ui";

type Documents = Record<string, string>;

/** Base64 as the API expects it: UTF-8 bytes, not Latin-1. Mirrors
    lib/diff.ts's `decodeText` from the other direction. */
function encodeText(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

async function fetchDocuments(api: Api, assetId: string, versionId: string): Promise<Documents> {
  const path = `/v1/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/files`;
  const files = list<AssetFile>(await api<unknown>(path));
  return Object.fromEntries(files.map((file) => [file.path, decodeText(file.content_b64)]));
}

/** One file, read-only, shown against the common ancestor so a change on
    either side stands out the same way the document tab already marks one. */
function ReadPane({ title, text, base }: { title: string; text?: string; base: string }) {
  const rows: DiffRow[] = text === undefined ? [] : diffLines(base, text);
  return (
    <div className="grid min-h-0 gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.09em] text-muted uppercase">
        {title}
      </span>
      <div className="max-h-72 min-h-[9rem] overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
        {text === undefined ? (
          <span className="text-faint">nothing here</span>
        ) : rows.length ? (
          rows.map((row, index) => (
            <div
              key={index}
              className={row.kind === "add" ? "bg-ok-soft" : row.kind === "del" ? "bg-warn-soft" : ""}
            >
              {row.text || " "}
            </div>
          ))
        ) : (
          <span className="text-faint">empty file</span>
        )}
      </div>
    </div>
  );
}

export function AssetConflict({
  name,
  myAssetId,
  mine,
  theirs,
  api,
  onResolved,
  onClose,
  onError,
}: {
  name: string;
  /** The id this unit's own copy is pushed under — `mine.asset_id` is the
      same value, kept separate only so a caller cannot mix up the two rows. */
  myAssetId: string;
  mine: LineageRow;
  theirs: LineageRow;
  api: Api;
  onResolved: () => void;
  onClose: () => void;
  onError: (cause: unknown) => void;
}) {
  const [mineDocs, setMineDocs] = useState<Documents>();
  const [theirsDocs, setTheirsDocs] = useState<Documents>();
  const [baseDocs, setBaseDocs] = useState<Documents>({});
  const [draft, setDraft] = useState<Documents>();
  const [busy, setBusy] = useState(false);
  const alreadyChosen = mine.override_of === theirs.asset_id;
  /* The common ancestor is knowable only when this copy's own history says
     it forked from exactly this ancestor — two names that merely collided by
     accident share no such point, and the middle pane reads as empty rather
     than guessed. */
  const commonVersion =
    mine.promoted_from_asset_id === theirs.asset_id ? mine.promoted_from_version_id : null;

  useEffect(() => {
    let live = true;
    Promise.all([
      mine.version_id ? fetchDocuments(api, myAssetId, mine.version_id) : Promise.resolve({}),
      theirs.version_id
        ? fetchDocuments(api, theirs.asset_id, theirs.version_id)
        : Promise.resolve({}),
      commonVersion ? fetchDocuments(api, theirs.asset_id, commonVersion) : Promise.resolve({}),
    ])
      .then(([mineFiles, theirsFiles, baseFiles]) => {
        if (!live) return;
        setMineDocs(mineFiles);
        setTheirsDocs(theirsFiles);
        setBaseDocs(baseFiles);
        setDraft(mineFiles);
      })
      .catch((cause: unknown) => {
        if (live) onError(cause);
      });
    return () => {
      live = false;
    };
    // Runs once for the pair this dialog opened on; a later edit to `draft`
    // must not refetch and overwrite it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, myAssetId, theirs.asset_id, mine.version_id, theirs.version_id, commonVersion]);

  async function push(files: Documents, message: string) {
    setBusy(true);
    try {
      await api(`/v1/assets/${encodeURIComponent(myAssetId)}/versions`, {
        method: "POST",
        body: JSON.stringify({
          message,
          parent_version_id: mine.version_id,
          files: Object.entries(files).map(([path, text]) => ({
            path,
            content_b64: encodeText(text),
          })),
          override_of: theirs.version_id,
        }),
      });
      onResolved();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  const ready = mineDocs && theirsDocs && draft;
  const paths = ready
    ? [...new Set([...Object.keys(mineDocs), ...Object.keys(theirsDocs), ...Object.keys(baseDocs)])].sort()
    : [];

  return (
    <Modal title={`Resolve ${name}`} onClose={onClose}>
      <div className="grid gap-4 p-5">
        <Notice tone={alreadyChosen ? "ok" : "accent"}>
          {theirs.path} publishes its own {name}, and {mine.path}&apos;s no longer matches it.{" "}
          {alreadyChosen
            ? "This unit already chose to keep its own — merging in a change from theirs is still yours to do below."
            : "Keep this one as it stands, or bring across a change from theirs by editing the copy on the right and pushing it."}
        </Notice>
        {!ready ? (
          <Mono>loading…</Mono>
        ) : (
          <>
            {paths.map((path) => (
              <div key={path} className="grid gap-2 lg:grid-cols-3">
                <ReadPane title="Theirs" text={theirsDocs[path]} base={baseDocs[path] ?? ""} />
                <ReadPane
                  title="Common version"
                  text={baseDocs[path]}
                  base={baseDocs[path] ?? ""}
                />
                <div className="grid min-h-0 gap-1.5">
                  <span className="text-[11px] font-bold tracking-[0.09em] text-muted uppercase">
                    Mine — edit before pushing
                  </span>
                  <textarea
                    value={draft[path] ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...(current ?? {}), [path]: event.target.value }))
                    }
                    spellCheck={false}
                    className="max-h-72 min-h-[9rem] resize-y rounded-md border border-line bg-surface p-2 font-mono text-[11.5px] leading-relaxed outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20"
                  />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {!alreadyChosen && (
                <Button
                  disabled={busy}
                  onClick={() => void push(mineDocs, `Keep our own ${name}.`)}
                >
                  Keep mine
                </Button>
              )}
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void push(draft, `Merge ${name}.`)}
              >
                Push the merged version
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
