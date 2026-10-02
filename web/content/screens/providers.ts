/**
 * Providers — console 04 §10 (harness providers, model providers).
 * One module covers both tabs (`00 §5` treats them as one screen row).
 *
 * W6-D5 folded Routing in: it is a setting on a model provider row — *Default
 * for* and *Approved for* as columns, with the two verbs that write them — and
 * the old matrix is a read view behind the *By team* toggle.
 */
import type { ScreenContent } from "../types";

export type ProvidersColumn =
  | "provider"
  | "approval"
  | "approvedFor"
  | "pin"
  | "speaks"
  | "reason"
  | "decidedBy"
  | "when"
  | "endpoints"
  | "models"
  | "credentialAlias"
  | "status"
  | "defaultFor"
  | "approvedForRouting";
export type ProvidersVerb =
  | "approve"
  | "moveToBeta"
  | "decline"
  | "setApprovalScope"
  | "setUp"
  | "addModelProvider"
  | "setRouting"
  | "approveFor"
  | "removeApproval"
  | "deleteModelProvider";

export const PROVIDERS: ScreenContent<ProvidersColumn, ProvidersVerb, "providers" | "providers.model"> = {
  title: "Providers",
  lede: "A harness provider is the program the assistant runs in; a model provider is where the model itself comes from.",
  /** The two tabs' own sentences, which used to be the lede of whichever tab
   *  was open (W6-D5 folded Routing into the second one). */
  about: [
    "The program the assistant runs in. Not approved is a state, so a declined runtime is a row with its reason.",
    "Where the model itself comes from, with an endpoint per wire format, and which teams, harnesses and runtimes it serves.",
  ],
  columns: {
    provider: { heading: "Provider", help: "The runtime or model provider's name." },
    approval: {
      heading: "Approval",
      scale: "approval",
      help: "Whether this runtime is approved, in beta, or not approved for your organisation.",
    },
    approvedFor: { heading: "Approved for", unit: "teams", help: "Which teams may use this runtime." },
    pin: { heading: "Pin", help: "The exact commit or minimum version this runtime is pinned to." },
    speaks: { heading: "Speaks", help: "Which model wire formats this runtime can use." },
    reason: { heading: "Reason", help: "Why this runtime was approved, put in beta, or declined." },
    decidedBy: { heading: "Decided by", help: "Who approved, moved or declined this runtime." },
    when: { heading: "When", help: "When this decision was made." },
    endpoints: { heading: "Endpoints", help: "This model provider's address for each wire format it speaks." },
    models: { heading: "Models", help: "Which models this provider offers." },
    credentialAlias: { heading: "Credential alias", help: "The alias a harness uses to reach this model provider." },
    status: {
      heading: "Status",
      scale: "providerStatus",
      help: "Whether a key is held for this provider and whether its endpoint answered.",
    },
    defaultFor: {
      heading: "Default for",
      help: "The teams, harnesses and runtimes whose sessions use this provider unless something nearer says otherwise.",
    },
    approvedForRouting: {
      heading: "Approved for",
      help: "The teams, harnesses and runtimes that may use this provider at all.",
    },
  },
  verbs: {
    approve: { label: "Approve", explain: "Lets every scoped harness run this provider and be handed credentials with it." },
    moveToBeta: {
      label: "Move to beta",
      explain: "Lets anyone scoped to it run it, but only an admin is handed credentials with it.",
    },
    decline: { label: "Decline", explain: "Stops anyone from running this provider, with a reason recorded." },
    setApprovalScope: { label: "Set approval scope", explain: "Chooses which teams this approval reaches." },
    setUp: {
      label: "Set up",
      explain:
        "Paste a key and pick a default model; the key reaches every team and becomes the organisation's default.",
    },
    addModelProvider: {
      label: "Add a model provider",
      explain: "Registers a new endpoint, model list and credential alias.",
    },
    setRouting: {
      label: "Set default…",
      explain: "Chooses a team, harness or runtime whose sessions use this provider by default.",
    },
    approveFor: {
      label: "Approve for…",
      explain: "Lets a team, harness or runtime use this provider at all. A default must be approved first.",
    },
    removeApproval: {
      label: "Remove",
      explain: "Takes this approval back. A default that was relying on it stops resolving.",
    },
    deleteModelProvider: {
      label: "Delete",
      explain: "Removes this provider from the organisation. Refused while anything still points at it.",
    },
  },
  empty: "providers",
};

/**
 * The rest of the Providers screens' words (04 §10): the three tabs, the
 * routing matrix's two column groups, and the refusal 04 §10 gives verbatim.
 * 07 §3 hides approval, scope and the matrix at *n* = 0.
 */
export const PROVIDERS_TEXT = {
  decideSubmit: "Record the decision",
  tabs: { harness: "Harness providers", model: "Model providers" },
  defaultFor: "Default for",
  approvedFor: "Approved for",
  rowTeams: "Teams",
  rowHarnesses: "Harnesses",
  rowProviders: "Runtimes",
  resolved: "Resolves to",
  none: "none",
  declineTitle: "Decline this runtime",
  declineReason: "Reason",
  declineReasonHint: "Everyone who tries to run it reads this.",
  cancel: "Cancel",
  /** 04 §10 *States*, 05 §12 steps 4 and 5: the catalogue is never empty, so
   *  the first run is a notice above the table that disappears by being done. */
  firstRun: {
    harness: "No runtime is approved yet, so nobody can start a session. Turn one on below.",
    model: "No key is connected yet, so a session has nowhere to send a request. Set one up below.",
  },
  setUpTitle: "Connect a key for {provider}",
  setUpKey: "Key",
  setUpKeyHint: "Stored in the bundled vault. Never shown again.",
  setUpModel: "Default model",
  setUpSubmit: "Connect the key",
  setUpDone: "The key is connected and reaches every team.",
  setUpDoneDefault:
    "The key is connected, reaches every team, and is what a session uses unless a team says otherwise.",
  /** W6-D5: the tab's own view switch, and the picker both verbs share. */
  views: { rows: "By provider", byTeam: "By team" },
  viewLabel: "How to read routing",
  byTeamNote:
    "The same routing, read as the matrix: one row per team, with what it resolves to.",
  pickDimension: "What for",
  dimensions: { teams: "A team", harnesses: "A harness", providers: "A runtime" },
  pickSubject: "Which one",
  setDefaultTitle: "Set {provider} as the default for…",
  approveForTitle: "Approve {provider} for…",
  setDefaultSubmit: "Set the default",
  approveForSubmit: "Approve it",
  remove: "Remove",
  /** W6-D6: the row says why it is out, where the admin is standing. */
  needsKeyNote: "Needs a key: nothing routes here.",
  /** W7-D2: not a problem, so not said where a refusal would be — said where
   *  the row explains its status, because what it changes is where the request
   *  goes, and that is the one thing a person has to know before choosing it. */
  signInNote: "Your sign-in: the runtime logs in itself and the session is not metered.",
  /** The 05-level honesty line (W7-D2). A sign-in session is a direct TLS
   *  request to the provider, so nothing of ours is in the middle of it: the
   *  model request cannot be shaped and provider-side browsing cannot be
   *  stripped. Reach on the machine is unaffected — the tunnel is still the
   *  only way out of the jail. Said here, where the status is explained,
   *  because *Set up* is the thing that changes it. */
  signInReach:
    "On a sign-in session the request goes straight to the provider over TLS, so provider-side browsing cannot be stripped. Reach on the machine still holds: the harness's own network rules are unchanged. Add a key to route it through the harness.",
  deleteTitle: "Delete {provider}",
  /** 04 §18: what the delete takes, not *are you sure* — and what stops it,
   *  because the server checks both and the row cannot. */
  deleteTakes:
    "Takes the provider out of the organisation. Refused while a team, harness or runtime still routes to it, or a security group holds its key.",
  deleteSubmit: "Delete the provider",
  deleteDone: "{provider} is gone from the organisation.",
} as const;
