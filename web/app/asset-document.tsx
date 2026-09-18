"use client";

/* The document pane of the asset screen. It opens on the version that is live
   now; selecting an older one shows what has changed since, in place. */

import { useCallback, useEffect, useRef, useState } from "react";
import { list } from "@/lib/api";
import { decodeText, diffLines, DiffKind, DiffRow, toLines } from "@/lib/diff";
import { Api, Asset, AssetFile, Version } from "@/lib/types";
import {
  Badge,
  Button,
  Chip,
  dateTime,
  Disclosure,
  Dot,
  EmptyState,
  Json,
  Mono,
  shortId,
} from "./ui";

/** The files of one version, keyed by path. */
type Documents = Record<string, string>;

const ROW_TINT: Record<DiffKind, string> = {
  same: "",
  add: "bg-ok-soft",
  del: "bg-warn-soft",
};

const MARK: Record<DiffKind, string> = { same: " ", add: "+", del: "-" };

const MARK_TINT: Record<DiffKind, string> = {
  same: "text-faint",
  add: "text-ok",
  del: "text-warn",
};

function Gutter({ line }: { line?: number }) {
  return (
    <td className="w-px border-r border-hairline bg-sunken px-2 text-right align-top text-[11px] tabular-nums text-faint select-none">
      {line ?? ""}
    </td>
  );
}

function Lines({ rows, withBefore }: { rows: DiffRow[]; withBefore: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-[1.65]">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={ROW_TINT[row.kind]}>
              {withBefore && <Gutter line={row.before} />}
              <Gutter line={row.after} />
              <td className="w-full px-2 align-top whitespace-pre">
                <span className={MARK_TINT[row.kind]}>{MARK[row.kind]} </span>
                {row.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One file, either as it stands or as it changed since the older version. */
function FileBlock({
  path,
  before,
  after,
  comparing,
}: {
  path: string;
  before?: string;
  after?: string;
  comparing: boolean;
}) {
  const rows = comparing
    ? diffLines(before ?? "", after ?? "")
    : toLines(after ?? "").map((text, index) => ({
        kind: "same" as const,
        text,
        after: index + 1,
      }));
  const adds = rows.filter((row) => row.kind === "add").length;
  const dels = rows.filter((row) => row.kind === "del").length;

  return (
    <article className="overflow-hidden rounded-lg border border-line">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-sunken px-3 py-2">
        <Chip title={path}>{path}</Chip>
        <span className="ml-auto flex items-center gap-2.5">
          {comparing && before === undefined && <Badge tone="ok">added</Badge>}
          {comparing && after === undefined && <Badge tone="warn">removed</Badge>}
          {comparing && adds + dels === 0 && <Badge tone="neutral">unchanged</Badge>}
          {comparing && adds + dels > 0 && (
            <span className="font-mono text-[11px]">
              <span className="text-ok">+{adds}</span> <span className="text-warn">-{dels}</span>
            </span>
          )}
          <Mono>{rows.length === 1 ? "1 line" : `${rows.length} lines`}</Mono>
        </span>
      </header>
      {rows.length ? (
        <Lines rows={rows} withBefore={comparing} />
      ) : (
        <p className="px-3 py-6 text-center font-mono text-[11px] text-faint">empty file</p>
      )}
    </article>
  );
}

export function AssetDocument({
  asset,
  api,
  onChanged,
  onError,
}: {
  asset: Asset;
  api: Api;
  onChanged: () => void;
  onError: (cause: unknown) => void;
}) {
  const [versions, setVersions] = useState<Version[]>();
  const [selectedId, setSelectedId] = useState<string>();
  const [documents, setDocuments] = useState<Record<string, Documents>>({});
  /* Versions are immutable, so a version fetched once never needs fetching
     again — and one already in flight must not be fetched twice. */
  const requested = useRef(new Set<string>());
  const head = asset.head_version_id ?? undefined;

  const loadDocuments = useCallback(
    async (versionId: string) => {
      if (requested.current.has(versionId)) return;
      requested.current.add(versionId);
      const path = `/v1/assets/${encodeURIComponent(asset.id)}/versions/${encodeURIComponent(versionId)}/files`;
      try {
        const files = list<AssetFile>(await api<unknown>(path));
        /* Decoded here rather than inside the updater: React may run an
           updater during a later render, where a throw would escape this
           try and there is no boundary above us to catch it. */
        const decoded = Object.fromEntries(
          files.map((file) => [file.path, decodeText(file.content_b64)]),
        );
        setDocuments((current) => ({ ...current, [versionId]: decoded }));
      } catch (cause) {
        requested.current.delete(versionId);
        onError(cause);
      }
    },
    [api, asset.id, onError],
  );

  /* A restore writes a new head, so `head` changing is the signal that the
     history is stale — the effect reruns and selects the new live version. */
  useEffect(() => {
    let live = true;
    api<unknown>(`/v1/assets/${encodeURIComponent(asset.id)}/history`)
      .then((value) => {
        if (!live) return;
        const rows = list<Version>(value);
        const initial = head ?? rows[0]?.id;
        setVersions(rows);
        setSelectedId(initial);
        if (head) void loadDocuments(head);
        if (initial) void loadDocuments(initial);
      })
      .catch((cause) => {
        if (live) onError(cause);
      });
    return () => {
      live = false;
    };
  }, [api, asset.id, head, loadDocuments, onError]);

  function select(versionId: string) {
    setSelectedId(versionId);
    void loadDocuments(versionId);
  }

  async function rollback(version: Version) {
    const label = version.seq == null ? "this version" : `version ${version.seq}`;
    if (!window.confirm(`Restore ${label} of ${asset.name} as the live version?`)) return;
    try {
      await api(`/v1/assets/${encodeURIComponent(asset.id)}/rollback`, {
        method: "POST",
        body: JSON.stringify({ to_version_id: version.id }),
      });
      onChanged();
    } catch (cause) {
      onError(cause);
    }
  }

  const selected = versions?.find((version) => version.id === selectedId);
  const liveVersion = versions?.find((version) => version.id === head);
  /* Nothing to compare against until a version is live, so a version pushed
     into an empty history is shown as it is rather than as a diff. */
  const comparing = Boolean(head && selectedId && selectedId !== head);
  /* Review can leave a version newer than the live one. For those the live
     document is the older side of the diff, so it reads as what the version
     proposes rather than as what it would undo. */
  const proposed = (selected?.seq ?? 0) > (liveVersion?.seq ?? 0);
  const headDocuments = head ? documents[head] : undefined;
  const selectedDocuments = selectedId ? documents[selectedId] : undefined;
  const older = proposed ? headDocuments : selectedDocuments;
  const newer = proposed ? selectedDocuments : headDocuments;
  const before = comparing ? older : undefined;
  const after = comparing ? newer : selectedDocuments;
  const paths = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const ready = comparing ? Boolean(before && after) : Boolean(after);

  return (
    <>
      {versions && !versions.length ? (
        <EmptyState>No version of this asset has been pushed yet.</EmptyState>
      ) : (
        <div className="grid items-start gap-5 pt-4 pb-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="grid min-w-0 gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
              <span className="flex flex-wrap items-center gap-2">
                <Chip title={selected?.id}>{shortId(selected?.id)}</Chip>
                <Mono>v{selected?.seq ?? "?"}</Mono>
                {comparing ? (
                  <span className="text-[13px] text-muted">
                    {proposed ? "proposed against" : "compared with"} the live version{" "}
                    <strong className="font-semibold text-ink">v{liveVersion?.seq}</strong>
                  </span>
                ) : (
                  <span className="text-[13px] text-muted">
                    {head && selectedId === head ? "live version" : "not live yet"}
                  </span>
                )}
                {selected?.provenance?.pending_review === true && (
                  <Badge tone="hold">waiting for review</Badge>
                )}
              </span>
              {selected?.provenance && Object.keys(selected.provenance).length > 0 && (
                <div className="min-w-0 font-mono text-[11px]">
                  <Disclosure summary="provenance">
                    <Json value={selected.provenance} />
                  </Disclosure>
                </div>
              )}
              {/* Restoring copies the version forward as a new live one, which
                  is only meaningful for a version the live one has moved past. */}
              {comparing && selected && !proposed && (
                <Button size="sm" className="ml-auto" onClick={() => void rollback(selected)}>
                  Restore this version
                </Button>
              )}
            </div>
            {ready ? (
              paths.map((path) => (
                <FileBlock
                  key={path}
                  path={path}
                  before={before?.[path]}
                  after={after?.[path]}
                  comparing={comparing}
                />
              ))
            ) : (
              <EmptyState>Loading the document…</EmptyState>
            )}
          </div>

          <aside className="min-w-0 max-lg:order-first">
            <h2 className="px-1 pb-2 text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
              Version history
            </h2>
            <ol className="relative m-0 grid list-none gap-1 rounded-lg border border-line bg-sunken py-2 pr-1.5 pl-7 max-lg:max-h-60 max-lg:overflow-y-auto">
              <span aria-hidden className="absolute top-5 bottom-5 left-[17px] w-px bg-line" />
              {(versions ?? []).map((version) => {
                const isSelected = version.id === selectedId;
                const pending = version.provenance?.pending_review === true;
                return (
                  <li key={version.id} className="relative">
                    <span aria-hidden className="absolute top-3.5 -left-[14px]">
                      <Dot tone={version.id === head ? "ok" : pending ? "hold" : "neutral"} glow />
                    </span>
                    <Button
                      variant="none"
                      size="none"
                      full
                      className={`rounded-md border px-2.5 py-2 text-left ${
                        isSelected
                          ? "border-accent bg-surface"
                          : "border-transparent hover:border-line hover:bg-surface"
                      }`}
                      onClick={() => select(version.id)}
                      aria-current={isSelected}
                    >
                      {/* The grid is a child, not the button: the button's own
                          `inline-flex` would win whatever a caller passes. */}
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="flex items-center gap-2">
                          <Chip title={version.id}>{shortId(version.id)}</Chip>
                          <Mono>v{version.seq ?? "?"}</Mono>
                          {version.id === head && <Badge tone="ok">live</Badge>}
                          {pending && <Badge tone="hold">in review</Badge>}
                        </span>
                        <span className="truncate text-[12px] font-medium">
                          {version.message ?? "No change note"}
                        </span>
                        <span
                          title={version.author_email ?? undefined}
                          className="truncate font-mono text-[11px] text-muted"
                        >
                          {dateTime(version.created_at)} · {shortId(version.author_email)}
                        </span>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      )}
    </>
  );
}
