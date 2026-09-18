"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { accessToken, supabase } from "@/lib/supabase";

type JsonRecord = Record<string, unknown>;
type Tab = "assets" | "boundary" | "keys" | "members" | "audit";

interface TreeNode {
  id: string;
  name: string;
  role?: string;
  children?: TreeNode[];
}

interface Asset {
  id: string;
  name: string;
  kind?: string;
  status?: string;
  head_seq?: number;
  head_version_id?: string;
  updated_at?: string;
}

interface ApiKey {
  id: string;
  name: string;
  ref?: string;
  last4?: string;
  version?: number;
  env_var?: string;
  kind?: string;
  status?: string;
  rotated_at?: string;
  created_at?: string;
}

interface AuditEvent {
  id: string;
  action?: string;
  actor?: string;
  actor_name?: string;
  created_at?: string;
  timestamp?: string;
  detail?: string;
  resource?: string;
}

interface Version {
  id: string;
  seq?: number;
  message?: string;
  author_email?: string;
  status?: string;
  created_at?: string;
}

interface Invite {
  id: string;
  email: string;
  accepted_at?: string | null;
  admin_level?: string | null;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError("Please sign in to continue.", 401);
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function records<T>(value: unknown, keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const object = value as JsonRecord;
    for (const key of keys) {
      if (Array.isArray(object[key])) return object[key] as T[];
    }
  }
  return [];
}

/* Presentation ------------------------------------------------------------ */

type ButtonVariant = "default" | "primary" | "accent" | "ghost" | "bare";

const BUTTON_BASE =
  "inline-flex cursor-pointer items-center justify-center rounded-lg text-sm transition duration-150 disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default:
    "border border-line bg-card px-3.5 py-2.5 text-ink hover:border-accent disabled:hover:border-line",
  primary: "border border-ink bg-ink px-3.5 py-2.5 text-white hover:border-accent",
  accent: "border border-accent bg-accent px-3.5 py-2.5 text-white hover:brightness-105",
  ghost:
    "border border-ink-edge bg-transparent px-3.5 py-2.5 text-paper hover:border-accent",
  bare: "bg-transparent",
};

function Button({
  variant = "default",
  full = false,
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  full?: boolean;
}) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${full ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-line bg-card px-3.5 py-3 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/15";

function Field({
  label,
  children,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  children?: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-[13px] font-bold">
      {label}
      {children ?? <input className={INPUT_CLASS} {...props} />}
    </label>
  );
}

/* Statuses are data-driven, so the tone is looked up rather than interpolated
   into a class name — Tailwind only emits classes it can see in the source. */
const BADGE_TONES: Record<string, string> = {
  active: "bg-ok-bg text-ok",
  promoted: "bg-ok-bg text-ok",
  published: "bg-ok-bg text-ok",
};

function Badge({ status }: { status: string }) {
  const tone = BADGE_TONES[status] ?? "bg-paper text-tag";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-2 py-[3px] text-[9px] font-bold tracking-[0.06em] uppercase ${tone}`}
    >
      {status}
    </span>
  );
}

/* The CLI is the product's front door, so the thing you copy has to be the
   thing you run — not a token you then have to assemble a command around. */
const API_URL = process.env.NEXT_PUBLIC_HARNESS_API_URL ?? "http://127.0.0.1:8400";
const INSTALL_COMMAND = process.env.NEXT_PUBLIC_HARNESS_INSTALL ?? "npm install -g @harness/cli";
// Development convenience: removes the CLI and every local trace of it. Set
// NEXT_PUBLIC_HARNESS_SHOW_RESET=false to hide this before shipping.
const SHOW_RESET = process.env.NEXT_PUBLIC_HARNESS_SHOW_RESET !== "false";
const RESET_COMMAND = "npm uninstall -g @harness/cli && rm -rf ~/.harness ~/.config/harness";

function CommandBlock({ label, command, hint }: { label: string; command: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-ink px-3.5 py-3 font-mono text-xs whitespace-pre text-ink-copy">
          {command}
        </code>
        <Button variant={copied ? "accent" : "primary"} className="shrink-0" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-bold tracking-[0.14em] text-accent uppercase">
      {children}
    </p>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
      {children}
    </section>
  );
}

function PanelHeader({
  title,
  hint,
  count,
}: {
  title: string;
  hint: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted max-sm:hidden">{hint}</p>
      </div>
      {count !== undefined && (
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-paper text-xs font-bold text-muted">
          {count}
        </span>
      )}
    </div>
  );
}

function CardRow({ children }: { children: ReactNode }) {
  return (
    <article className="flex items-center gap-4 border-b border-hairline px-6 py-4 last:border-b-0 max-md:flex-wrap max-md:items-start">
      {children}
    </article>
  );
}

function RowMeta({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-muted">{children}</p>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-[13px] text-muted">{children}</div>;
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-warn-line bg-warn-bg px-3.5 py-3 text-xs text-warn">
      {children}
    </div>
  );
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <div
      className={
        small
          ? "grid size-8.5 place-items-center rounded-[9px_9px_4px_9px] bg-accent text-base font-bold text-ink"
          : "grid size-11.5 place-items-center rounded-[13px_13px_5px_13px] bg-ink text-xl font-bold text-paper"
      }
    >
      H
    </div>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-linear-to-br from-paper to-[#e8d6c7] p-6">
      <section className="w-full max-w-[420px] rounded-[18px] border border-ink/10 bg-card/95 p-10 shadow-[0_24px_70px_rgba(43,33,28,0.13)] max-sm:p-7">
        {children}
      </section>
    </main>
  );
}

function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const action =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error: cause } = await action;
    setBusy(false);
    if (cause) setError(cause.message);
  }

  return (
    <AuthShell>
      <BrandMark />
      <div className="mt-4">
        <Eyebrow>Harness</Eyebrow>
      </div>
      <h1 className="mb-1 text-3xl font-bold">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <form className="mt-7 grid gap-4" onSubmit={submit}>
        <Field
          label="Email"
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoFocus
        />
        <Field
          label="Password"
          id="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <Button variant="primary" full type="submit" disabled={busy}>
          {mode === "signin" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      <Button
        full
        className="mt-3"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "Need an account?" : "Have an account?"}
      </Button>
    </AuthShell>
  );
}

function Onboarding({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request("/v1/orgs", {
        method: "POST",
        body: JSON.stringify({
          org_name: form.get("org_name"),
          team_name: form.get("team_name") || "General",
        }),
      });
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-3xl font-bold">Create an organization</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Or ask an admin to invite this email to their team.
      </p>
      <form className="mt-7 grid gap-4" onSubmit={submit}>
        <Field label="Organization name" id="org_name" name="org_name" required autoFocus />
        <Field label="First team" id="team_name" name="team_name" defaultValue="General" />
        {error && <Alert>{error}</Alert>}
        <Button variant="primary" full type="submit">
          Create
        </Button>
      </form>
    </AuthShell>
  );
}

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

  return (
    <li>
      <div
        className={`my-0.5 flex min-h-10.5 items-center rounded-lg pr-2 ${
          selectedId === node.id ? "bg-card shadow-[0_1px_8px_rgba(43,33,28,0.07)]" : ""
        }`}
        /* Depth is data-driven, so the indent stays an inline style. */
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <Button
          variant="bare"
          className="w-6 p-1 text-accent"
          onClick={() => setOpen((value) => !value)}
          aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
          disabled={!hasChildren}
        >
          {hasChildren ? (open ? "⌄" : "›") : "·"}
        </Button>
        <Button
          variant="bare"
          className="flex min-w-0 flex-1 items-center justify-between p-1 text-left"
          onClick={() => onSelect(node)}
        >
          <span className="truncate text-[13px] font-semibold">{node.name}</span>
          {node.role && (
            <small className="ml-2 text-[9px] text-muted uppercase">{node.role}</small>
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

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-10 grid place-items-center bg-ink/60 p-5 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="max-h-[min(720px,90vh)] w-full max-w-[500px] overflow-auto rounded-2xl bg-card shadow-[0_24px_80px_rgba(20,14,11,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="bare" className="px-2 py-1 text-xl" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

/* Application ------------------------------------------------------------- */

export function AdminApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [needsOrg, setNeedsOrg] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<TreeNode>();
  const [tab, setTab] = useState<Tab>("assets");
  const [data, setData] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [rotateKey, setRotateKey] = useState<ApiKey>();
  const [historyAsset, setHistoryAsset] = useState<Asset>();
  const [history, setHistory] = useState<Version[]>([]);
  const [cliToken, setCliToken] = useState("");
  const loadSequence = useRef(0);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSignedIn(false);
    setNeedsOrg(false);
    setSelected(undefined);
    setTree([]);
  }, []);

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
    setError("");
    try {
      await api("/v1/me");
      setNeedsOrg(false);
      const value = await api<unknown>("/v1/tree");
      const nodes = records<TreeNode>(value, ["tree", "roots", "items", "org_units"]);
      const root =
        nodes.length > 0
          ? nodes
          : value && typeof value === "object" && "id" in value
            ? [value as TreeNode]
            : [];
      setTree(root);
      setSelected((current) => current ?? root[0]);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setNeedsOrg(true);
        return;
      }
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = Boolean(session);
      setSignedIn(next);
      if (next) void loadWorkspace();
    });
    return () => data.subscription.unsubscribe();
  }, [loadWorkspace]);

  const loadTab = useCallback(() => {
    if (!selected) return;
    const sequence = ++loadSequence.current;
    const paths: Record<Tab, string> = {
      assets: `/v1/org-units/${encodeURIComponent(selected.id)}/assets`,
      boundary: `/v1/org-units/${encodeURIComponent(selected.id)}/boundary`,
      keys: `/v1/org-units/${encodeURIComponent(selected.id)}/api-keys`,
      members: `/v1/org-units/${encodeURIComponent(selected.id)}/invites`,
      audit: `/v1/org-units/${encodeURIComponent(selected.id)}/audit`,
    };
    setLoading(true);
    setError("");
    setData(undefined);
    api<unknown>(paths[tab])
      .then((value) => {
        if (sequence === loadSequence.current) setData(value);
      })
      .catch((cause: Error) => {
        if (sequence === loadSequence.current) setError(cause.message);
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
  }, [api, selected, tab]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => loadTab());
    return () => window.cancelAnimationFrame(frame);
  }, [loadTab, selected]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setError("");
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
      setError((cause as Error).message);
    }
  }

  async function rotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !rotateKey) return;
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api(`/v1/api-keys/${encodeURIComponent(rotateKey.id)}/rotate`, {
        method: "POST",
        body: JSON.stringify({ value: form.get("value") }),
      });
      setRotateKey(undefined);
      loadTab();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function openHistory(asset: Asset) {
    setHistoryAsset(asset);
    setHistory([]);
    try {
      const value = await api<unknown>(`/v1/assets/${encodeURIComponent(asset.id)}/history`);
      setHistory(records<Version>(value, ["history", "versions", "items"]));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function assetAction(asset: Asset, action: "promote" | "rollback", version?: Version) {
    const message =
      action === "promote"
        ? `Promote ${asset.name}?`
        : `Roll back ${asset.name} to version ${version?.seq ?? version?.id}?`;
    if (!window.confirm(message)) return;
    const targetOrgUnitId =
      action === "promote" ? window.prompt("Enter the destination org-unit ID:") : undefined;
    if (action === "promote" && !targetOrgUnitId) return;
    try {
      await api(`/v1/assets/${encodeURIComponent(asset.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify(
          action === "rollback"
            ? { to_version_id: version?.id }
            : { target_org_unit_id: targetOrgUnitId },
        ),
      });
      if (action === "rollback") setHistoryAsset(undefined);
      loadTab();
    } catch (cause) {
      setError((cause as Error).message);
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
      setError((cause as Error).message);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(`/v1/org-units/${encodeURIComponent(selected.id)}/invites`, {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          admin_level: form.get("admin") === "on" ? "admin" : null,
          admin_unit_id: form.get("admin") === "on" ? selected.id : null,
        }),
      });
      loadTab();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  if (!signedIn) return <Login />;
  if (needsOrg) return <Onboarding onCreated={() => void loadWorkspace()} />;

  const assets = records<Asset>(data, ["assets", "items"]);
  const keys = records<ApiKey>(data, ["api_keys", "keys", "items"]);
  const invites = records<Invite>(data, ["invites", "items"]);
  const events = records<AuditEvent>(data, ["events", "audit", "items"]);

  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr] grid-rows-[65px_1fr] max-md:grid-cols-[1fr] max-md:grid-rows-[58px_auto_1fr]">
      <header className="z-2 col-span-full flex items-center justify-between gap-3 border-b border-ink-line bg-ink px-6 text-paper max-md:row-start-1 max-md:col-span-1">
        <div className="flex items-center gap-3">
          <BrandMark small />
          <div className="leading-tight">
            <strong className="block">Harness</strong>
            <span className="mt-0.5 block text-[11px] text-ink-mute">Admin</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void mintCliToken()}>
            CLI token
          </Button>
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <aside className="border-r border-line bg-paper px-4 py-7 max-md:row-start-2 max-md:border-r-0 max-md:border-b max-md:px-3.5 max-md:py-4">
        <div className="ml-2.5">
          <Eyebrow>Organization</Eyebrow>
          <h2 className="mt-0 mb-5 text-xl font-semibold max-md:mb-2.5">Structure</h2>
        </div>
        {tree.length ? (
          <nav aria-label="Organization units">
            <ul className="m-0 list-none p-0 max-md:max-h-48 max-md:overflow-y-auto">
              {tree.map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                />
              ))}
            </ul>
          </nav>
        ) : (
          !loading && <div className="px-2.5 py-5 text-center text-[13px] text-muted">No organization units found.</div>
        )}
      </aside>

      <main className="min-w-0 px-[clamp(20px,4vw,56px)] pt-9 pb-15 max-md:row-start-3 max-md:pt-6">
        <header className="flex min-h-17 items-center justify-between gap-5 max-sm:items-start">
          <div>
            <Eyebrow>{selected?.role ?? "Organization unit"}</Eyebrow>
            <h1 className="m-0 text-[clamp(28px,4vw,40px)] font-bold tracking-[-0.035em]">
              {selected?.name ?? "Select a unit"}
            </h1>
          </div>
          {tab === "keys" && selected && (
            <Button
              variant="primary"
              className="max-sm:whitespace-nowrap max-sm:px-2.5 max-sm:py-2"
              onClick={() => setShowCreateKey(true)}
            >
              + Add key
            </Button>
          )}
        </header>

        <div
          className="mt-7 flex gap-7 overflow-x-auto border-b border-line max-md:gap-5"
          role="tablist"
        >
          {(["assets", "boundary", "keys", "members", "audit"] as Tab[]).map((item) => (
            <Button
              key={item}
              variant="bare"
              role="tab"
              aria-selected={tab === item}
              className={`-mb-px rounded-none border-b-2 px-px py-3.5 text-[13px] font-semibold ${
                tab === item
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
              onClick={() => setTab(item)}
            >
              {item === "keys" ? "Keys" : item[0].toUpperCase() + item.slice(1)}
            </Button>
          ))}
        </div>

        {error && (
          <Alert>
            <span>{error}</span>
            <Button variant="bare" className="px-2 py-1 text-inherit" onClick={() => setError("")}>
              Dismiss
            </Button>
          </Alert>
        )}
        {loading && <div className="px-6 py-12 text-center text-[13px] text-muted">Loading…</div>}

        {!loading && selected && tab === "assets" && (
          <Panel>
            <PanelHeader
              title="Assets"
              hint="Versioned resources available to this unit."
              count={assets.length}
            />
            {assets.length ? (
              <div>
                {assets.map((asset) => (
                  <CardRow key={asset.id}>
                    <div className="grid size-9.5 shrink-0 place-items-center rounded-[9px] bg-icon-bg font-bold text-icon">
                      {asset.kind?.[0]?.toUpperCase() ?? "A"}
                    </div>
                    <div className="min-w-0 flex-1 max-md:min-w-[calc(100%-55px)]">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-[15px] font-semibold">{asset.name}</h3>
                        {asset.status && <Badge status={asset.status} />}
                      </div>
                      <RowMeta>
                        {asset.kind ?? "Asset"} · Version {asset.head_seq ?? "—"}
                        {asset.updated_at &&
                          ` · Updated ${new Date(asset.updated_at).toLocaleDateString()}`}
                      </RowMeta>
                    </div>
                    <div className="flex gap-2 max-md:w-full max-md:justify-end">
                      <Button onClick={() => openHistory(asset)}>History</Button>
                      <Button variant="accent" onClick={() => assetAction(asset, "promote")}>
                        Promote
                      </Button>
                    </div>
                  </CardRow>
                ))}
              </div>
            ) : (
              <EmptyState>No assets are assigned to this unit.</EmptyState>
            )}
          </Panel>
        )}

        {!loading && selected && tab === "boundary" && (
          <Panel>
            <PanelHeader
              title="Effective boundary"
              hint="Inherited and unit-specific controls returned by the policy service."
            />
            {data ? (
              <pre className="m-0 max-h-150 overflow-auto bg-ink p-6 font-mono text-xs leading-relaxed text-ink-copy">
                {JSON.stringify(data, null, 2)}
              </pre>
            ) : (
              <EmptyState>No boundary is configured.</EmptyState>
            )}
          </Panel>
        )}

        {!loading && selected && tab === "keys" && (
          <Panel>
            <PanelHeader
              title="API keys"
              hint="Secret values stay hidden. Rotation preserves each stable reference."
              count={keys.length}
            />
            {keys.length ? (
              <div>
                {keys.map((key) => (
                  <CardRow key={key.id}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-[15px] font-semibold">{key.name}</h3>
                        <Badge status={key.status ?? "active"} />
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted">
                        {key.ref ?? "Stable reference unavailable"}
                      </p>
                      <RowMeta>
                        Value ending in ••••{key.last4 ?? "—"} · Version {key.version ?? "—"}
                      </RowMeta>
                    </div>
                    <Button onClick={() => setRotateKey(key)}>Rotate</Button>
                  </CardRow>
                ))}
              </div>
            ) : (
              <EmptyState>No keys exist for this unit.</EmptyState>
            )}
          </Panel>
        )}

        {!loading && selected && tab === "members" && (
          <Panel>
            <PanelHeader
              title="Invites"
              hint="Invite an email to this team. They get a workspace after signup."
            />
            {selected.role === "team" ? (
              <form className="grid gap-4 p-6" onSubmit={createInvite}>
                <Field label="Email" name="email" type="email" required />
                <label className="flex items-center gap-2 text-[13px] font-bold">
                  <input name="admin" type="checkbox" className="accent-accent" /> Team admin
                </label>
                <div>
                  <Button variant="primary" type="submit">
                    Send invite
                  </Button>
                </div>
              </form>
            ) : (
              <p className="px-6 py-5 text-sm leading-relaxed text-muted">
                Select a team to invite people.
              </p>
            )}
            {invites.length ? (
              <div>
                {invites.map((invite) => (
                  <CardRow key={invite.id}>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold">{invite.email}</h3>
                      <RowMeta>{invite.accepted_at ? "Accepted" : "Pending"}</RowMeta>
                      {invite.admin_level && <RowMeta>Admin: {invite.admin_level}</RowMeta>}
                    </div>
                    {!invite.accepted_at && (
                      <Button
                        onClick={() =>
                          api(`/v1/invites/${invite.id}`, { method: "DELETE" })
                            .then(loadTab)
                            .catch((cause: Error) => setError(cause.message))
                        }
                      >
                        Revoke
                      </Button>
                    )}
                  </CardRow>
                ))}
              </div>
            ) : (
              <EmptyState>No invites yet.</EmptyState>
            )}
          </Panel>
        )}

        {!loading && selected && tab === "audit" && (
          <Panel>
            <PanelHeader
              title="Audit trail"
              hint="Recent administrative and asset activity."
              count={events.length}
            />
            {events.length ? (
              <div className="px-6 py-1">
                {events.map((event, index) => (
                  <article
                    key={event.id ?? index}
                    className="relative flex gap-4 border-l border-line py-4 pl-6"
                  >
                    <div className="absolute top-5 -left-[5px] size-2.5 rounded-full border-2 border-card bg-accent ring-1 ring-accent" />
                    <div>
                      <h3 className="text-[15px] font-semibold">{event.action ?? "Activity"}</h3>
                      <RowMeta>
                        {event.detail ?? event.resource ?? "No additional detail"}
                      </RowMeta>
                      <small className="mt-1.5 block text-[10px] text-faint">
                        {event.actor_name ?? event.actor ?? "System"} ·{" "}
                        {event.created_at || event.timestamp
                          ? new Date(event.created_at ?? event.timestamp!).toLocaleString()
                          : "Unknown time"}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>No audit events found.</EmptyState>
            )}
          </Panel>
        )}
      </main>

      {showCreateKey && (
        <Modal title="Add API key" onClose={() => setShowCreateKey(false)}>
          <form className="grid gap-4 p-6" onSubmit={createKey}>
            <Field label="Friendly name" name="name" required placeholder="Production CRM" autoFocus />
            <Field
              label="Key value"
              name="value"
              type="password"
              required
              placeholder="Paste secret value"
            />
            <Field
              label="Environment variable"
              name="env_var"
              required
              placeholder="CRM_API_KEY"
              pattern="[A-Z_][A-Z0-9_]*"
            />
            <Field label="Key kind">
              <select name="kind" defaultValue="static_api_key" className={INPUT_CLASS}>
                <option value="static_api_key">System API key</option>
                <option value="provider_api_key">Model provider key</option>
              </select>
            </Field>
            <div className="mt-1 flex justify-end gap-2">
              <Button onClick={() => setShowCreateKey(false)}>Cancel</Button>
              <Button variant="primary" type="submit">
                Save key
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {rotateKey && (
        <Modal title={`Rotate ${rotateKey.name}`} onClose={() => setRotateKey(undefined)}>
          <form className="grid gap-4 p-6" onSubmit={rotate}>
            <p className="text-sm leading-relaxed text-muted">
              The new value takes over under the same stable reference. The prior version can
              remain in its server-configured grace period.
            </p>
            <Field
              label="New key value"
              name="value"
              type="password"
              required
              autoFocus
              placeholder="Paste new value"
            />
            <div className="mt-1 flex justify-end gap-2">
              <Button onClick={() => setRotateKey(undefined)}>Cancel</Button>
              <Button variant="primary" type="submit">
                Rotate key
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {historyAsset && (
        <Modal title={`${historyAsset.name} history`} onClose={() => setHistoryAsset(undefined)}>
          {history.length ? (
            <div>
              {history.map((version) => (
                <article
                  key={version.id}
                  className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 last:border-b-0"
                >
                  <div>
                    <h3 className="text-[15px] font-semibold">
                      Version {version.seq ?? version.id}
                    </h3>
                    <RowMeta>{version.message ?? "No change note"}</RowMeta>
                    <small className="mt-1.5 block text-[10px] text-faint">
                      {version.author_email ?? "Unknown author"}
                      {version.created_at && ` · ${new Date(version.created_at).toLocaleString()}`}
                    </small>
                  </div>
                  <Button onClick={() => assetAction(historyAsset, "rollback", version)}>
                    Roll back
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>No version history found.</EmptyState>
          )}
        </Modal>
      )}

      {cliToken && (
        <Modal title="Connect the CLI" onClose={() => setCliToken("")}>
          <div className="grid gap-5 p-6">
            <p className="text-sm leading-relaxed text-muted">
              Two commands and you are set up for good. Skip the first if you already have{" "}
              <code className="font-mono text-ink">harness</code>.
            </p>
            <CommandBlock label="1 · Install" command={INSTALL_COMMAND} hint="once per machine" />
            <CommandBlock
              label="2 · Connect"
              command={`harness login --api-url ${API_URL} --token ${cliToken}`}
              hint="once — it stays signed in"
            />
            <p className="text-xs leading-relaxed text-muted">
              You will not need to do this again on this machine. From now on just run{" "}
              <code className="font-mono text-ink">harness run</code>, or{" "}
              <code className="font-mono text-ink">harness --help</code> to see everything else.
              The token above is shown once — if you lose it before connecting, come back and
              make another.
            </p>
            {SHOW_RESET && (
              <div className="border-t border-line pt-4">
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
