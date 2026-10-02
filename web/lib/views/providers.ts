import type { components } from "@/lib/api.generated";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import type { Column, Related } from "./types";
import { type Cell, record, records, related, str, strings, when } from "./cells";

/**
 * `GET /v1/console/providers/harness` · `/providers/model` · `/routing`.
 *
 * Three fields landed with W6-D3, D5 and D6 and `lib/api.generated.ts` is not
 * regenerated inside a workstream (the ground rule), so they are written here
 * by hand over the generated models and the coordinator's regeneration will
 * simply agree with them: `HarnessProviderRow.name` (the runtime's own word for
 * itself), `ModelProviderRow.status` in place of `reachable` (the
 * `providerStatus` scale), and `RoutingMatrix.subjects` (what the two routing
 * verbs may pick, each with a label, because a harness id is a uuid).
 */
export type HarnessProviderRow = components["schemas"]["HarnessProviderRow"] & {
  name?: string | null;
};
export type ModelProviderRow = {
  id: string;
  endpoints: Record<string, string>;
  models: string[];
  credential?: string | null;
  /** W6-D6: the `providerStatus` scale, in place of the old `reachable` fact. */
  status?: string;
  groups: components["schemas"]["Related"];
  defaultFor: components["schemas"]["RoutingDimensions"];
  approvedFor: components["schemas"]["RoutingDimensions"];
} & { [key: string]: unknown };
export type RoutingMatrix = components["schemas"]["RoutingMatrix"] & {
  subjects?: unknown;
};

export interface HarnessProviderDisplay {
  provider: string;
  approval: string;
  approvedFor: Related;
  pin: Cell;
  speaks: string;
  reason: string;
  decidedBy: string;
  when: string;
}

export interface ModelProviderDisplay {
  provider: string;
  endpoints: Cell;
  models: string;
  credentialAlias: Cell;
  status: string;
  defaultFor: Cell;
  approvedFor: Cell;
  /** The row's own verbs column (the id, for the lookup): a second column
   *  keyed `provider` would be two React children with one key. */
  verbs: string;
}

const HARNESS_KEYS = [
  "provider", "approval", "approvedFor", "pin", "speaks", "reason", "decidedBy", "when",
] as const;
const MODEL_KEYS = [
  "provider", "endpoints", "models", "credentialAlias", "status", "defaultFor", "approvedFor",
] as const;

/** 07 §3: at *n* = 0 every runtime is simply available, so approval and its
 *  scope are absent rather than shown with one value. */
export function harnessProviderColumns(personal: boolean): Column<HarnessProviderDisplay>[] {
  const hidden = new Set(personal ? ["approval", "approvedFor", "reason", "decidedBy"] : []);
  return HARNESS_KEYS.filter((key) => !hidden.has(key)).map((key) => {
    const entry = PROVIDERS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: key === "approval" ? "scale" : key === "approvedFor" ? "related" : key === "pin" ? "fact" : "text",
      scale: entry.scale,
      unit: entry.unit,
      sort: key === "speaks" || key === "reason" ? false : undefined,
    };
  });
}

/**
 * W6-D5: *Default for* and *Approved for* are columns of this table now, and
 * the old *Approved for providers* column is gone with the Routing tab — it
 * read `routing.approvedFor.providers`, which is one of the three dimensions
 * the new column shows whole, under a heading that said *derived* about data an
 * admin had typed (D95).
 */
export function modelProviderColumns(): Column<ModelProviderDisplay>[] {
  return MODEL_KEYS.map((key) => {
    // The harness tab already owns a column called `approvedFor` (which teams
    // may run a runtime), so routing's own is `approvedForRouting` in the
    // content module and `approvedFor` on the row.
    const entry = PROVIDERS.columns[key === "approvedFor" ? "approvedForRouting" : key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind:
        key === "status"
          ? "scale"
          : key === "endpoints" || key === "credentialAlias" || key === "defaultFor"
              || key === "approvedFor"
            ? "fact"
            : "text",
      scale: entry.scale,
      unit: entry.unit,
      sort: key === "endpoints" || key === "models" ? false : undefined,
    };
  });
}

/** The pin is a commit or a minimum version, in one `Mono` (PRD §9.1). */
export function pinOf(row: HarnessProviderRow): string {
  const pin = record(row.pin);
  const commit = str(pin.commit);
  if (commit) return commit.slice(0, 12);
  const version = str(pin.version);
  return version ? `binary ≥ ${version}` : "";
}

export function speaksOf(row: HarnessProviderRow): string {
  return strings(row.speaks).join(", ");
}

/**
 * W6-D3: the word a person reads for a runtime, from `HarnessProvider.name` on
 * the contract. The id is the fallback for a row written before the field
 * landed — `console.RUNNER_NAMES`, the map that used to hold *Pi* and *Claude
 * Code* beside its one reader, is gone with it.
 */
export function runtimeName(row: HarnessProviderRow): string {
  return str(row.name) || row.id;
}

export function approvalOf(row: HarnessProviderRow): string {
  return row.approval === "not_approved" ? "not-approved" : row.approval;
}

/**
 * The scope the row already carries, sent back unchanged by the approval
 * switch: the verb moves the approval, not who it reaches. `scope` rides on
 * the row as an extra field (every console model is `extra="allow"`), so it is
 * narrowed here; where the server sent none, the *Approved for* cell is read
 * instead, because defaulting to every team would silently widen the scope.
 */
export function scopeOf(row: HarnessProviderRow): { teams: "all" | string[] } {
  const teams = record(row.scope).teams;
  if (teams === "all") return { teams: "all" };
  if (Array.isArray(teams)) return { teams: strings(teams) };
  const shown = related(row.teams, "teams");
  return shown.all ? { teams: "all" } : { teams: shown.items.map((item) => item.id) };
}

/** 04 §10 *States*: the first-run notices, from the rows the page already has. */
export function noneApproved(rows: HarnessProviderRow[]): boolean {
  return rows.length > 0 && rows.every((row) => approvalOf(row) !== "approved");
}

export function noneConnected(rows: ModelProviderRow[]): boolean {
  return rows.length > 0 && rows.every((row) => !row.credential);
}

export function decidedBy(row: HarnessProviderRow): string {
  return str(row.decidedBy) || "—";
}

export function decidedWhen(row: HarnessProviderRow): string {
  return when(row.at);
}

/** One endpoint per wire format (PRD §9.3), in the format's own order. */
export function endpointsOf(row: ModelProviderRow): Array<{ format: string; url: string }> {
  return Object.entries(record(row.endpoints))
    .filter(([, url]) => typeof url === "string")
    .map(([format, url]) => ({ format, url: String(url) }));
}

/**
 * W6-D6, and W7-D2's fourth value. A row from a server that has not landed the
 * field yet reads *needs-key*, which is the safe half: it offers *Set up* and
 * keeps the provider out of the two routing verbs, rather than claiming a key
 * is held or a sign-in exists.
 */
export function statusOf(row: ModelProviderRow): string {
  const status = str(row.status);
  return status === "set-up" || status === "unreachable" || status === "sign-in" ? status : "needs-key";
}

/**
 * W6-D6's exclusion, and only it. W7-D2: *sign-in* is **not** this — the
 * broker allows that session, so the row keeps both routing verbs and says
 * what running it means instead of why it is out.
 */
export function needsKey(row: ModelProviderRow): boolean {
  return statusOf(row) === "needs-key";
}

/** W7-D2: no key is held, and a runtime this organisation lists signs in to
 *  this provider itself. The row routes; the request does not go through us. */
export function signIn(row: ModelProviderRow): boolean {
  return statusOf(row) === "sign-in";
}

export type MatrixDimension = "teams" | "harnesses" | "providers";
export const DIMENSIONS = ["teams", "harnesses", "providers"] satisfies MatrixDimension[];

export interface RoutingSubject {
  id: string;
  label: string;
}

/**
 * W6-D5: the subjects the two verbs may pick, per dimension, as the server
 * named them. A harness id is a uuid and a runtime now has a `name` on the
 * contract, so the label is never computed here (K2) and never the id.
 */
export function subjectsOf(matrix: RoutingMatrix, dimension: MatrixDimension): RoutingSubject[] {
  return records(record(matrix.subjects)[dimension])
    .map((subject) => ({ id: str(subject.id), label: str(subject.label) || str(subject.id) }))
    .filter((subject) => subject.id !== "");
}

/** id → label across all three dimensions, for the two row cells. */
export function subjectLabels(matrix: RoutingMatrix): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const dimension of DIMENSIONS) {
    for (const subject of subjectsOf(matrix, dimension)) labels[subject.id] = subject.label;
  }
  return labels;
}

/**
 * One row's *Default for* or *Approved for*: every subject the server listed
 * under the row, in dimension order, with the word a person reads for it. The
 * row carries both maps already (03 §5.2), so the cell is a read of the row and
 * not a second walk of the routing file.
 */
export function routedSubjects(
  side: unknown,
  labels: Record<string, string>,
): Array<{ dimension: MatrixDimension; id: string; label: string }> {
  const dimensions = record(side);
  return DIMENSIONS.flatMap((dimension) =>
    strings(dimensions[dimension]).map((id) => ({
      dimension,
      id,
      label: labels[id] ?? id,
    })),
  );
}

export interface MatrixRow {
  dimension: MatrixDimension;
  subject: string;
  /** The word for the subject (W6-D5): a harness id is a uuid. */
  label: string;
  defaultFor: string;
  approvedFor: string[];
  resolved: string;
}

/** The two maps as `PUT /v1/routing` takes them — the whole file goes back, so
 *  every cell this screen did not touch has to travel with the one it did. */
export interface RoutingMaps {
  defaultFor: Record<MatrixDimension, Record<string, string>>;
  approvedFor: Record<MatrixDimension, Record<string, string[]>>;
}

export function routingMaps(matrix: RoutingMatrix): RoutingMaps {
  const defaults = record(matrix.defaultFor);
  const approved = record(matrix.approvedFor);
  const maps: RoutingMaps = {
    defaultFor: { teams: {}, harnesses: {}, providers: {} },
    approvedFor: { teams: {}, harnesses: {}, providers: {} },
  };
  for (const dimension of DIMENSIONS) {
    for (const [subject, value] of Object.entries(record(defaults[dimension]))) {
      if (str(value)) maps.defaultFor[dimension][subject] = str(value);
    }
    for (const [subject, value] of Object.entries(record(approved[dimension]))) {
      maps.approvedFor[dimension][subject] = strings(value);
    }
  }
  return maps;
}

/**
 * *Set default…* (W6-D5). A default that is not also an approval would resolve
 * to a provider the broker refuses at step 5, so the one write does both — the
 * modal says so and the server's own `routing.not_approved` is the proof it
 * matters (D42).
 */
export function withDefault(
  matrix: RoutingMatrix,
  dimension: MatrixDimension,
  subject: string,
  provider: string,
): RoutingMaps {
  const maps = withApproval(matrix, dimension, subject, provider);
  maps.defaultFor[dimension][subject] = provider;
  return maps;
}

export function withApproval(
  matrix: RoutingMatrix,
  dimension: MatrixDimension,
  subject: string,
  provider: string,
): RoutingMaps {
  const maps = routingMaps(matrix);
  const held = maps.approvedFor[dimension][subject] ?? [];
  maps.approvedFor[dimension][subject] = held.includes(provider) ? held : [...held, provider];
  return maps;
}

/** The remove on an existing approval. The default that relied on it goes with
 *  it, because a default outside *approved for* is a cell that resolves to a
 *  refusal (the matrix would show it resolving and the broker would not). */
export function withoutApproval(
  matrix: RoutingMatrix,
  dimension: MatrixDimension,
  subject: string,
  provider: string,
): RoutingMaps {
  const maps = routingMaps(matrix);
  maps.approvedFor[dimension][subject] = (maps.approvedFor[dimension][subject] ?? []).filter(
    (held) => held !== provider,
  );
  if (maps.defaultFor[dimension][subject] === provider) {
    delete maps.defaultFor[dimension][subject];
  }
  return maps;
}

/**
 * The matrix of 04 §10: rows are teams, harnesses and runtimes; the two column
 * groups are *Default for* and *Approved for* (PRD §9.2). A team reads only
 * its own row and its default select lists only what is approved (D42).
 */
export function matrixRows(matrix: RoutingMatrix, only: string | null): MatrixRow[] {
  const defaults = record(matrix.defaultFor);
  const approved = record(matrix.approvedFor);
  const resolved = record(matrix.resolved);
  const labels = subjectLabels(matrix);
  const rows: MatrixRow[] = [];
  for (const dimension of ["teams", "harnesses", "providers"] satisfies MatrixDimension[]) {
    const subjects = new Set([
      ...Object.keys(record(defaults[dimension])),
      ...Object.keys(record(approved[dimension])),
    ]);
    for (const subject of [...subjects].sort()) {
      if (only !== null && !(dimension === "teams" && subject === only)) continue;
      rows.push({
        dimension,
        subject,
        label: labels[subject] ?? subject,
        defaultFor: str(record(defaults[dimension])[subject]),
        approvedFor: strings(record(approved[dimension])[subject]),
        resolved: str(record(record(resolved)[subject]).value),
      });
    }
  }
  return rows;
}

export function dimensionLabel(dimension: MatrixDimension): string {
  if (dimension === "teams") return PROVIDERS_TEXT.rowTeams;
  return dimension === "harnesses" ? PROVIDERS_TEXT.rowHarnesses : PROVIDERS_TEXT.rowProviders;
}

/** 04 §10's two tabs, as the bar's rows (01 §7.5). They are routes
 *  (02 rule 16); W6-D5 took Routing away, and `providers/routing` redirects
 *  onto the Model providers tab. */
export function providerTabs(base: string, current: "harness" | "model") {
  return [
    { id: "harness", label: PROVIDERS_TEXT.tabs.harness, href: `${base}/providers`, current: current === "harness" },
    { id: "model", label: PROVIDERS_TEXT.tabs.model, href: `${base}/providers/model`, current: current === "model" },
  ];
}
