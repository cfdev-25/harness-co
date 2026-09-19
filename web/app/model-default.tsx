"use client";

/* The one connection every workspace must have. docs/agents.md §12.4: a
   workspace missing `model-default` looks exactly like a workspace with no
   connections at all unless something says otherwise — so this renders
   whether or not the row exists, right above the ordinary connections table.

   Two mistakes the user actually made, both closed here rather than assumed
   away: adding a key is not the same as pointing a model at it, and the
   env-var naming rule on the key form has nothing to do with what this
   saves — nobody types that name, ever. */

import { FormEvent, useEffect, useState } from "react";
import { list } from "@/lib/api";
import { decodeText } from "@/lib/diff";
import { Api, ApiKey, Asset, AssetFile, TreeNode } from "@/lib/types";
import { ControlRow } from "./admin";
import { Badge, Button, CONTROL_CLASS, Chip, Field, Modal, Mono, Notice } from "./ui";

const NAME = "model-default";

/** Base64 as the API expects it: UTF-8 bytes, not Latin-1. Mirrors
    lib/diff.ts's `decodeText` from the other direction. */
function encodeText(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function isOwned(asset: Asset) {
  return (asset.origin ?? "owned") === "owned";
}

interface ModelFile {
  provider?: string;
  model_id?: string;
  base_url?: string;
  key_ref?: string;
}

/* The exact failure the user hit, generalised to the other base URL this
   page hands out. Non-blocking: it tells the truth, it does not stop a
   save. §12.5. */
function baseUrlWarning(baseUrl: string): string | undefined {
  const url = baseUrl.trim().toLowerCase();
  if (!url) return undefined;
  if (url.includes("api.anthropic.com")) {
    return "This points straight at Anthropic. It will work with Claude Code, but Pi's model connection only speaks the OpenAI-style format and will not work against it.";
  }
  if (url.includes("openrouter.ai/api/v1")) {
    return "This is OpenRouter's OpenAI-style address. It will work with Pi, but Claude Code needs OpenRouter's other address instead: https://openrouter.ai/api.";
  }
  if (url.includes("openrouter.ai/api")) {
    return "This is OpenRouter's Claude-style address. It will work with Claude Code, but Pi needs OpenRouter's other address instead: https://openrouter.ai/api/v1.";
  }
  return undefined;
}

/* Mounted only while the modal is open, so every field's starting value is
   simply its initial state — no effect has to reset a form back to what was
   actually saved after a cancelled edit. */
function ModelDefaultForm({
  unit,
  api,
  initial,
  editTargetId,
  editTargetVersionId,
  editTargetStatus,
  onClose,
  onSaved,
  onError,
  onAddKey,
}: {
  unit: TreeNode;
  api: Api;
  initial?: ModelFile;
  /** Undefined means: create this unit's first copy of the name. */
  editTargetId?: string;
  editTargetVersionId?: string | null;
  editTargetStatus?: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (cause: unknown) => void;
  onAddKey: () => void;
}) {
  const [provider, setProvider] = useState(initial?.provider ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [keys, setKeys] = useState<ApiKey[]>();

  useEffect(() => {
    let live = true;
    api<unknown>(`/v1/org-units/${encodeURIComponent(unit.id)}/api-keys`)
      .then((value) => {
        if (live) setKeys(list<ApiKey>(value).filter((key) => key.kind === "provider_api_key"));
      })
      .catch((cause: unknown) => {
        if (live) onError(cause);
      });
    return () => {
      live = false;
    };
  }, [unit.id, api, onError]);

  function applyPreset(nextProvider: string, nextBaseUrl: string) {
    setProvider(nextProvider);
    setBaseUrl(nextBaseUrl);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      provider: String(form.get("provider") ?? "").trim(),
      model_id: String(form.get("model_id") ?? "").trim(),
      base_url: String(form.get("base_url") ?? "").trim(),
      key_ref: String(form.get("key_ref") ?? "").trim(),
    };
    const message = `Set the default model to ${payload.provider} ${payload.model_id}.`;
    const files = [{ path: "model.json", content_b64: encodeText(JSON.stringify(payload)) }];
    try {
      if (editTargetId) {
        await api(`/v1/assets/${encodeURIComponent(editTargetId)}/versions`, {
          method: "POST",
          body: JSON.stringify({
            message,
            parent_version_id: editTargetVersionId ?? null,
            files,
          }),
        });
        if (editTargetStatus === "archived") {
          await api(`/v1/assets/${encodeURIComponent(editTargetId)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "active" }),
          });
        }
      } else {
        await api("/v1/assets", {
          method: "POST",
          body: JSON.stringify({
            org_unit_id: unit.id,
            kind: "connection",
            name: NAME,
            message,
            files,
          }),
        });
      }
      onSaved();
    } catch (cause) {
      onError(cause);
    }
  }

  const currentKeyRef = initial?.key_ref;
  const missingCurrentKey = Boolean(
    currentKeyRef && keys && !keys.some((key) => key.ref === currentKeyRef),
  );
  const warning = baseUrlWarning(baseUrl);

  return (
    <Modal title={editTargetId ? "Edit the default model" : "Set up the default model"} onClose={onClose}>
      <form className="grid gap-4 p-5" onSubmit={submit}>
        <Notice>
          Adding a connector stores a secret — it does not by itself pick a model. This is the
          separate step that says which model to use and which connector unlocks it. You will not
          be asked to name anything here; whatever you named that connector&apos;s environment
          variable does not matter for this.
        </Notice>
        <Field
          label="Provider"
          name="provider"
          required
          autoFocus
          placeholder="anthropic"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          hint="The provider id, e.g. anthropic or openrouter."
        />
        <div className="-mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            type="button"
            onClick={() => applyPreset("anthropic", "https://api.anthropic.com")}
          >
            Anthropic
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={() => applyPreset("openrouter", "https://openrouter.ai/api")}
          >
            OpenRouter · Claude Code
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={() => applyPreset("openrouter", "https://openrouter.ai/api/v1")}
          >
            OpenRouter · Pi
          </Button>
        </div>
        <p className="-mt-2 text-xs leading-relaxed text-muted">
          One OpenRouter key works for both agents — it offers a Claude-shaped address and an
          OpenAI-shaped one side by side. Pick the preset that matches the agent this connection
          should serve.
        </p>
        <Field
          label="Model"
          name="model_id"
          required
          placeholder="claude-opus-5"
          defaultValue={initial?.model_id ?? ""}
        />
        <Field
          label="Base URL"
          name="base_url"
          type="url"
          required
          placeholder="https://api.anthropic.com"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        {warning && <Notice tone="warn">{warning}</Notice>}
        {keys !== undefined && keys.length === 0 && !missingCurrentKey ? (
          /* A `Notice` containing a `Button` cannot live inside `Field`'s
             `<label>` — a button is a labelable element, so a click anywhere
             on the label (including this sentence) would fire it instead. */
          <div className="grid gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.09em] text-muted uppercase">
              Connector
            </span>
            <Notice tone="warn">
              This unit has no model provider connectors yet.
              <div className="mt-2">
                <Button size="sm" type="button" onClick={onAddKey}>
                  Add a connector
                </Button>
              </div>
            </Notice>
          </div>
        ) : (
          <Field label="Connector">
            {keys === undefined ? (
              <Mono>loading connectors…</Mono>
            ) : (
              <select
                name="key_ref"
                required
                defaultValue={currentKeyRef ?? ""}
                className={CONTROL_CLASS}
              >
                {!currentKeyRef && (
                  <option value="" disabled>
                    Choose a connector…
                  </option>
                )}
                {missingCurrentKey && currentKeyRef && (
                  <option value={currentKeyRef}>Current connector (not listed here)</option>
                )}
                {keys.map((key) => (
                  <option key={key.id} value={key.ref}>
                    {key.name} · ••••{key.last4 ?? "----"}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={keys === undefined || (keys.length === 0 && !missingCurrentKey)}
          >
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ModelDefaultRow({
  unit,
  api,
  onChanged,
  onError,
  onAddKey,
}: {
  unit: TreeNode;
  api: Api;
  onChanged: () => void;
  onError: (cause: unknown) => void;
  onAddKey: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  /* Bumped after a save so the row re-reads what it just wrote. */
  const [reload, setReload] = useState(0);
  const [modelRows, setModelRows] = useState<Asset[]>([]);
  /* Tagged with the row it was fetched for, so a row that disappears (or
     changes) reads as "no content" instead of showing the last one fetched. */
  const [content, setContent] = useState<{ assetId: string; versionId: string; data?: ModelFile }>();

  /* The Connectors tab loads keys, not assets, so this row fetches the one
     asset it cares about rather than being handed a list it would be the only
     reader of. */
  useEffect(() => {
    let live = true;
    api<unknown>(`/v1/org-units/${encodeURIComponent(unit.id)}/assets`)
      .then((value) => {
        if (!live) return;
        setModelRows(list<Asset>(value).filter((asset) => asset.kind === "connection" && asset.name === NAME));
      })
      .catch(() => {
        if (live) setModelRows([]);
      });
    return () => {
      live = false;
    };
  }, [api, unit.id, reload]);

  const ownRow = modelRows.find(isOwned);
  const inheritedRow = modelRows.find((asset) => asset.origin === "inherited");
  /* Resolution only ever sees active rows (resolve.py), so this is the same
     test the server applies: whichever of ours or the inherited one is
     active is what a session actually gets. */
  const activeRow = [ownRow, inheritedRow].find((asset) => asset?.status === "active");
  /* What the form edits: our own copy if this unit has one — even disabled —
     because the database will not let a second row share this name at the
     same unit. With none, editing creates this unit's first copy, which may
     shadow an inherited one without touching it. */
  const editTarget = ownRow;
  const contentRow = activeRow ?? ownRow ?? inheritedRow;
  const assetId = contentRow?.id;
  const versionId = contentRow?.head_version_id ?? undefined;

  useEffect(() => {
    if (!assetId || !versionId) return;
    let live = true;
    const path = `/v1/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/files`;
    api<unknown>(path)
      .then((value) => {
        if (!live) return;
        const jsonFile = list<AssetFile>(value).find((file) => file.path.endsWith(".json"));
        let data: ModelFile | undefined;
        if (jsonFile) {
          try {
            data = JSON.parse(decodeText(jsonFile.content_b64)) as ModelFile;
          } catch {
            data = undefined;
          }
        }
        setContent({ assetId, versionId, data });
      })
      .catch((cause: unknown) => {
        if (live) onError(cause);
      });
    return () => {
      live = false;
    };
  }, [api, assetId, versionId, onError]);

  const loadedContent =
    content && content.assetId === assetId && content.versionId === versionId
      ? content.data
      : undefined;
  const rowWarning = loadedContent ? baseUrlWarning(loadedContent.base_url ?? "") : undefined;

  function saved() {
    setFormOpen(false);
    setReload((n) => n + 1);
    onChanged();
  }

  return (
    <div className="mb-2 border-b-2 border-line pb-1">
      {activeRow ? (
        <ControlRow
          label="Default model"
          hint="The model every session in this workspace runs on."
          setHere={isOwned(activeRow)}
        >
          {loadedContent ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip>{loadedContent.provider || "—"}</Chip>
                <Chip>{loadedContent.model_id || "—"}</Chip>
                <Mono title={loadedContent.base_url}>{loadedContent.base_url || "—"}</Mono>
              </div>
              {rowWarning && (
                <div className="mt-2 max-w-[44rem]">
                  <Notice tone="warn">{rowWarning}</Notice>
                </div>
              )}
            </>
          ) : (
            <Mono>loading…</Mono>
          )}
          <div className="mt-2">
            <Button size="sm" onClick={() => setFormOpen(true)}>
              Edit
            </Button>
          </div>
        </ControlRow>
      ) : (
        <div className="border-b border-hairline py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">Default model</span>
            <Badge tone="warn">{ownRow ? "disabled" : "not set"}</Badge>
          </div>
          <div className="mt-2 max-w-[44rem]">
            <Notice tone="warn">
              {ownRow ? (
                <>
                  The default model connection for this unit is turned off. Until it is back on,
                  sessions here have no model and will fail.
                </>
              ) : (
                <>
                  This is the model every session in this workspace runs on, and nothing is
                  configured yet. Sessions here will fail until it is. Adding a connector only
                  stores a secret — this is the separate step that points sessions at it.
                </>
              )}
              <div className="mt-2">
                <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                  {ownRow ? "Turn it back on" : "Set up the default model"}
                </Button>
              </div>
            </Notice>
          </div>
        </div>
      )}

      {formOpen && (
        <ModelDefaultForm
          unit={unit}
          api={api}
          initial={loadedContent}
          editTargetId={editTarget?.id}
          editTargetVersionId={editTarget?.head_version_id}
          editTargetStatus={editTarget?.status}
          onClose={() => setFormOpen(false)}
          onSaved={saved}
          onError={onError}
          onAddKey={() => {
            setFormOpen(false);
            onAddKey();
          }}
        />
      )}
    </div>
  );
}
