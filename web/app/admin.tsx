"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, list, request } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  Api,
  ApiKey,
  Asset,
  AssetScopeRow,
  AuditEvent,
  BoundaryPolicy,
  BoundaryView,
  ControlVerdict,
  Harness,
  Identity,
  Invite,
  JsonRecord,
  Pane,
  Tab,
  TreeNode,
} from "@/lib/types";
import { HELP } from "./help";
import { ThemePicker } from "./theme-picker";
import { AssetDocument } from "./asset-document";
import { AssetManage } from "./asset-manage";
import { ModelDefaultRow } from "./model-default";
import { HarnessDialog, HarnessTiles } from "./harness-tiles";
import { HarnessScreen } from "./harness-screen";
import { ScopeCell } from "./scope";
import {
  Alert,
  Badge,
  BrandMark,
  Button,
  Chip,
  CommandBlock,
  CONTROL_CLASS,
  dateTime,
  day,
  Disclosure,
  Dot,
  EmptyState,
  Field,
  HeaderSearch,
  Json,
  KindTag,
  Modal,
  Mono,
  Notice,
  shortId,
  Table,
  TagGrid,
  Td,
  Toolbar,
  Tone,
  Tr,
} from "./ui";

/* A tab's payload, tagged with the tab and unit it was fetched for. Panels
   read structured fields now, so handing one the previous tab's response is a
   crash rather than a cosmetic glitch — the tag is what rules that out. */
type TabResult =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; value: unknown }
  | { key: string; status: "failed"; message: string; code?: number };

/* The six asset kinds share one eager, per-unit fetch (below `AdminApp`),
   independent of `TabResult`'s per-tab keying. */
type AssetsResult =
  | { status: "loading" }
  | { status: "ready"; assets: Asset[] }
  | { status: "failed"; message: string; code?: number };

/* Lookups ----------------------------------------------------------------- */

/* Ordered by how much of a conversation each one shapes: standing behaviour,
   then standing facts, then what is reached for, then what acts, then wiring. */
const ASSET_TABS: readonly Tab[] = [
  "system_prompt",
  "memory",
  "skill",
  "prompt",
  "tool",
  "connection",
];

const TABS: { id: Tab; label: string }[] = [
  { id: "keys", label: "Connectors" },
  { id: "skill", label: "Skills" },
  { id: "tool", label: "Tools" },
  { id: "memory", label: "Memories" },
  { id: "system_prompt", label: "System prompts" },
  { id: "prompt", label: "Prompts" },
  { id: "connection", label: "Connections" },
  { id: "harness", label: "Harnesses" },
  { id: "boundary", label: "Boundary" },
  { id: "invites", label: "People" },
  { id: "audit", label: "Audit" },
];

/* docs/scoping.md §8: the sub-sidebar reads as two kinds of thing rather than
   one long strip. Preferences (docs/agents.md §14.10) belongs in the second
   group once it exists — it depends on a concurrent task's boundary keys, so
   the entry is left out entirely rather than added dead. */
const TAB_GROUPS: { heading: string; tabs: Tab[] }[] = [
  {
    heading: "What this unit has",
    tabs: ["keys", "skill", "tool", "memory", "system_prompt", "prompt", "connection", "harness"],
  },
  { heading: "How it behaves", tabs: ["boundary", "invites", "audit"] },
];

/* `archived` is the stored value; "disabled" is what it does. */
const STATUS_TONE: Record<string, Tone> = {
  active: "ok",
  archived: "warn",
};

const STATUS_LABEL: Record<string, string> = {
  active: "live",
  archived: "disabled",
};

const CLASS_TONE: Record<string, Tone> = {
  authoritative: "accent",
  attested: "hold",
};

const KEY_KIND_LABEL: Record<string, string> = {
  provider_api_key: "Model provider",
  static_api_key: "System",
};

/* docs/agents.md §11.1: three outcomes, and every control gets exactly one.
   "pending" is a choke point we own that is not live yet (Phase 3) — distinct
   from "advisory", which is a choke point we will never own. */
const VERDICT_TONE: Record<ControlVerdict["status"], Tone> = {
  enforced: "ok",
  advisory: "hold",
  pending: "neutral",
};

const VERDICT_LABEL: Record<ControlVerdict["status"], string> = {
  enforced: "Enforced",
  advisory: "Advisory",
  pending: "Not enforced yet",
};

/* The CLI is the product's front door, so the thing you copy has to be the
   thing you run — not a token you then have to assemble a command around. */
const API_URL = process.env.NEXT_PUBLIC_HARNESS_API_URL ?? "http://127.0.0.1:8400";
const INSTALL_COMMAND = process.env.NEXT_PUBLIC_HARNESS_INSTALL ?? "npm install -g @harness/cli";
// Development convenience: removes the CLI and every local trace of it. Set
// NEXT_PUBLIC_HARNESS_SHOW_RESET=false to hide this before shipping.
const SHOW_RESET = process.env.NEXT_PUBLIC_HARNESS_SHOW_RESET !== "false";
const RESET_COMMAND = "npm uninstall -g @harness/cli && rm -rf ~/.harness ~/.config/harness";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/* Helpers ----------------------------------------------------------------- */

/** A node together with the chain of ancestors that reached it, for
    breadcrumbs, unit pickers, and telling a descendant from a cousin. */
export interface FlatNode {
  node: TreeNode;
  trail: TreeNode[];
}

/** Depth-first with each node's ancestors, for breadcrumbs and unit pickers. */
function flatten(nodes: TreeNode[], trail: TreeNode[] = []): FlatNode[] {
  return nodes.flatMap((node) => [
    { node, trail },
    ...flatten(node.children ?? [], [...trail, node]),
  ]);
}

function matches(query: string, ...fields: (string | null | undefined)[]) {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle));
}

/** Dot-path as a branch: "acme.eng.ana" → "acme / eng / ana". */
export function branchPath(path?: string) {
  return path?.split(".").join(" / ") ?? "—";
}

function isOwnedHere(asset: Asset) {
  return (asset.origin ?? "owned") === "owned";
}

function counter(shown: number, total: number) {
  return shown === total ? String(total) : `${shown} / ${total}`;
}

function brief(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "null";
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

/* Navigation -------------------------------------------------------------- */

function TreeItem({
  node,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: TreeNode;
  selectedId?: string;
  onSelect: (node: TreeNode) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = Boolean(node.children?.length);
  const isSelected = selectedId === node.id;

  return (
    <li>
      <div
        className={`my-px flex min-h-9 items-center rounded-md pr-1.5 ${
          isSelected ? "bg-surface ring-1 ring-line ring-inset" : "hover:bg-canvas"
        }`}
        /* Depth is data-driven, so the indent stays an inline style. */
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        <Button
          variant="bare"
          size="none"
          className="size-5 items-center justify-center text-[9px] text-faint hover:text-accent"
          onClick={() => setOpen((value) => !value)}
          aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
          disabled={!hasChildren}
        >
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </Button>
        <Button
          variant="bare"
          size="none"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pl-1 text-left"
          onClick={() => onSelect(node)}
          aria-current={isSelected}
        >
          <span className={`truncate text-[13px] ${isSelected ? "font-bold" : "font-medium"}`}>
            {node.name}
          </span>
          {node.role && (
            <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-faint uppercase">
              {node.role}
            </span>
          )}
        </Button>
      </div>
      {open && hasChildren && (
        <ul className="m-0 list-none p-0">
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/* Tab panels -------------------------------------------------------------- */

/* One list, no toggle (docs/scoping.md §6). Every row says who owns it; a row
   this unit owns also says who it reaches, because "not shared yet" is a
   real, visible state (§4) — everything else offers no scope control at all,
   the same way `AssetManage` already treats an inherited row as somebody
   else's to change. */
function AssetsPanel({
  assets,
  noun,
  query,
  unit,
  nodes,
  scopesByAsset,
  api,
  onOpen,
  onScoped,
  onError,
}: {
  assets: Asset[];
  noun: string;
  query: string;
  unit: TreeNode;
  nodes: FlatNode[];
  /** Undefined = not loaded yet for this asset. Only meaningful for rows this
      unit owns — `AdminApp` only ever fetches scopes for those. */
  scopesByAsset: Record<string, AssetScopeRow[]>;
  api: Api;
  onOpen: (asset: Asset, pane: Pane) => void;
  onScoped: (assetId: string, rows: AssetScopeRow[]) => void;
  onError: (cause: unknown) => void;
}) {
  const shown = assets.filter((asset) =>
    matches(
      query,
      asset.name,
      asset.head_message,
      asset.org_unit_path,
      STATUS_LABEL[asset.status ?? ""],
    ),
  );
  const ordered = [...shown].sort((a, b) => {
    const path = (a.org_unit_path ?? "").localeCompare(b.org_unit_path ?? "");
    return path || a.name.localeCompare(b.name);
  });

  return (
    <>
      <Toolbar count={query ? counter(shown.length, assets.length) : String(assets.length)} />
      {ordered.length ? (
        <Table
          head={[
            "Name",
            "Owned by",
            "Shared with",
            "Version",
            "Message",
            "Updated",
            "Harnesses",
            "Status",
            "",
          ]}
        >
          {ordered.map((asset) => (
            <Tr key={asset.id}>
              <Td className="whitespace-nowrap">
                <Button
                  variant="bare"
                  size="none"
                  className="text-[13px] font-semibold underline-offset-4 hover:text-accent hover:underline"
                  onClick={() => onOpen(asset, "document")}
                >
                  {asset.name}
                </Button>
              </Td>
              <Td>
                <span className="flex items-center gap-2">
                  {isOwnedHere(asset) && <Badge tone="accent">this unit</Badge>}
                  <Mono title={asset.org_unit_path}>{branchPath(asset.org_unit_path)}</Mono>
                </span>
              </Td>
              <Td>
                {isOwnedHere(asset) ? (
                  <ScopeCell
                    assetId={asset.id}
                    assetName={asset.name}
                    ownerUnit={unit}
                    nodes={nodes}
                    rows={scopesByAsset[asset.id]}
                    api={api}
                    onSaved={(rows) => onScoped(asset.id, rows)}
                    onError={onError}
                  />
                ) : (
                  <Mono>—</Mono>
                )}
              </Td>
              <Td>
                {asset.head_version_id ? (
                  <Chip title={asset.head_version_id}>{shortId(asset.head_version_id)}</Chip>
                ) : (
                  <Mono>no version pushed</Mono>
                )}
              </Td>
              <Td>
                <span
                  className="block max-w-[24rem] truncate text-muted"
                  title={asset.head_message ?? undefined}
                >
                  {asset.head_message ?? "—"}
                </span>
              </Td>
              <Td>
                <Mono title={dateTime(asset.head_updated_at ?? asset.created_at)}>
                  {day(asset.head_updated_at ?? asset.created_at)}
                </Mono>
              </Td>
              <Td>
                <Mono>{asset.harness_ids?.length ?? 0}</Mono>
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[asset.status ?? ""] ?? "neutral"}>
                  {STATUS_LABEL[asset.status ?? ""] ?? asset.status ?? "unknown"}
                </Badge>
              </Td>
              <Td className="text-right">
                <span className="inline-flex gap-2">
                  <Button size="sm" onClick={() => onOpen(asset, "document")}>
                    View
                  </Button>
                  <Button size="sm" onClick={() => onOpen(asset, "manage")}>
                    Manage
                  </Button>
                </span>
              </Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <EmptyState>
          {assets.length ? `No ${noun} match “${query}”.` : `No ${noun} reach this unit yet.`}
        </EmptyState>
      )}
    </>
  );
}

export function ControlRow({
  label,
  hint,
  setHere,
  verdict,
  children,
}: {
  label: string;
  hint: string;
  setHere: boolean;
  /** docs/agents.md §11.1: a control's standing, read from the same
      `merge_boundaries` output `harness doctor` reads. Omitted entirely for
      a control whose verdict is still an open decision — see
      `budget.monthly_usd_cap` below, which intentionally never passes one. */
  verdict?: ControlVerdict;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,19rem)_minmax(0,1fr)] items-start gap-x-6 gap-y-2 border-b border-hairline py-3.5 max-sm:grid-cols-1">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">{label}</span>
          <Badge tone={setHere ? "accent" : "neutral"}>{setHere ? "set here" : "inherited"}</Badge>
          {verdict && (
            <Badge tone={VERDICT_TONE[verdict.status]}>{VERDICT_LABEL[verdict.status]}</Badge>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
        {verdict && <p className="mt-1 text-xs leading-relaxed text-faint">{verdict.note}</p>}
      </div>
      <div className="min-w-0 self-center">{children}</div>
    </div>
  );
}

/** An absent allowlist is unrestricted; an empty one permits nothing. */
function Allowlist({ values }: { values?: string[] | null }) {
  if (values == null) return <Mono>not constrained — no policy in this chain sets one</Mono>;
  if (values.length === 0) return <Badge tone="warn">denies all</Badge>;
  return <TagGrid items={values} />;
}

function Switch({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return <Badge tone={on ? "ok" : "neutral"}>{on ? onLabel : offLabel}</Badge>;
}

function BoundaryPanel({ boundary }: { boundary?: BoundaryView }) {
  if (!boundary) return <EmptyState>No boundary document was returned.</EmptyState>;

  const own = boundary.own ?? {};
  const effective = boundary.effective ?? {};
  const setHere = (key: keyof BoundaryPolicy) => own[key] !== undefined;
  // The same source `harness doctor` will read once it exists (docs/agents.md
  // §11.3, §14.9), so the console and the CLI can never print two different
  // answers for the same field.
  const verdicts = effective.verdicts ?? {};

  return (
    <div className="pt-2">
      <ControlRow
        label="Network egress"
        hint="Hosts the harness may reach. The chain is intersected, so a parent can never be widened."
        setHere={setHere("egress_allowlist")}
        verdict={verdicts.egress_allowlist}
      >
        <Allowlist values={effective.egress_allowlist} />
      </ControlRow>
      <ControlRow
        label="Allowed connections"
        hint="Connection assets a skill may require by name. The chain is intersected here too."
        setHere={setHere("connector_allowlist")}
        verdict={verdicts.connector_allowlist}
      >
        <Allowlist values={effective.connector_allowlist} />
      </ControlRow>
      <ControlRow
        label="Push review"
        hint="Whether a pushed version waits for review before it becomes the one sessions use. This is the actual gate on publishing something — nothing resolves a version under review until an admin approves it."
        setHere={setHere("build_policy")}
        verdict={verdicts["build_policy.push_review"]}
      >
        <Switch
          on={Boolean(effective.build_policy?.push_review)}
          onLabel="Required"
          offLabel="Not required"
        />
      </ControlRow>
      <ControlRow
        label="Ask before deploying"
        hint="Asks the agent to pause and confirm before it calls a tool on this unit's deploy list. The agent decides whether to honour that — this is a nudge, not a gate. Push review, above, is the actual control on what gets published."
        setHere={setHere("approvals")}
        verdict={verdicts["approvals.deploy"]}
      >
        <Switch
          on={effective.approvals?.deploy === "required"}
          onLabel="Asks"
          offLabel="Does not ask"
        />
      </ControlRow>
      <ControlRow
        label="Monthly spend cap"
        hint="The lowest cap anywhere in the chain wins."
        setHere={setHere("budget")}
      >
        {effective.budget?.monthly_usd_cap == null ? (
          <Mono>no cap set in this chain</Mono>
        ) : (
          <Chip>{USD.format(effective.budget.monthly_usd_cap)} / month</Chip>
        )}
      </ControlRow>
      <ControlRow
        label="Request rate"
        hint="The lowest rate anywhere in the chain wins."
        setHere={setHere("budget")}
        verdict={verdicts["budget.requests_per_minute"]}
      >
        {effective.budget?.requests_per_minute == null ? (
          <Mono>no rate limit set in this chain</Mono>
        ) : (
          <Chip>{effective.budget.requests_per_minute} / minute</Chip>
        )}
      </ControlRow>
      <div className="pt-4 font-mono text-[11px]">
        <Disclosure summary="raw policy document">
          <Json value={boundary} />
        </Disclosure>
      </div>
    </div>
  );
}

function KeysPanel({
  keys,
  query,
  onCreate,
  onRotate,
}: {
  keys: ApiKey[];
  query: string;
  onCreate: () => void;
  onRotate: (key: ApiKey) => void;
}) {
  const shown = keys.filter((key) => matches(query, key.name, key.env_var, key.ref));

  return (
    <>
      <Toolbar
        count={query ? counter(shown.length, keys.length) : undefined}
        actions={
          <Button variant="primary" size="sm" onClick={onCreate}>
            Add connector
          </Button>
        }
      />
      {shown.length ? (
        <Table
          head={[
            "Name",
            "Kind",
            "Environment variable",
            "Reference",
            "Ends in",
            "Version",
            "Added",
            "",
          ]}
        >
          {shown.map((key) => (
            <Tr key={key.id}>
              <Td className="font-semibold whitespace-nowrap">{key.name}</Td>
              <Td className="text-muted">{KEY_KIND_LABEL[key.kind ?? ""] ?? key.kind ?? "—"}</Td>
              <Td>{key.env_var ? <Chip>{key.env_var}</Chip> : <Mono>—</Mono>}</Td>
              <Td>
                {key.ref ? (
                  <Chip title={key.ref}>
                    <span className="max-w-[16rem] truncate">{key.ref}</span>
                  </Chip>
                ) : (
                  <Mono>—</Mono>
                )}
              </Td>
              <Td>
                <Mono>••••{key.last4 ?? "—"}</Mono>
              </Td>
              <Td>
                <Chip>v{key.version ?? "?"}</Chip>
              </Td>
              <Td>
                <Mono>{day(key.created_at)}</Mono>
              </Td>
              <Td className="text-right">
                <Button size="sm" onClick={() => onRotate(key)}>
                  Rotate
                </Button>
              </Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <EmptyState>
          {keys.length
            ? `No connectors match “${query}”.`
            : "No connectors are configured for this unit."}
        </EmptyState>
      )}
    </>
  );
}

function InvitesPanel({
  unit,
  invites,
  query,
  onInvite,
  onRevoke,
}: {
  unit: TreeNode;
  invites: Invite[];
  query: string;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRevoke: (invite: Invite) => void;
}) {
  const shown = invites.filter((invite) => matches(query, invite.email, invite.admin_level));

  return (
    <>
      <Toolbar count={query ? counter(shown.length, invites.length) : undefined} />
      <div className="mb-6 max-w-[44rem] rounded-lg border border-line bg-sunken p-4">
        {unit.role === "team" ? (
          <form
            className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end"
            onSubmit={onInvite}
          >
            <Field
              label="Email"
              name="email"
              type="email"
              required
              placeholder="person@example.com"
            />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px]">
                <input name="admin" type="checkbox" className="size-4 accent-accent" />
                Team admin
              </label>
              <Button variant="primary" type="submit">
                Send invite
              </Button>
            </div>
          </form>
        ) : (
          <Notice>
            Invites belong to a team. Select a team in the organization tree to invite someone.
          </Notice>
        )}
      </div>
      {shown.length ? (
        <Table head={["Email", "State", "Admin grant", "Invited", ""]}>
          {shown.map((invite) => (
            <Tr key={invite.id}>
              <Td className="font-semibold whitespace-nowrap">{invite.email}</Td>
              <Td>
                <Badge tone={invite.accepted_at ? "ok" : "hold"}>
                  {invite.accepted_at ? "accepted" : "pending"}
                </Badge>
              </Td>
              <Td>
                {invite.admin_level ? (
                  <Badge tone="accent">{invite.admin_level}</Badge>
                ) : (
                  <Mono>—</Mono>
                )}
              </Td>
              <Td>
                <Mono>{day(invite.created_at)}</Mono>
              </Td>
              <Td className="text-right">
                {!invite.accepted_at && (
                  <Button size="sm" onClick={() => onRevoke(invite)}>
                    Revoke
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <EmptyState>
          {invites.length ? `No invites match “${query}”.` : "No invites for this team yet."}
        </EmptyState>
      )}
    </>
  );
}

function Payload({ value }: { value?: JsonRecord }) {
  const entries = Object.entries(value ?? {});
  if (!entries.length) return <Mono>—</Mono>;
  return (
    <div className="max-w-[24rem] font-mono text-[11px]">
      <Disclosure summary={entries.map(([key, item]) => `${key}=${brief(item)}`).join("  ")}>
        <Json value={value} />
      </Disclosure>
    </div>
  );
}

function AuditPanel({ events, query }: { events: AuditEvent[]; query: string }) {
  const shown = events.filter((event) =>
    matches(query, event.action, event.actor_type, event.class),
  );

  return (
    <>
      <Toolbar count={query ? counter(shown.length, events.length) : undefined} />
      {shown.length ? (
        <Table head={["Time", "Action", "Class", "Actor", "Payload"]}>
          {shown.map((event) => (
            <Tr key={event.id}>
              <Td className="whitespace-nowrap">
                <Mono>{dateTime(event.created_at)}</Mono>
              </Td>
              <Td>
                <Chip>{event.action ?? "—"}</Chip>
              </Td>
              <Td>
                <Badge tone={CLASS_TONE[event.class ?? ""] ?? "neutral"}>
                  {event.class ?? "—"}
                </Badge>
              </Td>
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span>{event.actor_type ?? "—"}</span>
                  <Mono title={event.actor_id ?? undefined}>{shortId(event.actor_id)}</Mono>
                </span>
              </Td>
              <Td>
                <Payload value={event.payload} />
              </Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <EmptyState>
          {events.length ? `No events match “${query}”.` : "No audit events for this unit."}
        </EmptyState>
      )}
    </>
  );
}

function ProfileMenu({
  identity,
  onMintCli,
  onLogout,
}: {
  identity?: Identity;
  onMintCli: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="grid size-8 place-items-center rounded-full border border-line bg-surface text-fg transition hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-haspopup="menu"
        aria-label="Profile"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.2 19c1.1-3.1 3.4-4.7 6.8-4.7s5.7 1.6 6.8 4.7" strokeLinecap="round" />
        </svg>
      </button>
      <div className="invisible absolute top-full right-0 z-30 w-64 pt-1.5 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="grid gap-2 rounded-lg border border-line bg-overlay p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
          {identity?.email && (
            <div className="grid gap-0.5 px-2 py-1.5">
              <span className="truncate font-mono text-[12px]">{identity.email}</span>
              <span className="flex items-center gap-1.5 text-[11px] tracking-[0.06em] text-muted uppercase">
                <Dot tone="ok" />
                {identity.role_unit ? `${identity.role} · ${identity.role_unit}` : (identity.role ?? "user")}
              </span>
            </div>
          )}
          <div className="px-1">
            <ThemePicker labeled />
          </div>
          <div className="grid">
            <button
              type="button"
              className="rounded-md px-2.5 py-2 text-left text-[13px] text-fg hover:bg-surface"
              onClick={onMintCli}
            >
              CLI token
            </button>
            <button
              type="button"
              className="rounded-md px-2.5 py-2 text-left text-[13px] text-fg hover:bg-surface"
              onClick={onLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Application ------------------------------------------------------------- */

export function AdminApp() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [needsOrg, setNeedsOrg] = useState(false);
  const [identity, setIdentity] = useState<Identity>();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<TreeNode>();
  const [tab, setTab] = useState<Tab>("harness");
  const assetTab = ASSET_TABS.includes(tab);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<TabResult>();
  /* The six asset tabs share one eager fetch, independent of which of them
     is open — the sub-sidebar's unshared-count marker needs every kind's
     data whether or not that kind's tab has ever been opened for this unit
     (docs/scoping.md §8). */
  const [assetsResult, setAssetsResult] = useState<AssetsResult>({ status: "loading" });
  /* Keyed by asset id. Populated only for rows this unit owns — an inherited
     row offers no scope control, so nothing here is ever fetched for one
     (docs/scoping.md §6). */
  const [scopesByAsset, setScopesByAsset] = useState<Record<string, AssetScopeRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    status?: number;
  } | null>(null);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [rotateKey, setRotateKey] = useState<ApiKey>();
  /* The asset screen is open on an id, not on a row: the row is read back from
     the reloaded list, so restoring a version or disabling the asset updates
     what is on screen instead of leaving a stale snapshot. */
  const [viewingId, setViewingId] = useState<string>();
  const [pane, setPane] = useState<Pane>("document");
  /* The harness screen holds the row itself: the tiles list is the payload
     for the tab, and a harness is small enough to carry. */
  const [openHarness, setOpenHarness] = useState<Harness>();
  const [newHarness, setNewHarness] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [cliToken, setCliToken] = useState("");
  const loadSequence = useRef(0);
  const assetsSequence = useRef(0);
  const leaving = useRef(false);

  const fail = useCallback((cause: unknown) => {
    setError({
      message: cause instanceof Error ? cause.message : String(cause),
      status: cause instanceof ApiError ? cause.status : undefined,
    });
  }, []);

  const logout = useCallback(async () => {
    leaving.current = true;
    await supabase.auth.signOut();
    setSignedIn(false);
    setNeedsOrg(false);
    setIdentity(undefined);
    setSelected(undefined);
    setTree([]);
    router.replace("/");
  }, [router]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      try {
        return await request<T>(path, init);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) void logout();
        throw cause;
      }
    },
    [logout],
  );

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIdentity(await api<Identity>("/v1/me"));
      setNeedsOrg(false);
      /* `/v1/tree` answers with the single visible root, or with a parentless
         `{children: […]}` wrapper when more than one root is visible. */
      const root = await api<Partial<TreeNode> & { children?: TreeNode[] }>("/v1/tree");
      const roots = root.id ? [root as TreeNode] : (root.children ?? []);
      setTree(roots);
      setSelected((current) => current ?? roots[0]);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setNeedsOrg(true);
        return;
      }
      fail(cause);
    } finally {
      setLoading(false);
    }
  }, [api, fail]);

  useEffect(() => {
    if (needsOrg) router.replace("/login");
  }, [needsOrg, router]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = Boolean(session);
      setSignedIn(next);
      setAuthReady(true);
      if (next) void loadWorkspace();
      else if (!leaving.current) router.replace("/login");
    });
    return () => data.subscription.unsubscribe();
  }, [loadWorkspace, router]);

  /* The remaining tabs each own one endpoint, so the key is just the tab —
     the six asset kinds no longer pass through here at all (below). */
  const loadTab = useCallback(() => {
    if (!selected || assetTab) return;
    const sequence = ++loadSequence.current;
    const key = `${selected.id}:${tab}`;
    const unit = encodeURIComponent(selected.id);
    const paths: Record<string, string> = {
      harness: `/v1/org-units/${unit}/harnesses`,
      boundary: `/v1/org-units/${unit}/boundary`,
      keys: `/v1/org-units/${unit}/api-keys`,
      invites: `/v1/org-units/${unit}/invites`,
      audit: `/v1/org-units/${unit}/audit`,
    };
    /* The key makes a late reply for a tab you have left harmless, and the
       sequence stops it from overwriting the reply you are now waiting on. */
    api<unknown>(paths[tab])
      .then((value) => {
        if (sequence === loadSequence.current) setResult({ key, status: "ready", value });
      })
      .catch((cause: unknown) => {
        if (sequence !== loadSequence.current) return;
        setResult({
          key,
          status: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          code: cause instanceof ApiError ? cause.status : undefined,
        });
      });
  }, [api, tab, assetTab, selected]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => loadTab());
    return () => window.cancelAnimationFrame(frame);
  }, [loadTab, selected]);

  /* Eager, per unit rather than per tab: the sub-sidebar's unshared-count
     marker (docs/scoping.md §8) needs every asset kind's data before any of
     the six asset tabs has necessarily been opened for this unit. */
  const loadAssets = useCallback(() => {
    if (!selected) return;
    const sequence = ++assetsSequence.current;
    setAssetsResult({ status: "loading" });
    api<unknown>(`/v1/org-units/${encodeURIComponent(selected.id)}/assets`)
      .then((value) => {
        if (sequence !== assetsSequence.current) return;
        const assets = list<Asset>(value);
        setAssetsResult({ status: "ready", assets });
        /* Only owned rows ever get a scope control (docs/scoping.md §6), so
           this is the entire set of assets that endpoint will ever be asked
           about for this unit. `allSettled`, not `all`: one asset this
           caller cannot read scopes for must not blank out every other
           badge. */
        const owned = assets.filter((asset) => isOwnedHere(asset) && asset.status === "active");
        Promise.allSettled(
          owned.map(async (asset) => {
            const rows = await api<AssetScopeRow[]>(
              `/v1/assets/${encodeURIComponent(asset.id)}/scopes`,
            );
            return [asset.id, rows] as const;
          }),
        ).then((settled) => {
          if (sequence !== assetsSequence.current) return;
          const fulfilled = settled.flatMap((entry) =>
            entry.status === "fulfilled" ? [entry.value] : [],
          );
          setScopesByAsset(Object.fromEntries(fulfilled));
        });
      })
      .catch((cause: unknown) => {
        if (sequence !== assetsSequence.current) return;
        setAssetsResult({
          status: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          code: cause instanceof ApiError ? cause.status : undefined,
        });
      });
  }, [api, selected]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => loadAssets());
    return () => window.cancelAnimationFrame(frame);
  }, [loadAssets, selected]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      await api("/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({
          org_unit_id: selected.id,
          name: form.get("name"),
          value: form.get("value"),
          kind: form.get("kind"),
          env_var: form.get("env_var"),
        }),
      });
      setShowCreateKey(false);
      loadTab();
    } catch (cause) {
      fail(cause);
    }
  }

  async function rotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rotateKey) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      await api(`/v1/api-keys/${encodeURIComponent(rotateKey.id)}/rotate`, {
        method: "POST",
        body: JSON.stringify({ value: form.get("value") }),
      });
      setRotateKey(undefined);
      loadTab();
    } catch (cause) {
      fail(cause);
    }
  }

  async function mintCliToken() {
    try {
      const created = await api<{ token: string }>("/v1/personal-access-tokens", {
        method: "POST",
        body: JSON.stringify({ name: "CLI" }),
      });
      setCliToken(created.token);
    } catch (cause) {
      fail(cause);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const admin = form.get("admin") === "on";
    setError(null);
    try {
      await api(`/v1/org-units/${encodeURIComponent(selected.id)}/invites`, {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          admin_level: admin ? "admin" : null,
          admin_unit_id: admin ? selected.id : null,
        }),
      });
      element.reset();
      loadTab();
    } catch (cause) {
      fail(cause);
    }
  }

  async function revokeInvite(invite: Invite) {
    try {
      await api(`/v1/invites/${encodeURIComponent(invite.id)}`, {
        method: "DELETE",
      });
      loadTab();
    } catch (cause) {
      fail(cause);
    }
  }

  if (!authReady || !signedIn || needsOrg) return <main className="min-h-screen bg-canvas" />;

  const nodes = flatten(tree);
  /* HERE (docs/scoping.md §7): the chain from the top of what this session
     can see down to the selected unit, so drilling into a descendant does
     not strand the admin with no way back up. */
  const hereTrail = selected
    ? [...(nodes.find((entry) => entry.node.id === selected.id)?.trail ?? []), selected]
    : [];
  /* SCOPED TO: every descendant at any depth, for the counter beside the
     heading — the tree itself renders through `TreeItem`'s own recursion. */
  const scopedToNodes = selected
    ? nodes.filter(({ trail }) => trail.some((ancestor) => ancestor.id === selected.id))
    : [];

  function selectUnit(node: TreeNode) {
    setSelected(node);
    setViewingId(undefined);
    setOpenHarness(undefined);
    setSearch("");
  }

  /* Derived rather than stored: a result for another tab reads as "loading"
     instead of leaking into the panel for one frame. */
  const tabKey = selected ? `${selected.id}:${tab}` : "";
  const state: TabResult = result?.key === tabKey ? result : { key: tabKey, status: "loading" };
  /* The six asset tabs read `assetsResult` (eager, per unit); every other
     tab reads `state` (lazy, per tab) as before. One pair of variables so
     the render below does not have to branch on `assetTab` at every use. */
  const panelStatus = assetTab ? assetsResult.status : state.status;
  const panelMessage = assetTab
    ? assetsResult.status === "failed"
      ? assetsResult.message
      : ""
    : state.status === "failed"
      ? state.message
      : "";
  const panelCode = assetTab
    ? assetsResult.status === "failed"
      ? assetsResult.code
      : undefined
    : state.status === "failed"
      ? state.code
      : undefined;
  const reload = assetTab ? loadAssets : loadTab;
  /* `state.status === "ready"` here, not `panelStatus`, so the discriminated
     union narrows: an asset tab never reads this (it reads `assets` below),
     and every other tab's `panelStatus` is `state.status` by construction. */
  const stateValue = state.status === "ready" ? state.value : undefined;
  const allAssets = assetsResult.status === "ready" ? assetsResult.assets : [];
  const assets = assetTab ? allAssets.filter((asset) => asset.kind === tab) : [];
  const viewing = assets.find((asset) => asset.id === viewingId);
  const tabLabel = TABS.find(({ id }) => id === tab)?.label ?? "";
  /* The sub-sidebar marker (docs/scoping.md §8): how many of this unit's own
     assets, of each kind, nobody below can use yet. Only meaningful once
     `scopesByAsset` has an entry for a given owned asset, so a kind whose
     scopes are still loading undercounts rather than flashing a wrong
     number. */
  const unsharedByKind = ASSET_TABS.reduce<Partial<Record<Tab, number>>>((counts, kind) => {
    const count = allAssets.filter(
      (asset) =>
        asset.kind === kind &&
        isOwnedHere(asset) &&
        asset.status === "active" &&
        scopesByAsset[asset.id]?.length === 0,
    ).length;
    if (count > 0) counts[kind] = count;
    return counts;
  }, {});

  function openTab(next: Tab) {
    setTab(next);
    setViewingId(undefined);
    setOpenHarness(undefined);
    setSearch("");
  }

  function openAsset(asset: Asset, next: Pane) {
    setViewingId(asset.id);
    setPane(next);
  }

  return (
    <div className="grid min-h-screen grid-cols-[220px_216px_1fr] grid-rows-[52px_1fr] max-md:grid-cols-1 max-md:grid-rows-[52px_auto_auto_1fr]">
      <header className="z-20 col-span-full flex items-center gap-4 border-b border-line bg-canvas px-4 text-fg max-md:col-span-1 max-md:row-start-1">
        <Link href="/" aria-label="Harness">
          <BrandMark small />
        </Link>
        <div className="ml-auto">
          <ProfileMenu
            identity={identity}
            onMintCli={() => void mintCliToken()}
            onLogout={() => void logout()}
          />
        </div>
      </header>

      {/* Here, then below (docs/scoping.md §7): not org-versus-teams, which
          breaks the moment an org contains an org — HERE is whichever unit is
          selected, at any depth, and SCOPED TO is its descendants. Selecting
          one re-roots both regions on it, so an org admin and a team admin
          see the same two-region shape. */}
      <aside className="overflow-y-auto border-r border-line bg-sunken px-3 py-5 max-md:row-start-2 max-md:max-h-64 max-md:border-r-0 max-md:border-b max-md:py-3">
        <h2 className="mb-1 px-2 text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
          Here
        </h2>
        {hereTrail.length ? (
          <nav aria-label="This unit" className="mb-5">
            <ul className="m-0 list-none p-0">
              {hereTrail.map((node, index) => (
                <li key={node.id} style={{ paddingLeft: `${index * 10}px` }}>
                  <Button
                    variant="bare"
                    size="none"
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left ${
                      node.id === selected?.id
                        ? "bg-surface ring-1 ring-line ring-inset"
                        : "hover:bg-canvas"
                    }`}
                    onClick={() => selectUnit(node)}
                  >
                    <span
                      className={`truncate text-[13px] ${
                        node.id === selected?.id ? "font-bold" : "font-medium"
                      }`}
                    >
                      {node.name}
                    </span>
                    {node.role && (
                      <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-faint uppercase">
                        {node.role}
                      </span>
                    )}
                  </Button>
                  {/* The top of what this session can see is the boundary of
                      what it administers — always true of the tree's own
                      root, not a claim about this particular person. */}
                  {index === 0 && (
                    <p className="mt-0.5 px-2 font-mono text-[10px] text-faint">admin scope</p>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          !loading && <EmptyState>No org units are visible to you.</EmptyState>
        )}

        {selected && (
          <>
            <div className="mb-2 flex items-baseline justify-between gap-2 px-2">
              <h2 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
                Scoped to
              </h2>
              <span className="font-mono text-[10px] text-faint">{scopedToNodes.length}</span>
            </div>
            {selected.children?.length ? (
              <nav aria-label="Units this unit can share with">
                <ul className="m-0 list-none p-0">
                  {selected.children.map((node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      selectedId={selected.id}
                      onSelect={selectUnit}
                    />
                  ))}
                </ul>
              </nav>
            ) : (
              <p className="px-2 font-mono text-[11px] text-faint">
                Nothing beneath this unit yet.
              </p>
            )}
          </>
        )}
      </aside>

      {/* The sub-sidebar (docs/scoping.md §8): a vertical column grouped into
          what this unit has and how it behaves, with room for the marker a
          horizontal strip of eleven tabs never had space for. */}
      <nav
        aria-label="Sections"
        className="overflow-y-auto border-r border-line bg-sunken px-3 py-5 max-md:row-start-3 max-md:border-r-0 max-md:border-b"
      >
        {TAB_GROUPS.map((section, index) => (
          <div key={section.heading} className={index > 0 ? "mt-6" : undefined}>
            <h2 className="mb-1 px-2 text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
              {section.heading}
            </h2>
            <ul className="m-0 list-none p-0">
              {section.tabs.map((id) => {
                const label = TABS.find((entry) => entry.id === id)?.label ?? id;
                const marker = unsharedByKind[id];
                return (
                  <li key={id}>
                    <Button
                      variant="bare"
                      size="none"
                      role="tab"
                      aria-selected={tab === id}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold ${
                        tab === id
                          ? "bg-surface text-fg ring-1 ring-line ring-inset"
                          : "text-muted hover:bg-canvas hover:text-fg"
                      }`}
                      onClick={() => openTab(id)}
                    >
                      <span className="truncate">{label}</span>
                      {marker !== undefined && <Badge tone="warn">{marker}</Badge>}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <main className="grid min-w-0 grid-rows-[auto_1fr] bg-canvas max-md:row-start-4">
        <div className="sticky top-0 z-10 flex min-w-0 items-center gap-4 border-b border-line bg-canvas px-[clamp(20px,3.5vw,44px)] py-3.5">
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.02em]">
            {tabLabel}
          </h1>
          <span className="flex shrink-0 items-center gap-2">
            {selected && !viewing && !openHarness && tab !== "boundary" && (
              <HeaderSearch
                key={tab}
                value={search}
                onValueChange={setSearch}
                placeholder={`search ${tabLabel.toLowerCase()}…`}
              />
            )}
            <Button
              size="icon"
              onClick={() => setShowDocs(true)}
              aria-label={`What ${tabLabel} means`}
              title={`What ${tabLabel} means`}
            >
              ?
            </Button>
          </span>
        </div>

        <div className="min-w-0 px-[clamp(20px,3.5vw,44px)] pb-16">
          {!selected && (
            <div className="pt-6">
              <Notice>
                Select an org unit to inspect its assets, boundary, connectors, and audit trail.
              </Notice>
            </div>
          )}

          {error && (
            <div className="pt-5">
              <Alert>
                <span>{error.message}</span>
                <Button
                  variant="bare"
                  size="none"
                  className="underline"
                  onClick={() => setError(null)}
                >
                  Dismiss
                </Button>
              </Alert>
            </div>
          )}

          {selected && panelStatus === "loading" && <EmptyState>Loading…</EmptyState>}

          {selected && panelStatus === "failed" && (
            <div className="pt-5">
              {panelCode === 403 ? (
                <Notice tone="hold">
                  <strong className="font-semibold text-fg">Administrator access required</strong>
                  <p className="mt-0.5">{panelMessage}</p>
                </Notice>
              ) : (
                <Alert>
                  <span>{panelMessage}</span>
                  <Button variant="bare" size="none" className="underline" onClick={reload}>
                    Retry
                  </Button>
                </Alert>
              )}
            </div>
          )}

          {selected && panelStatus === "ready" && viewing && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
                <Button size="sm" onClick={() => setViewingId(undefined)}>
                  ← {tabLabel}
                </Button>
                <h1 className="text-[17px] font-bold tracking-[-0.02em]">{viewing.name}</h1>
                <KindTag kind={viewing.kind} />
                <Badge tone={isOwnedHere(viewing) ? "accent" : "neutral"}>
                  {isOwnedHere(viewing) ? "owned" : "available"}
                </Badge>
                {!isOwnedHere(viewing) && (
                  <Mono title={viewing.org_unit_path}>{branchPath(viewing.org_unit_path)}</Mono>
                )}
                <Badge tone={STATUS_TONE[viewing.status ?? ""] ?? "neutral"}>
                  {STATUS_LABEL[viewing.status ?? ""] ?? viewing.status ?? "unknown"}
                </Badge>
                <span className="ml-auto flex gap-2">
                  {(["document", "manage"] as Pane[]).map((id) => (
                    <Button
                      key={id}
                      variant="none"
                      size="sm"
                      aria-current={pane === id}
                      className={`border capitalize ${
                        pane === id
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line bg-surface text-muted hover:text-fg"
                      }`}
                      onClick={() => setPane(id)}
                    >
                      {id}
                    </Button>
                  ))}
                </span>
              </div>
              {pane === "document" ? (
                <AssetDocument
                  key={`${viewing.id}:document`}
                  asset={viewing}
                  api={api}
                  onChanged={loadAssets}
                  onError={fail}
                />
              ) : (
                <AssetManage
                  key={`${viewing.id}:manage`}
                  asset={viewing}
                  unit={selected}
                  api={api}
                  units={nodes}
                  onChanged={loadAssets}
                  onError={fail}
                />
              )}
            </>
          )}

          {selected && panelStatus === "ready" && !viewing && (
            <div key={tab}>
              {tab === "harness" &&
                (openHarness ? (
                  <>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
                      <Button size="sm" onClick={() => setOpenHarness(undefined)}>
                        ← Harnesses
                      </Button>
                    </div>
                    <HarnessScreen
                      key={openHarness.id}
                      harness={openHarness}
                      unit={selected}
                      api={api}
                      onChanged={loadTab}
                      onClosed={() => setOpenHarness(undefined)}
                      onError={fail}
                    />
                  </>
                ) : (
                  <HarnessTiles
                    harnesses={list<Harness>(stateValue)}
                    unit={selected}
                    query={search}
                    onOpen={setOpenHarness}
                    onCreate={() => setNewHarness(true)}
                  />
                ))}
              {tab === "keys" && (
                <ModelDefaultRow
                  unit={selected}
                  api={api}
                  onChanged={loadTab}
                  onError={fail}
                  onAddKey={() => setShowCreateKey(true)}
                />
              )}
              {assetTab && (
                <AssetsPanel
                  assets={assets}
                  noun={tabLabel.toLowerCase()}
                  query={search}
                  unit={selected}
                  nodes={nodes}
                  scopesByAsset={scopesByAsset}
                  api={api}
                  onOpen={openAsset}
                  onScoped={(assetId, rows) =>
                    setScopesByAsset((current) => ({ ...current, [assetId]: rows }))
                  }
                  onError={fail}
                />
              )}
              {tab === "boundary" && (
                <BoundaryPanel boundary={stateValue as BoundaryView | undefined} />
              )}
              {tab === "keys" && (
                <KeysPanel
                  keys={list<ApiKey>(stateValue)}
                  query={search}
                  onCreate={() => setShowCreateKey(true)}
                  onRotate={setRotateKey}
                />
              )}
              {tab === "invites" && (
                <InvitesPanel
                  unit={selected}
                  invites={list<Invite>(stateValue)}
                  query={search}
                  onInvite={createInvite}
                  onRevoke={(invite) => void revokeInvite(invite)}
                />
              )}
              {tab === "audit" && (
                <AuditPanel events={list<AuditEvent>(stateValue)} query={search} />
              )}
            </div>
          )}
        </div>
      </main>

      {showDocs && (
        <Modal title={tabLabel} onClose={() => setShowDocs(false)}>
          {/* What it is, then something it is for, then what we do with it.
              Readers arrive with one of those three questions. */}
          <div className="grid gap-5 p-5">
            <div>
              <p className="text-[15px] leading-snug font-semibold">{HELP[tab].summary}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{HELP[tab].what}</p>
            </div>
            <section className="rounded-lg border border-line bg-sunken p-4">
              <h3 className="text-[10px] font-bold tracking-[0.1em] text-accent uppercase">
                For example
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed">{HELP[tab].example}</p>
            </section>
            <section>
              <h3 className="text-[10px] font-bold tracking-[0.1em] text-muted uppercase">
                How it works here
              </h3>
              <ul className="mt-2.5 m-0 grid list-none gap-2.5 p-0">
                {HELP[tab].mechanics.map((item) => (
                  <li key={item} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
                    <span aria-hidden className="mt-[7px]">
                      <Dot tone="accent" />
                    </span>
                    <span className="text-[13px] leading-relaxed text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Modal>
      )}

      {newHarness && selected && (
        <HarnessDialog
          unit={selected}
          api={api}
          onClose={() => setNewHarness(false)}
          onSaved={(harness) => {
            setNewHarness(false);
            loadTab();
            setOpenHarness(harness);
          }}
          onError={fail}
        />
      )}

      {showCreateKey && (
        <Modal title="Add connector" onClose={() => setShowCreateKey(false)}>
          <form className="grid gap-4 p-5" onSubmit={createKey}>
            <Field
              label="Friendly name"
              name="name"
              required
              placeholder="Production CRM"
              autoFocus
            />
            <Field
              label="Secret value"
              name="value"
              type="password"
              required
              placeholder="Paste secret value"
              hint="Stored encrypted. Only the last four characters are ever shown again."
            />
            <Field
              label="Environment variable"
              name="env_var"
              required
              placeholder="CRM_API_KEY"
              pattern="[A-Z_][A-Z0-9_]*"
              hint="Upper snake case — the name the harness injects at run time."
            />
            <Field label="Connector kind">
              <select name="kind" defaultValue="static_api_key" className={CONTROL_CLASS}>
                <option value="static_api_key">System</option>
                <option value="provider_api_key">Model provider</option>
              </select>
            </Field>
            <div className="mt-1 flex justify-end gap-2">
              <Button onClick={() => setShowCreateKey(false)}>Cancel</Button>
              <Button variant="primary" type="submit">
                Save connector
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {rotateKey && (
        <Modal title={`Rotate ${rotateKey.name}`} onClose={() => setRotateKey(undefined)}>
          <form className="grid gap-4 p-5" onSubmit={rotate}>
            <Notice tone="accent">
              The new value takes over under the same stable reference
              {rotateKey.ref && (
                <>
                  {" "}
                  <Chip>{rotateKey.ref}</Chip>
                </>
              )}
              , so nothing that resolves it needs to change. The prior version can remain in its
              server-configured grace period.
            </Notice>
            <Field
              label="New secret value"
              name="value"
              type="password"
              required
              autoFocus
              placeholder="Paste new value"
            />
            <div className="mt-1 flex justify-end gap-2">
              <Button onClick={() => setRotateKey(undefined)}>Cancel</Button>
              <Button variant="primary" type="submit">
                Rotate
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {cliToken && (
        <Modal title="Connect the CLI" onClose={() => setCliToken("")}>
          <div className="grid gap-5 p-5">
            <p className="text-[13px] leading-relaxed text-muted">
              Two commands and you are set up for good. Skip the first if you already have{" "}
              <Chip>harness</Chip>.
            </p>
            <CommandBlock label="1 · Install" command={INSTALL_COMMAND} hint="once per machine" />
            <CommandBlock
              label="2 · Connect"
              command={`harness login --api-url ${API_URL} --token ${cliToken}`}
              hint="once — it stays signed in"
            />
            <p className="text-xs leading-relaxed text-muted">
              You will not need to do this again on this machine. From now on just run{" "}
              <Chip>harness run</Chip>, or <Chip>harness --help</Chip> to see everything else. The
              token above is shown once — if you lose it before connecting, come back and make
              another.
            </p>
            {SHOW_RESET && (
              <div className="min-w-0 border-t border-line pt-4">
                <CommandBlock label="Start over" command={RESET_COMMAND} hint="development only" />
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  Removes the CLI, your credentials, and your local copy of the team&apos;s assets.
                  Anything you pushed is safe — it lives on the server.
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
