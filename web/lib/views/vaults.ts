import type { components } from "@/lib/api.generated";
import { VAULTS, VAULT_WORDS } from "@/content/screens/vaults";
import type { Column, Related } from "./types";
import { type Cell, bool, record, related, str, when } from "./cells";

/** `GET /v1/console/vaults` · `/vaults/{id}/secrets` (00 §4.10). */
export type VaultRow = components["schemas"]["VaultRow"];
export type SecretRow = components["schemas"]["SecretRow"];

/** PRD §6.2: the person's own machine is a row, so no row has a blank
 *  provider. `api` gives it this id and no reachability it did not observe. */
export const MACHINE = "your machine";
export const BUNDLED = "bundled";

export interface VaultDisplay {
  vault: string;
  connected: Cell;
  handsUs: string;
  issues: string;
  contents: string;
  groups: Related;
}

export interface SecretDisplay {
  /** The row's own reference, which the rotate verb keys on. */
  ref: string;
  secret: Cell;
  group: string;
  reachedBy: Related;
  ready: Cell;
  lastUsed: string;
}

const VAULT_KEYS = ["vault", "connected", "handsUs", "issues", "contents", "groups"] as const;
const SECRET_KEYS = ["secret", "group", "reachedBy", "ready", "lastUsed"] as const;

export function vaultColumns(): Column<VaultDisplay>[] {
  return VAULT_KEYS.map((key) => {
    const entry = VAULTS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: key === "groups" ? "related" : key === "connected" ? "fact" : "text",
      unit: entry.unit,
      sort: key === "groups" ? false : undefined,
    };
  });
}

export function secretColumns(): Column<SecretDisplay>[] {
  return SECRET_KEYS.map((key) => {
    const entry = VAULTS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind:
        key === "reachedBy" ? "related" : key === "secret" || key === "ready" ? "fact" : key === "lastUsed" ? "time" : "text",
      unit: entry.unit,
      sort: key === "reachedBy" ? false : undefined,
    };
  });
}

/** *reachable now*, observed and stored nowhere (P2). `null` is *we did not
 *  check* — the machine row — and reads as a dash, never as `false`. */
export function reachableText(row: VaultRow, yes: string, no: string, unknown: string): string {
  const value = bool(record(row.reachable).value);
  if (value === null) return unknown;
  return value ? yes : no;
}

export function isBundled(row: VaultRow): boolean {
  return row.id === BUNDLED;
}

export function isMachine(row: VaultRow): boolean {
  return row.id === MACHINE;
}

/** PRD §6.2's honest degradation: *we may list* against *declared only*. */
export function listable(row: VaultRow): boolean {
  return row.contents === "listable";
}

export function secretReady(row: SecretRow): boolean | null {
  return bool(record(row.ready).value);
}

export function secretWhen(row: SecretRow): string {
  return when(row.lastUsed);
}

export function secretGroups(row: SecretRow): Related {
  return related(row.groups, "groups");
}

export function vaultGroups(row: VaultRow): Related {
  return related(row.groups, "groups");
}

export type Finding = "all" | "uncovered" | "dangling";

/** PRD §6.7's two findings, as filters over the one list — never a second
 *  table and never a grade (04 §11). */
export function filterSecrets(rows: SecretRow[], finding: Finding): SecretRow[] {
  if (finding === "uncovered") return rows.filter((row) => row.uncovered);
  if (finding === "dangling") return rows.filter((row) => row.dangling);
  return rows;
}

export function findingOf(value: string | undefined): Finding {
  return value === "uncovered" || value === "dangling" ? value : "all";
}

/** 04 §11: *minted* or *stored*; *temporary credentials* or *stored values*;
 *  *we may list* or *declared only*. The payload sends one word for each. */
export function handsUs(row: VaultRow): string {
  return pick(VAULT_WORDS.handsUs, row.handsUs);
}

export function issues(row: VaultRow): string {
  return pick(VAULT_WORDS.issues, row.issues);
}

export function contents(row: VaultRow): string {
  return pick(VAULT_WORDS.contents, row.contents);
}

function pick(words: Record<string, string>, value: string): string {
  return words[value] ?? value;
}

export function vaultLabel(row: VaultRow, machineTitle: string): string {
  return isMachine(row) ? machineTitle : str(row.id);
}
