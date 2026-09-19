"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, list, request } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  ApiKey,
  Asset,
  AssetScope,
  AuditEvent,
  BoundaryPolicy,
  BoundaryView,
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
  { id: "harness", label: "Harnesses" },
  { id: "system_prompt", label: "System prompts" },
  { id: "memory", label: "Memories" },
  { id: "skill", label: "Skills" },
  { id: "prompt", label: "Prompts" },
  { id: "tool", label: "Tools" },
  { id: "connection", label: "Connections" },
  { id: "boundary", label: "Boundary" },
  { id: "keys", label: "Connectors" },
  { id: "invites", label: "Invites" },
  { id: "audit", label: "Audit" },
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

const LOAD_LABEL: Record<string, string> = {
  on_demand: "On demand",
  always: "Always",
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

/** Depth-first with each node's ancestors, for breadcrumbs and unit pickers. */
function flatten(
  nodes: TreeNode[],
  trail: TreeNode[] = [],
): { node: TreeNode; trail: TreeNode[] }[] {
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
function branchPath(path?: string) {
  return path?.split(".").join(" / ") ?? "—";
}

function isOwnedHere(asset: Asset) {
  return (asset.origin ?? "owned") === "owned";
}

function isInventoryTab(tab: Tab) {
  return tab === "harness" || ASSET_TABS.includes(tab);
}

/** One control: a switch whose label is the mode you are in. */
function ScopeToggle({
  scope,
  onToggle,
}: {
  scope: AssetScope;
  onToggle: () => void;
}) {
  const available = scope === "available";
  return (
    <Button
      variant="none"
      size="none"
      role="switch"
      aria-checked={available}
      aria-label={available ? "Available. Switch to owned." : "Owned. Switch to available."}
      title={available ? "Switch to owned" : "Switch to available"}
      className="items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 hover:border-accent"
      onClick={onToggle}
    >
      <span
        aria-hidden
        className={`relative h-4 w-7 rounded-full transition-colors ${
          available ? "bg-accent" : "bg-line"
        }`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-surface shadow-sm transition-[left] ${
            available ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
      <span className="text-xs font-semibold">{available ? "Available" : "Owned"}</span>
    </Button>
  );
}

/* The asset tabs are one collection split by kind, so they share a request
   and switching between them costs nothing. */
function groupOf(tab: Tab) {
  return ASSET_TABS.includes(tab) ? "assets" : tab;
}

function tabKeyFor(unitId: string, tab: Tab) {
  return `${unitId}:${groupOf(tab)}`;
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

function AssetsPanel({
  assets,
  noun,
  query,
  scope,
  onOpen,
}: {
  assets: Asset[];
  noun: string;
  query: string;
  scope: AssetScope;
  onOpen: (asset: Asset, pane: Pane) => void;
}) {
  const scoped = assets.filter((asset) =>
    scope === "owned" ? isOwnedHere(asset) : !isOwnedHere(asset),
  );
  const shown = scoped.filter((asset) =>
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
      <Toolbar count={query ? counter(shown.length, scoped.length) : String(scoped.length)} />
      {ordered.length ? (
        <Table
          head={["Name", "Ownership", "Path", "Version", "Message", "Updated", "Harnesses", "Status", ""]}
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
                <Badge tone={isOwnedHere(asset) ? "accent" : "neutral"}>
                  {isOwnedHere(asset) ? "owned" : "available"}
                </Badge>
              </Td>
              <Td>
                <Mono title={asset.org_unit_path}>{branchPath(asset.org_unit_path)}</Mono>
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
          {scoped.length
            ? `No ${noun} match “${query}”.`
            : scope === "owned"
              ? `No ${noun} are owned by this unit.`
              : `No ${noun} are available from above or below.`}
        </EmptyState>
      )}
    </>
  );
}

export function ControlRow({
  label,
  hint,
  setHere,
  children,
}: {
  label: string;
  hint: string;
  setHere: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,19rem)_minmax(0,1fr)] items-start gap-x-6 gap-y-2 border-b border-hairline py-3.5 max-sm:grid-cols-1">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">{label}</span>
          <Badge tone={setHere ? "accent" : "neutral"}>{setHere ? "set here" : "inherited"}</Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
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

  return (
    <div className="pt-2">
      <ControlRow
        label="Network egress"
        hint="Hosts the harness may reach. The chain is intersected, so a parent can never be widened."
        setHere={setHere("egress_allowlist")}
      >
        <Allowlist values={effective.egress_allowlist} />
      </ControlRow>
      <ControlRow
        label="Allowed connections"
        hint="Connection assets a skill may require by name. The chain is intersected here too."
        setHere={setHere("connector_allowlist")}
      >
        <Allowlist values={effective.connector_allowlist} />
      </ControlRow>
      <ControlRow
        label="Deploy approval"
        hint="Whether a version must be approved before it can be promoted."
        setHere={setHere("approvals")}
      >
        <Switch
          on={effective.approvals?.deploy === "required"}
          onLabel="Required"
          offLabel="Not required"
        />
      </ControlRow>
      <ControlRow
        label="Asset loading"
        hint="How assets reach a session. A prescribed policy cannot be changed further down."
        setHere={setHere("load_policy")}
      >
        <span className="inline-flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            {LOAD_LABEL[effective.load_policy?.default ?? ""] ?? "On demand"}
          </Badge>
          {effective.load_policy?.prescribed && <Badge tone="accent">prescribed</Badge>}
        </span>
      </ControlRow>
      <ControlRow
        label="Push review"
        hint="Whether a pushed version waits for review before it becomes the head."
        setHere={setHere("build_policy")}
      >
        <Switch
          on={Boolean(effective.build_policy?.push_review)}
          onLabel="Required"
          offLabel="Not required"
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
  const [assetScope, setAssetScope] = useState<AssetScope>("owned");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<TabResult>();
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

  /* Keyed on the group, not the tab, so the five asset tabs read one reply
     and switching between them does not go back to the server. */
  const group = groupOf(tab);
  const loadTab = useCallback(() => {
    if (!selected) return;
    const sequence = ++loadSequence.current;
    const key = `${selected.id}:${group}`;
    const unit = encodeURIComponent(selected.id);
    const paths: Record<string, string> = {
      assets: `/v1/org-units/${unit}/assets`,
      harness: `/v1/org-units/${unit}/harnesses`,
      boundary: `/v1/org-units/${unit}/boundary`,
      keys: `/v1/org-units/${unit}/api-keys`,
      invites: `/v1/org-units/${unit}/invites`,
      audit: `/v1/org-units/${unit}/audit`,
    };
    /* The key makes a late reply for a tab you have left harmless, and the
       sequence stops it from overwriting the reply you are now waiting on. */
    api<unknown>(paths[group])
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
  }, [api, group, selected]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => loadTab());
    return () => window.cancelAnimationFrame(frame);
  }, [loadTab, selected]);

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
  /* Derived rather than stored: a result for another tab reads as "loading"
     instead of leaking into the panel for one frame. */
  const tabKey = selected ? tabKeyFor(selected.id, tab) : "";
  const state: TabResult = result?.key === tabKey ? result : { key: tabKey, status: "loading" };
  const assetTab = ASSET_TABS.includes(tab);
  const assets =
    assetTab && state.status === "ready"
      ? list<Asset>(state.value).filter((asset) => asset.kind === tab)
      : [];
  const viewing = assets.find((asset) => asset.id === viewingId);
  const tabLabel = TABS.find(({ id }) => id === tab)?.label ?? "";

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
    <div className="grid min-h-screen grid-cols-[264px_1fr] grid-rows-[52px_1fr] max-md:grid-cols-1 max-md:grid-rows-[52px_auto_1fr]">
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

      <aside className="border-r border-line bg-sunken px-3 py-5 max-md:row-start-2 max-md:border-r-0 max-md:border-b max-md:py-3">
        <div className="mb-2 flex items-baseline justify-between gap-2 px-2">
          <h2 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">
            Organization
          </h2>
          <span className="font-mono text-[10px] text-faint">
            {nodes.length} {nodes.length === 1 ? "unit" : "units"}
          </span>
        </div>
        {tree.length ? (
          <nav aria-label="Organization units">
            <ul className="m-0 list-none p-0 max-md:max-h-48 max-md:overflow-y-auto">
              {tree.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedId={selected?.id}
                  onSelect={(node) => {
                    setSelected(node);
                    setViewingId(undefined);
                    setOpenHarness(undefined);
                    setAssetScope("owned");
                    setSearch("");
                  }}
                />
              ))}
            </ul>
          </nav>
        ) : (
          !loading && <EmptyState>No org units are visible to you.</EmptyState>
        )}
      </aside>

      <main className="grid min-w-0 grid-rows-[auto_1fr] bg-canvas max-md:row-start-3">
        {/* The tab strip is the page header. Which unit you are in, and what
            the page means, are both a button away rather than on the page. */}
        <div className="sticky top-0 z-10 min-w-0 border-b border-line bg-canvas px-[clamp(20px,3.5vw,44px)]">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex min-w-0 flex-1 items-stretch gap-6 overflow-x-auto" role="tablist">
              {TABS.map(({ id, label }) => (
                <span key={id} className="flex shrink-0 items-stretch gap-6">
                  {/* Asset kinds on one side, the unit's own settings on the
                      other. */}
                  {(id === "boundary" || id === "system_prompt") && (
                    <span aria-hidden className="my-3 w-px bg-line" />
                  )}
                  <Button
                    variant="bare"
                    size="none"
                    role="tab"
                    aria-selected={tab === id}
                    className={`-mb-px rounded-none border-b-2 px-0.5 py-3 text-[13px] font-semibold ${
                      tab === id
                        ? "border-accent text-fg"
                        : "border-transparent text-muted hover:text-fg"
                    }`}
                    onClick={() => openTab(id)}
                  >
                    {label}
                  </Button>
                </span>
              ))}
            </div>
            <span className="flex shrink-0 items-center gap-2 py-2">
              {selected && isInventoryTab(tab) && !viewing && !openHarness && (
                <ScopeToggle
                  scope={assetScope}
                  onToggle={() =>
                    setAssetScope((current) => (current === "owned" ? "available" : "owned"))
                  }
                />
              )}
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

          {selected && state.status === "loading" && <EmptyState>Loading…</EmptyState>}

          {selected && state.status === "failed" && (
            <div className="pt-5">
              {state.code === 403 ? (
                <Notice tone="hold">
                  <strong className="font-semibold text-fg">Administrator access required</strong>
                  <p className="mt-0.5">{state.message}</p>
                </Notice>
              ) : (
                <Alert>
                  <span>{state.message}</span>
                  <Button variant="bare" size="none" className="underline" onClick={loadTab}>
                    Retry
                  </Button>
                </Alert>
              )}
            </div>
          )}

          {selected && state.status === "ready" && viewing && (
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
                  onChanged={loadTab}
                  onError={fail}
                />
              ) : (
                <AssetManage
                  key={`${viewing.id}:manage`}
                  asset={viewing}
                  unit={selected}
                  api={api}
                  units={nodes}
                  onChanged={loadTab}
                  onError={fail}
                />
              )}
            </>
          )}

          {selected && state.status === "ready" && !viewing && (
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
                    harnesses={list<Harness>(state.value)}
                    unit={selected}
                    query={search}
                    scope={assetScope}
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
                  scope={assetScope}
                  onOpen={openAsset}
                />
              )}
              {tab === "boundary" && (
                <BoundaryPanel boundary={state.value as BoundaryView | undefined} />
              )}
              {tab === "keys" && (
                <KeysPanel
                  keys={list<ApiKey>(state.value)}
                  query={search}
                  onCreate={() => setShowCreateKey(true)}
                  onRotate={setRotateKey}
                />
              )}
              {tab === "invites" && (
                <InvitesPanel
                  unit={selected}
                  invites={list<Invite>(state.value)}
                  query={search}
                  onInvite={createInvite}
                  onRevoke={(invite) => void revokeInvite(invite)}
                />
              )}
              {tab === "audit" && (
                <AuditPanel events={list<AuditEvent>(state.value)} query={search} />
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
