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
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">H</div>
        <p className="eyebrow">Harness</p>
        <h1>{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="alert">{error}</p>}
          <button className="primary full" type="submit" disabled={busy}>
            {mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <button
          className="ghost full"
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Need an account?" : "Have an account?"}
        </button>
      </section>
    </main>
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
    <main className="login-shell">
      <section className="login-card">
        <h1>Create an organization</h1>
        <p className="muted">Or ask an admin to invite this email to their team.</p>
        <form onSubmit={submit}>
          <label htmlFor="org_name">Organization name</label>
          <input id="org_name" name="org_name" required autoFocus />
          <label htmlFor="team_name">First team</label>
          <input id="team_name" name="team_name" defaultValue="General" />
          {error && <p className="alert">{error}</p>}
          <button className="primary full" type="submit">
            Create
          </button>
        </form>
      </section>
    </main>
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
        className={`tree-row ${selectedId === node.id ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <button
          className="disclosure"
          onClick={() => setOpen((value) => !value)}
          aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
          disabled={!hasChildren}
        >
          {hasChildren ? (open ? "⌄" : "›") : "·"}
        </button>
        <button className="tree-label" onClick={() => onSelect(node)}>
          <span>{node.name}</span>
          {node.role && <small>{node.role}</small>}
        </button>
      </div>
      {open && hasChildren && (
        <ul>
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

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
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
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

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
      await api(
        `/v1/api-keys/${encodeURIComponent(rotateKey.id)}/rotate`,
        {
          method: "POST",
          body: JSON.stringify({ value: form.get("value") }),
        },
      );
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
      const value = await api<unknown>(
        `/v1/assets/${encodeURIComponent(asset.id)}/history`,
      );
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
      action === "promote"
        ? window.prompt("Enter the destination org-unit ID:")
        : undefined;
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark small">H</div>
          <div>
            <strong>Harness</strong>
            <span>Admin</span>
          </div>
        </div>
        <button className="ghost" onClick={() => void mintCliToken()}>
          CLI token
        </button>
        <button className="ghost" onClick={() => void logout()}>
          Sign out
        </button>
      </header>

      <aside className="sidebar">
        <p className="eyebrow">Organization</p>
        <h2>Structure</h2>
        {tree.length ? (
          <nav aria-label="Organization units">
            <ul className="tree">
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
          !loading && <EmptyState>No organization units found.</EmptyState>
        )}
      </aside>

      <main className="content">
        <header className="content-header">
          <div>
            <p className="eyebrow">{selected?.role ?? "Organization unit"}</p>
            <h1>{selected?.name ?? "Select a unit"}</h1>
          </div>
          {tab === "keys" && selected && (
            <button className="primary" onClick={() => setShowCreateKey(true)}>
              + Add key
            </button>
          )}
        </header>

        <div className="tabs" role="tablist">
          {(["assets", "boundary", "keys", "members", "audit"] as Tab[]).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={tab === item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item === "keys" ? "Keys" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {loading && <div className="loading">Loading…</div>}

        {!loading && selected && tab === "assets" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Assets</h2>
                <p>Versioned resources available to this unit.</p>
              </div>
              <span className="count">{assets.length}</span>
            </div>
            {assets.length ? (
              <div className="card-list">
                {assets.map((asset) => (
                  <article className="asset-card" key={asset.id}>
                    <div className="asset-icon">{asset.kind?.[0]?.toUpperCase() ?? "A"}</div>
                    <div className="grow">
                      <div className="row-title">
                        <h3>{asset.name}</h3>
                        {asset.status && <span className={`badge ${asset.status}`}>{asset.status}</span>}
                      </div>
                      <p>
                        {asset.kind ?? "Asset"} · Version {asset.head_seq ?? "—"}
                        {asset.updated_at && ` · Updated ${new Date(asset.updated_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="actions">
                      <button onClick={() => openHistory(asset)}>History</button>
                      <button className="accent" onClick={() => assetAction(asset, "promote")}>
                        Promote
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>No assets are assigned to this unit.</EmptyState>
            )}
          </section>
        )}

        {!loading && selected && tab === "boundary" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Effective boundary</h2>
                <p>Inherited and unit-specific controls returned by the policy service.</p>
              </div>
            </div>
            {data ? (
              <pre className="boundary">{JSON.stringify(data, null, 2)}</pre>
            ) : (
              <EmptyState>No boundary is configured.</EmptyState>
            )}
          </section>
        )}

        {!loading && selected && tab === "keys" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>API keys</h2>
                <p>Secret values stay hidden. Rotation preserves each stable reference.</p>
              </div>
              <span className="count">{keys.length}</span>
            </div>
            {keys.length ? (
              <div className="card-list">
                {keys.map((key) => (
                  <article className="key-card" key={key.id}>
                    <div className="grow">
                      <div className="row-title">
                        <h3>{key.name}</h3>
                        <span className={`badge ${key.status ?? "active"}`}>
                          {key.status ?? "active"}
                        </span>
                      </div>
                      <p className="mono">{key.ref ?? "Stable reference unavailable"}</p>
                      <p>Value ending in ••••{key.last4 ?? "—"} · Version {key.version ?? "—"}</p>
                    </div>
                    <button onClick={() => setRotateKey(key)}>Rotate</button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>No keys exist for this unit.</EmptyState>
            )}
          </section>
        )}

        {!loading && selected && tab === "members" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Invites</h2>
                <p>Invite an email to this team. They get a workspace after signup.</p>
              </div>
            </div>
            {selected.role === "team" ? (
              <form className="modal-form" onSubmit={createInvite}>
                <label>
                  Email
                  <input name="email" type="email" required />
                </label>
                <label>
                  <input name="admin" type="checkbox" /> Team admin
                </label>
                <button className="primary" type="submit">
                  Send invite
                </button>
              </form>
            ) : (
              <p className="muted">Select a team to invite people.</p>
            )}
            {invites.length ? (
              <div className="card-list">
                {invites.map((invite) => (
                  <article key={invite.id}>
                    <h3>{invite.email}</h3>
                    <p>{invite.accepted_at ? "Accepted" : "Pending"}</p>
                    {invite.admin_level && <p>Admin: {invite.admin_level}</p>}
                    {!invite.accepted_at && (
                      <button
                        onClick={() =>
                          api(`/v1/invites/${invite.id}`, { method: "DELETE" })
                            .then(loadTab)
                            .catch((cause: Error) => setError(cause.message))
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>No invites yet.</EmptyState>
            )}
          </section>
        )}

        {!loading && selected && tab === "audit" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Audit trail</h2>
                <p>Recent administrative and asset activity.</p>
              </div>
              <span className="count">{events.length}</span>
            </div>
            {events.length ? (
              <div className="timeline">
                {events.map((event, index) => (
                  <article key={event.id ?? index}>
                    <div className="timeline-dot" />
                    <div>
                      <h3>{event.action ?? "Activity"}</h3>
                      <p>{event.detail ?? event.resource ?? "No additional detail"}</p>
                      <small>
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
          </section>
        )}
      </main>

      {showCreateKey && (
        <Modal title="Add API key" onClose={() => setShowCreateKey(false)}>
          <form className="modal-form" onSubmit={createKey}>
            <label>
              Friendly name
              <input name="name" required placeholder="Production CRM" autoFocus />
            </label>
            <label>
              Key value
              <input name="value" type="password" required placeholder="Paste secret value" />
            </label>
            <label>
              Environment variable
              <input name="env_var" required placeholder="CRM_API_KEY" pattern="[A-Z_][A-Z0-9_]*" />
            </label>
            <label>
              Key kind
              <select name="kind" defaultValue="static_api_key">
                <option value="static_api_key">System API key</option>
                <option value="provider_api_key">Model provider key</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowCreateKey(false)}>Cancel</button>
              <button className="primary" type="submit">Save key</button>
            </div>
          </form>
        </Modal>
      )}

      {rotateKey && (
        <Modal title={`Rotate ${rotateKey.name}`} onClose={() => setRotateKey(undefined)}>
          <form className="modal-form" onSubmit={rotate}>
            <p className="muted">
              The new value takes over under the same stable reference. The prior version
              can remain in its server-configured grace period.
            </p>
            <label>
              New key value
              <input name="value" type="password" required autoFocus placeholder="Paste new value" />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setRotateKey(undefined)}>Cancel</button>
              <button className="primary" type="submit">Rotate key</button>
            </div>
          </form>
        </Modal>
      )}

      {historyAsset && (
        <Modal title={`${historyAsset.name} history`} onClose={() => setHistoryAsset(undefined)}>
          {history.length ? (
            <div className="history-list">
              {history.map((version) => (
                <article key={version.id}>
                  <div>
                    <h3>Version {version.seq ?? version.id}</h3>
                    <p>{version.message ?? "No change note"}</p>
                    <small>
                      {version.author_email ?? "Unknown author"}
                      {version.created_at &&
                        ` · ${new Date(version.created_at).toLocaleString()}`}
                    </small>
                  </div>
                  <button onClick={() => assetAction(historyAsset, "rollback", version)}>
                    Roll back
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>No version history found.</EmptyState>
          )}
        </Modal>
      )}

      {cliToken && (
        <Modal title="CLI token" onClose={() => setCliToken("")}>
          <p className="muted">Paste this into `harness login`. It is shown once.</p>
          <p className="mono">{cliToken}</p>
          <button
            className="primary"
            onClick={() => void navigator.clipboard.writeText(cliToken)}
          >
            Copy
          </button>
        </Modal>
      )}
    </div>
  );
}

