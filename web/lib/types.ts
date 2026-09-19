/* The shapes the API actually returns. Every optional field here is one the
   backend may omit, not a field we hope for: the rows come straight from
   `select *`, so this file follows the migrations. */

export type JsonRecord = Record<string, unknown>;

/* The five asset kinds are the rows of the asset_kinds table; the rest are the
   org unit's own settings. One tab each. */
export type AssetTab = "system_prompt" | "memory" | "skill" | "prompt" | "tool" | "connection";
export type Tab = AssetTab | "harness" | "boundary" | "keys" | "invites" | "audit";
export type Pane = "document" | "manage";
/** The two asset-list views: this unit's copies, or everyone else's that
    reach it — inherited from above or rolled up from below. */
export type AssetScope = "owned" | "available";

export interface TreeNode {
  id: string;
  name: string;
  role?: string;
  children?: TreeNode[];
}

export interface Identity {
  email?: string;
  role?: string;
  role_unit?: string | null;
  org_unit_path?: string;
}

/* A drawing: a palette, and one character per pixel indexing it. `.` is
   transparent. Validated server-side by app/domain/harnesses.py. */
export interface PixelIcon {
  palette: string[];
  rows: string[];
}

/* A named selection of assets to work in. Harnesses do not shadow by name
   the way assets do, so `org_unit_path` is part of a harness's identity to a
   reader, not just decoration. */
export interface Harness {
  id: string;
  org_unit_id: string;
  name: string;
  description: string;
  icon: PixelIcon;
  org_unit_path: string;
  /** How many assets name this harness. Not the same as what it loads. */
  assigned_assets?: number;
  created_at?: string;
  updated_at?: string;
}

/* One name that could be in this harness, and whether it is. A harness
   holds (kind, name) pairs, so `asset_id` is whichever asset answers that
   name at the harness's own unit — null when nothing does. */
export interface HarnessAssetRow {
  kind: string;
  name: string;
  assigned: boolean;
  asset_id: string | null;
  org_unit_path: string | null;
}

export interface HarnessDetail extends Harness {
  assets: HarnessAssetRow[];
}

export interface Asset {
  id: string;
  name: string;
  org_unit_id?: string;
  /** Owning unit's path. Present on the list so inherited rows can say where
      they come from without a second request. */
  org_unit_path?: string;
  /** owned = this unit; inherited = nearest live ancestor; below = a
      descendant's own copy. Same name may appear more than once. */
  origin?: "owned" | "inherited" | "below";
  kind?: string;
  status?: string;
  /* Harnesses at or above this asset's unit that contain its name. Empty
     means no harness loads it — it reaches only sessions with none selected. */
  harness_ids?: string[];
  /* The active version. A version pushed under review is not head, so this is
     what "the current document" means — not the newest row in the history. */
  head_version_id?: string | null;
  head_seq?: number | null;
  head_message?: string | null;
  /* When the live version was pushed. `assets` has no updated_at of its own,
     so the list endpoint carries the head version's timestamp. */
  head_updated_at?: string | null;
  created_at?: string;
}

/* One org unit that owns an asset of the same kind and name, from
   `/assets/{id}/lineage`. A session resolves a name from the nearest active
   one above it, so this is the whole picture for that name. */
export interface LineageRow {
  org_unit_id: string;
  name: string;
  role?: string;
  path: string;
  asset_id: string;
  status?: string;
  version_id?: string | null;
  seq?: number | null;
  updated_at?: string | null;
  /** The asset this one's live version was promoted from, if it was. */
  promoted_from_asset_id?: string | null;
  promoted_from_seq?: number | null;
  /** The exact version promoted from — the common ancestor a merge needs,
      distinct from the seq above, which cannot be fetched by itself. */
  promoted_from_version_id?: string | null;
  /** The asset id this row's live version has knowingly chosen to override,
      if any (docs/scoping.md §5.2). Null on a shadow made before that
      choice existed to make. */
  override_of?: string | null;
}

export interface Version {
  id: string;
  seq?: number;
  message?: string;
  /* The API selects `author_auth_user_id::text` under this name, so it holds a
     user id rather than an address. Shown as an id, never as a mailto. */
  author_email?: string;
  created_at?: string;
  provenance?: JsonRecord;
}

/** One file of one version, as `/assets/{id}/versions/{id}/files` returns it. */
export interface AssetFile {
  path: string;
  content_b64: string;
}

export interface ApiKey {
  id: string;
  name: string;
  ref?: string;
  kind?: string;
  env_var?: string;
  last4?: string;
  version?: number;
  created_at?: string;
}

export interface AuditEvent {
  id: number | string;
  actor_type?: string;
  actor_id?: string | null;
  class?: string;
  action?: string;
  payload?: JsonRecord;
  created_at?: string;
}

export interface Invite {
  id: string;
  email: string;
  accepted_at?: string | null;
  admin_level?: string | null;
  created_at?: string;
}

/* The boundary document, as merged by app/domain/org_tree.py. `null` and `[]`
   are different answers for an allowlist and are rendered differently. */
export interface BoundaryPolicy {
  egress_allowlist?: string[] | null;
  connector_allowlist?: string[] | null;
  approvals?: { deploy?: string } | null;
  load_policy?: { default?: string; prescribed?: boolean } | null;
  build_policy?: { push_review?: boolean } | null;
  budget?: {
    monthly_usd_cap?: number | null;
    requests_per_minute?: number | null;
  } | null;
}

export interface BoundaryView {
  own: BoundaryPolicy;
  effective: BoundaryPolicy;
}

/** The caller's fetch wrapper: it signs requests and signs out on a 401. */
export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
