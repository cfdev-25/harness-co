/** Shared props for the V2 specs (01 §13). Not a test file. */
import type { TableColumn } from "@/app/(console)/ui/table";
import type { HarnessView } from "@/lib/views/harness";
import type { ReachView } from "@/lib/views/reach";
import type { Viewer } from "@/lib/views/types";

export const VIEWER: Viewer = {
  user: { id: "u_jo", email: "jo@acme.example", name: "Jo Adeyemi" },
  role: { level: "member", at: "acme.marketing" },
  edition: "enterprise",
  staff: false,
  teams: [
    { path: "acme.marketing", name: "Marketing", admin: false },
    { path: "acme.marketing.interns", name: "Marketing interns", admin: true },
  ],
  visibility: { boundaries: true, logs: true },
  waiting: { harnesses: 2 },
  // A member of Marketing: they administer nothing at the level they are on
  // (01 §4.4). `ADMIN` below is the same person with the level's keys.
  adminHere: false,
};

/** The same viewer where they do administer the level (`?scope=` decides). */
export const ADMIN: Viewer = { ...VIEWER, adminHere: true };

export interface Row {
  id: string;
  name: string;
  approval: string;
  files: number | null;
  alias: string;
  changed: string;
}

export const COLUMNS: TableColumn<Row>[] = [
  { key: "name", heading: "Name", kind: "text", help: "The harness's name." },
  { key: "approval", heading: "Approval", kind: "scale", scale: "approval" },
  { key: "files", heading: "Files", kind: "number" },
  { key: "alias", heading: "Alias", kind: "chip" },
  { key: "changed", heading: "Changed", kind: "time" },
];

/** Twelve minutes before the run, so the relative cell reads the same words
 *  on every run without pinning a date the relative form has outgrown. */
export const CHANGED = new Date(Date.now() - 12 * 60_000).toISOString();

/**
 * `render` is a function, and Playwright's component rig turns a function
 * prop into an asynchronous callback across the browser boundary, so a column
 * carrying one cannot be written in the spec file. It is declared here, in
 * the browser bundle, and the spec mounts the table that uses it.
 */
export const RENDERED: TableColumn<Row>[] = [
  { key: "name", heading: "Name", kind: "text" },
  {
    key: "files",
    heading: "Files",
    kind: "number",
    render: (row) => <em data-rendered>{row.files === null ? "none" : `${row.files} files`}</em>,
  },
];

export const ROWS: Row[] = [
  { id: "h_1", name: "Campaign drafts", approval: "approved", files: 3,
    alias: "anthropic-api-key", changed: CHANGED },
  { id: "h_2", name: "Brief writer", approval: "beta", files: null,
    alias: "crm-token", changed: CHANGED },
  { id: "h_3", name: "Ad copy", approval: "not-approved", files: 7,
    alias: "gh-token", changed: CHANGED },
];

/** One harness, as `GET /v1/console/harnesses/{id}` answers it — enough of it
 *  for the *Applies here* section: one covering boundary, one covering grant. */
export const HARNESS_VIEW: HarnessView = {
  def: { id: "h_1", name: "Support", description: "the support desk", assets: [] },
  team: { path: "acme.marketing", name: "Marketing" },
  header: {
    preflight: { value: "passing", provenance: "derived" },
    modelProvider: { value: "anthropic", provenance: "derived" },
    groups: { value: ["marketing-crm"], provenance: "derived" },
    fileCount: 1,
  },
  // D131: the chain's reach, narrowed by nothing below the team that set it.
  reach: { mode: "allow", hosts: ["pypi.org", "files.pythonhosted.org"], setBy: "acme.marketing" },
  versions: [{ id: "mine", label: "Mine" }],
  files: [],
  groups: [{ name: "marketing-crm", grant: "g-marketing" }],
  boundaries: [
    { id: "b-1", kind: "endpoint", value: "*.pastebin.com", holds: "enforced",
      reason: "exfiltration", setBy: { path: "acme", kind: "org" } },
  ],
};

/**
 * `GET /v1/console/reach?scope=team:acme.marketing` — the organisation is
 * `on` except one host and Marketing narrows that to an allow-list of two,
 * which is D131's walk in its smallest complete form.
 */
export const REACH_VIEW: ReachView = {
  scope: "acme.marketing",
  effective: { mode: "allow", hosts: ["pypi.org", "files.pythonhosted.org"], setBy: "acme.marketing" },
  chain: [
    { node: "acme", name: "acme", mode: "on", hosts: ["competitor.example"], when: null },
    {
      node: "acme.marketing",
      name: "marketing",
      mode: "allow",
      hosts: ["pypi.org", "files.pythonhosted.org"],
      when: null,
    },
  ],
  suggested: ["pypi.org", "registry.npmjs.org"],
  canEdit: true,
};
