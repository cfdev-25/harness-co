/**
 * Key vaults — console 04 §11. Org scope only.
 */
import type { ScreenContent } from "../types";

export type VaultsColumn =
  | "vault"
  | "connected"
  | "handsUs"
  | "issues"
  | "contents"
  | "groups"
  | "secret"
  | "group"
  | "reachedBy"
  | "ready"
  | "lastUsed";
export type VaultsVerb = "connectVault" | "pasteKey" | "rotate" | "disconnect";

export const VAULTS: ScreenContent<VaultsColumn, VaultsVerb, "vaults" | "vault.secrets"> = {
  title: "Key vaults",
  lede: "A key vault is where secrets are kept — yours, or the one we host.",
  columns: {
    vault: { heading: "Vault", help: "The key vault, including the person's own machine." },
    connected: { heading: "Connected", help: "Whether we can reach this vault right now, checked just now." },
    handsUs: { heading: "Hands us", help: "Whether this vault mints a temporary credential or hands us a stored value." },
    issues: { heading: "Issues", help: "Temporary credentials, or stored values — what kind of thing this vault gives us." },
    contents: { heading: "Contents", help: "Whether we may list what is inside, or only show what an admin declared." },
    groups: { heading: "Groups", unit: "groups", help: "Which security groups resolve from this vault." },
    secret: { heading: "Secret", help: "The reference this secret is known by." },
    group: { heading: "Group", help: "The vault's own grouping for this secret." },
    reachedBy: { heading: "Reached by groups", unit: "groups", help: "Which security groups resolve this secret." },
    ready: { heading: "Ready", help: "Whether this secret currently resolves, checked just now." },
    lastUsed: { heading: "Last used", help: "When a session last resolved this secret." },
  },
  verbs: {
    connectVault: { label: "Connect a vault", explain: "Adds a key vault, with the list permission it grants named up front." },
    pasteKey: { label: "Paste a key", explain: "Stores a value in the vault we host." },
    rotate: { label: "Rotate", explain: "Replaces this secret's stored value." },
    disconnect: { label: "Disconnect", explain: "Removes this vault; anything only it covers stops resolving." },
  },
  empty: "vaults",
};

/**
 * The rest of the Key vaults screen's words (04 §11). The two findings PRD
 * §6.7 names are filters, not columns; the machine row's page says what we
 * can and cannot do; a customer vault links out rather than offering a write
 * (PRD §6.2 — we never write to a customer's vault).
 */
export const VAULTS_TEXT = {
  machineTitle: "Your machine",
  machineNote:
    "A credential that lives only on this machine is resolved by the CLI at launch and never reaches us. We cannot list it, read it or rotate it.",
  connectYourOwn: "Connect your own",
  connectYourOwnNote:
    "AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, Google Secret Manager and 1Password connect as your vault; we read through them and never write to them.",
  linkOut: "Open it where it lives",
  bundledNote: "The vault we host. It is the only one we may write to.",
  customerNote: "Your vault. We read through it and never write to it, so a key is pasted or rotated where it lives.",
  findings: "Findings",
  uncovered: "Nothing covers it",
  uncoveredNote: "This secret is in the vault and no security group reaches it.",
  dangling: "Points at a missing secret",
  danglingNote: "A security group names this reference and the vault does not have it.",
  allSecrets: "All secrets",
  rotateTitle: "Rotate {ref}",
  rotateValue: "New value",
  disconnectTitle: "Disconnect this vault",
  disconnectVerb: "Disconnect",
  cancel: "Cancel",
  secretsTitle: "Secrets",
} as const;

/** The three readings of an observed reachability probe (04 §11, P2). */
export const VAULT_WORDS = {
  handsUs: { minted: "minted", stored: "stored" },
  issues: { temporary: "temporary credentials", stored: "stored values" },
  contents: { listable: "we may list", "not listable": "declared only" },
} as const;

export const VAULT_REACH = {
  yes: "reachable now",
  no: "did not answer",
  unknown: "not ours to check",
} as const;

/** The connect form (04 §11: the list permission is asked for with what it
 *  buys, never silently). The five providers are engine 11's. */
export const VAULT_CONNECT = {
  title: "Connect a vault",
  id: "Id",
  idHint: "What this vault is called here; groups name it. Lower case, no spaces.",
  provider: "Provider",
  auth: "How we authenticate",
  listPermission: "Ask for list permission",
  listPermissionHint:
    "With it the console can show what is inside and find a group that points at a secret you do not have. Without it we show what an admin declared and say so.",
  submit: "Connect it",
  providers: ["bundled", "aws", "azure", "hashicorp", "gcp", "1password"],
} as const;
