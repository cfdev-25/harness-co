/* Fixtures for the org-configuration prototype. Nothing here talks to the
   API: the point of the route is to settle shape and navigation before any
   of it is wired up.

   The relationships are ONE list of edges, and both directions of every
   screen are derived from it. That is deliberate — docs/prd-v2.md §3.1 says
   the definition index has to store edges rather than assets alone, because
   "which harnesses use this key" spans every branch in the org and git
   cannot answer it. This file is the smallest honest demonstration. */

import type { Tone } from "../ui";

export type Kind =
  | "guide"
  | "secret"
  | "provider"
  | "model"
  | "keystore"
  | "access"
  | "boundary"
  | "resource"
  | "asset"
  | "change"
  | "permchange"
  | "provchange"
  | "peoplechange"
  | "person"
  | "team"
  | "harness";

export interface Fact {
  label: string;
  value: string;
  mono?: boolean;
}

export interface Elsewhere {
  what: string;
  where: string;
  why: string;
}

export interface Change {
  when: string;
  who: string;
  plain: string;
  git: string;
}

export interface Entity {
  id: string;
  kind: Kind;
  name: string;
  blurb: string;
  badges?: { label: string; tone: Tone }[];
  /** The one decision this screen owns, in a sentence. */
  decision?: string;
  facts?: Fact[];
  /** Probe results. Not stored, not declared — asked when the screen is drawn. */
  checks?: Fact[];
  /** What a harness is likely to reach, given the work it does. Derived, not
      authored: its groups imply endpoints, its tools name the hosts they
      call, and sessions establish a norm. Descriptive — the blacklist is the
      thing that refuses. */
  reach?: { endpoint: string; from: string; via: string; status: string }[];
  /** Aliases an asset needs a security group to provide. */
  needsAliases?: string[];
  /** Relationship columns whose answer is "all of them" rather than a list.
      Keyed by column heading. */
  everyone?: string[];
  /** A single scannable value for a list column — a date, a count. */
  meta?: string;
  /** What a group holds: the alias a harness uses, and what it resolves to. */
  contents?: { alias: string; secret: string; note?: string; strength?: string }[];
  elsewhere?: Elsewhere[];
  history?: Change[];
}

/** `label` reads from → to; `inverse` reads to → from. */
export interface Edge {
  from: string;
  to: string;
  label: string;
  inverse: string;
}

export const KIND_LABEL: Record<Kind, string> = {
  guide: "How to read this",
  secret: "Secret",
  provider: "Harness provider",
  model: "Model provider",
  keystore: "Key vault",
  access: "Security group",
  boundary: "Boundary",
  resource: "Endpoint",
  asset: "Organisation asset",
  change: "Harness change",
  permchange: "Permission change",
  provchange: "Provider change",
  peoplechange: "People change",
  person: "Person",
  team: "Team",
  harness: "Harness",
};

export const GROUPS: { heading: string; kinds: Kind[] }[] = [
  { heading: "Start here", kinds: ["guide"] },
  { heading: "Providers", kinds: ["provider", "model"] },
  { heading: "Permissions", kinds: ["keystore", "secret", "boundary", "access"] },
  { heading: "Logs", kinds: ["change", "permchange", "provchange", "peoplechange", "resource"] },
  { heading: "People", kinds: ["person", "team"] },
  /* A harness is a rolled-up distribution of assets, so it belongs beside
     the assets rather than off on its own. */
  { heading: "Assets", kinds: ["asset", "harness"] },
];

export const ENTITIES: Entity[] = [
  /* Guide ---------------------------------------------------------------- */
  {
    id: "guide.overview",
    kind: "guide",
    name: "What you set up here, and why",
    blurb: "The whole model on one page.",
    decision:
      "Two sentences cover the whole of it. A build runs only if it is approved, and only an admin runs one still in beta. A group marked must-expire is minted only from secrets that die with the session.",
    facts: [
      { label: "Providers →", value: "Harness providers · Model providers" },
      { label: "Harness providers", value: "Every runtime you could run, and whether you may" },
      { label: "Model providers", value: "Where models come from; one is the org default" },
      { label: "Credential management →", value: "Key providers · Key provider secrets · Security groups" },
      { label: "Key providers", value: "The vaults holding your secrets. We keep references, never values" },
      { label: "Key provider secrets", value: "What is actually in them, read by listing" },
      { label: "Security groups", value: "A named group of secrets, granted to teams" },
      { label: "Logs →", value: "Changes · Endpoints reached" },
      { label: "Changes", value: "Every edit to a definition, and every decision about one" },
      { label: "Endpoints reached", value: "What your harnesses actually dialled. A record, not a control" },
      { label: "People →", value: "People · Teams" },
      { label: "People", value: "Everyone here, and everyone invited" },
      { label: "Teams", value: "The groups everything is granted to. Being in one is the grant" },
      { label: "Assets →", value: "Organisation assets · Harnesses" },
      { label: "Organisation assets", value: "Rules and skills everyone gets, written once for every runtime" },
      { label: "Harnesses", value: "What your teams built — a rolled-up distribution of assets" },
    ],
    elsewhere: [
      {
        what: "Where each fact comes from",
        where: "Three places",
        why:
          "Someone typed it (a commit, with an author). A probe answered it just now (live, never stored). Or we worked it out from what harnesses declare they need. Each screen keeps those apart rather than mixing them into one list.",
      },
    ],
  },
  {
    id: "guide.trust",
    kind: "guide",
    name: "Approval — may this build run",
    blurb: "Applies to harness providers.",
    decision:
      "Once a credential is handed into a program, that program is inside the fence. So every build is in one of three states, and an org arrives with everything in the last one. This is about the program, never about what a team writes — a new tool, skill or prompt is never gated by it, because it runs inside a build that already passed.",
    facts: [
      {
        label: "approved",
        value: "Greenlit. Anyone the build is scoped to may run it, and it may be handed credentials like any other",
      },
      {
        label: "beta",
        value:
          "Being tried out, or forked and awaiting review. It runs, but only an admin is ever handed credentials with it — everyone else waits. Pinned to one exact build, so what is being reviewed is what is running",
      },
      {
        label: "not approved",
        value:
          "Blacklisted, or simply never turned on. Every provider starts here: the catalogue is what you could run, not what you may. Saying no explicitly beats leaving it absent, because the next person to ask can see it was decided",
      },
      {
        label: "Not covered by this",
        value:
          "A team's own tool can read the environment it runs in. Trust does nothing about that — the egress fence does, because there is nowhere to send it, and the team branch is reviewable because it is git",
      },
    ],
  },
  {
    id: "guide.strength",
    kind: "guide",
    name: "Where the credential comes from",
    blurb: "Applies to secrets and security groups.",
    decision:
      "The only distinction that is ours to make. How long a key lives, when it rotates and whether it is still used are the vault's business and the customer's \u2014 not something for us to grade.",
    facts: [
      {
        label: "vault-supplied",
        value:
          "We resolve it at launch from a key provider and hand it to the harness. We can see it exists, confirm it before the session starts, and stop supplying it",
      },
      {
        label: "locally-owned",
        value:
          "A browser sign-in or a machine login the person made themselves. We never hold it, cannot inject it, and only learn about it once the session is up",
      },
      {
        label: "How it is used",
        value:
          "A security group declares which sources it will accept. Vault only means the chain has exactly one entry, so if the vault does not resolve, the launch fails rather than quietly falling back to whatever the person happens to be logged into",
      },
    ],
  },
  {
    id: "guide.requirement",
    kind: "guide",
    name: "Sources allowed — how far down the chain",
    blurb: "Applies to security groups.",
    decision:
      "Credentials resolve down an ordered chain: an explicit override, then the vault, then whatever ambient login the machine already has. A security group declares how far down it will go. This is the standard shape — the AWS provider chain, git's credential.helper and Docker's credential stores all work this way.",
    facts: [
      {
        label: "vault only",
        value:
          "The chain has exactly one entry. If the vault does not resolve, the launch fails — it never falls back to whatever the person happens to be logged into. Fail closed, not fall through",
      },
      {
        label: "vault or local",
        value:
          "An ambient sign-in is acceptable. The fallback is never silent: preflight reports which source actually resolved, and the session keeps that record",
      },
      {
        label: "Why silent fallback is the trap",
        value:
          "A chain that quietly falls through works on one laptop and not another, and uses the wrong identity in CI. Security properties vary by machine and nobody knows. The order is fixed, and not configurable per person",
      },
    ],
  },
  {
    id: "guide.resolved",
    kind: "guide",
    name: "Resolved from — which source actually answered",
    blurb: "Applies to every credential a session uses.",
    decision:
      "Every mature tool with a credential chain ships a way to ask which entry answered — aws sts get-caller-identity, gh auth status, vault token lookup. Preflight is ours, and the answer is kept with the session, because an opaque chain is an unreviewable one.",
    facts: [
      {
        label: "Per slot, before launch",
        value:
          "Preflight reports the source that resolved each credential, not merely satisfied or unsatisfied: resolved from the Finance group, or resolved from your local AWS session",
      },
      {
        label: "Kept with the session",
        value:
          "So “how did this run as that identity three weeks ago” is answerable here. The target system's own logs show only the end result",
      },
      {
        label: "Why it is not optional",
        value:
          "It is the single field that makes a fallback chain safe to have. An admin can look at a session and see a production credential came from the vault and not from somebody's laptop",
      },
    ],
  },
  {
    id: "guide.record",
    kind: "guide",
    name: "Record — what we saw, and whether we expected it",
    blurb: "Applies to endpoints and secrets.",
    decision:
      "An observed log needs a word for every combination of reached and accounted for. These are those words.",
    facts: [
      { label: "credentialed", value: "Reached, and a security group mints for it. The ordinary case" },
      {
        label: "not credentialed",
        value: "Reached on a credential we never handed out — usually a personal sign-in. Expected, still worth seeing",
      },
      {
        label: "unaccounted for",
        value:
          "Reached, and nothing in the org credentials it. Somebody is using a login we do not manage. We cannot stop it; we can say it is happening",
      },
      {
        label: "new",
        value:
          "Reached, and nothing about the harness predicted it. Not a refusal — the one row worth a second look",
      },
      { label: "covered", value: "On a secret: at least one security group reaches it" },
      { label: "unreached", value: "On a secret: nothing here can get to it" },
    ],
  },
  {
    id: "guide.web",
    kind: "guide",
    name: "Outside endpoints — the one switch in between",
    blurb: "Applies to harnesses.",
    decision:
      "Reach has two ends that need no decision and one gradient that does. What a harness is credentialed for is reachable because we supply it. What a boundary names is refused. Everything else is one grant.",
    facts: [
      {
        label: "always reachable",
        value: "The endpoints behind its security groups, and its model provider. Derived from grants already made",
      },
      { label: "never reachable", value: "Anything a boundary names, whatever else is granted" },
      {
        label: "Why not called web access",
        value:
          "The log of what was actually dialled is called Endpoints reached, so the permission that governs it should use the same word. One vocabulary for the grant and the record",
      },
      {
        label: "allowed",
        value:
          "Everything else, minus the boundaries. The harness gets a search-and-fetch tool and the reach to use it — research, documentation, package registries",
      },
      {
        label: "prohibited",
        value: "Nothing else at all. It reaches what it was granted and no more",
      },
    ],
  },
  {
    id: "guide.holds",
    kind: "guide",
    name: "Enforcement — does it hold?",
    blurb: "Applies to boundaries.",
    decision:
      "Every boundary says which of these it is, because a control that only looks like a fence is worse than no fence: people plan around it.",
    facts: [
      {
        label: "enforced",
        value:
          "No route and no permission. The packet has nowhere to go, the filesystem has nothing to write to, or the binary is not there. It holds whatever the agent tries, and it is fine for the agent to know exactly how it works",
      },
      {
        label: "intercepted",
        value:
          "Every invocation is checked before it runs, at the provider's permission hook and again at a shim ahead of the real binary. The check always happens; what is incomplete is coverage, since the same effect can be written another way. Always paired with an enforced boundary behind it",
      },
    ],
  },
  {
    id: "guide.role",
    kind: "guide",
    name: "Role — what a person may do",
    blurb: "Applies to people.",
    decision:
      "Three roles, each easiest to define by what it may not do. There is no per-person permission list anywhere; a role plus a team membership is the whole of it.",
    facts: [
      { label: "org admin", value: "Approves builds, connects vaults, creates security groups, sets boundaries" },
      {
        label: "team admin",
        value:
          "May narrow what their team already holds down to a sub-team, and may launch a build in beta. May not widen anything, create a group, or change which sources a group allows",
      },
      { label: "member", value: "Uses what their teams are given" },
    ],
  },
  {
    id: "guide.review",
    kind: "guide",
    name: "State — where a change got to",
    blurb: "Applies to changes.",
    decision:
      "A change to a definition is a commit, so it has the states a pull request does. Nothing is blocked while one waits: the person who made it keeps their version, everyone else keeps theirs.",
    facts: [
      { label: "awaiting review", value: "Pushed, not yet accepted. Live for its author and nobody else" },
      { label: "accepted", value: "Merged. Everyone on that branch gets it at their next session" },
      { label: "declined", value: "Refused, with the reason recorded so it is not re-opened" },
      { label: "rolled back", value: "Accepted, then reverted. The previous version is live again" },
    ],
  },
  {
    id: "guide.certainty",
    kind: "guide",
    name: "Certainty — how we know",
    blurb: "Applies to anything we report a status for.",
    decision:
      "A status is not a yes or a no. It also carries how we came to believe it, and we never round that up.",
    facts: [
      { label: "verified", value: "We checked it ourselves, just now" },
      { label: "reported", value: "The tool says so. We are taking its word" },
      { label: "declared", value: "Expected, but nobody has looked. Shown as such rather than as a tick" },
    ],
  },
  {
    id: "guide.reach",
    kind: "guide",
    name: "Reach — who gets it",
    blurb: "Applies to providers, assets and models.",
    decision:
      "Everything on a team's branch reaches everyone on that team. Keeping something away from one person means putting it on a smaller team, not ticking a box.",
    facts: [
      { label: "approved for", value: "Which builds a model provider may be used by. Not every runtime can speak to every model endpoint, and every harness needs one valid pairing of the two" },
      { label: "always loaded", value: "On an organisation asset: it goes into every harness and no filter can leave it out. Compliance rules live here" },
      { label: "when chosen", value: "On an organisation asset: published and available, included by whoever builds the harness" },
      { label: "org-wide", value: "Everyone, every team" },
      { label: "n teams", value: "Only the teams named. Others do not see it at all" },
      { label: "default / override", value: "What is used unless a team says otherwise — overrides should be rare enough to notice" },
    ],
  },

  /* Harness providers ---------------------------------------------------- */
  {
    id: "provider.claude-code",
    kind: "provider",
    name: "Claude Code",
    blurb: "Approved for everyone.",
    badges: [
      { label: "anthropic", tone: "neutral" },
      { label: "approved", tone: "ok" },
      { label: "org-wide", tone: "accent" },
    ],
    decision: "Anyone in the org may run this.",
    facts: [
      { label: "Supply chain", value: "Official release channel" },
      { label: "Version floor", value: "2.4.0", mono: true },
      { label: "Permitted since", value: "12 March 2026" },
    ],
    history: [
      {
        when: "12 Mar 2026",
        who: "Dana Okafor",
        plain: "Allowed Claude Code for everyone, and required version 2.4.0 or newer.",
        git: "commit 8a1f20c  org/providers/claude-code.toml\n+ trust = \"verified\"\n+ min_version = \"2.4.0\"",
      },
    ],
  },
  {
    id: "provider.pi",
    kind: "provider",
    name: "Pi",
    blurb: "Approved for everyone.",
    badges: [
      { label: "anthropic", tone: "neutral" },
      { label: "approved", tone: "ok" },
      { label: "org-wide", tone: "accent" },
    ],
    decision: "Anyone in the org may run this.",
    facts: [
      { label: "Supply chain", value: "Official release channel" },
      { label: "Version floor", value: "0.9.1", mono: true },
    ],
  },
  {
    id: "provider.cursor",
    kind: "provider",
    name: "Cursor",
    blurb: "Approved for Support only.",
    badges: [
      { label: "openai", tone: "neutral" },
      { label: "approved", tone: "ok" },
      { label: "1 team", tone: "neutral" },
    ],
    decision: "Only teams listed below may run this.",
    facts: [{ label: "Supply chain", value: "Official release channel" }],
  },
  {
    id: "provider.acme-fork",
    kind: "provider",
    name: "Acme Code (internal fork)",
    blurb: "Engineering\u2019s fork. In beta \u2014 admins only.",
    badges: [
      { label: "anthropic", tone: "neutral" },
      { label: "beta", tone: "hold" },
      { label: "1 team", tone: "neutral" },
    ],
    decision:
      "Engineering may run this while it is under review, but only an admin can launch it with credentials — everyone else waits for approval. It reaches nothing protected at all until a reviewer signs it off.",
    facts: [
      { label: "Source", value: "github.com/acme/acme-code", mono: true },
      { label: "Pinned to", value: "4f2c9ab", mono: true },
      { label: "Built by", value: "Engineering" },
      { label: "Review", value: "Environment handling — not started" },
      { label: "Review", value: "Network egress — not started" },
    ],
    history: [
      {
        when: "4 Sep 2026",
        who: "Sam Whitfield",
        plain:
          "Submitted the internal fork for review, pinned to one exact build, scoped to Engineering.",
        git: "commit 4f2c9ab  org/providers/acme-fork.toml\n+ trust = \"pending\"\n+ pin = \"4f2c9ab\"\n+ scope = [\"engineering\"]",
      },
    ],
  },

  {
    id: "provider.windsurf",
    kind: "provider",
    name: "Windsurf",
    blurb: "In the catalogue. Nobody has asked for it.",
    badges: [{ label: "not approved", tone: "warn" }],
    decision:
      "Available to turn on, and off until someone does. Every provider starts here — the catalogue is what you could run, not what you may.",
  },
  {
    id: "provider.aider",
    kind: "provider",
    name: "Aider",
    blurb: "In the catalogue. Declined in March.",
    badges: [{ label: "not approved", tone: "warn" }],
    decision:
      "Deliberately not approved. Saying no explicitly is worth more than leaving it absent, because the next person to ask can see it was already decided.",
    history: [
      {
        when: "3 Mar 2026",
        who: "Dana Okafor",
        plain: "Declined after review — no way to pin a build, so we cannot tell what people would be running.",
        git: "commit 91c4d0a  org/providers/aider.toml\n+ approval = \"not approved\"\n+ reason = \"no pinnable build\"",
      },
    ],
  },

  /* Model providers ------------------------------------------------------ */
  {
    id: "model.gateway",
    kind: "model",
    name: "Self-hosted gateway",
    blurb: "Used unless something more specific says otherwise.",
    badges: [
      { label: "anthropic", tone: "neutral" },
      { label: "openai", tone: "neutral" },
    ],
    everyone: ["Default for teams"],
    decision:
      "Default for every team, so it is what a harness gets unless a team, a harness or a harness provider says otherwise. Most specific wins.",
    facts: [
      { label: "Endpoint", value: "models.internal.acme.co", mono: true },
      { label: "Models", value: "claude-opus-5, claude-sonnet-5, llama-3.3-70b" },
      { label: "Added by", value: "Dana Okafor, 12 March 2026" },
    ],
    checks: [{ label: "Reachable", value: "Yes — answered in 120ms" }],
    elsewhere: [
      {
        what: "Spend caps and rate limits",
        where: "Gateway admin",
        why: "The gateway enforces them. Mirroring the numbers here would just let them go stale.",
      },
    ],
  },
  {
    id: "model.bedrock",
    kind: "model",
    name: "AWS Bedrock",
    blurb: "Engineering's default, and Pi's.",
    badges: [
      { label: "anthropic", tone: "neutral" },
    ],
    decision:
      "Engineering harnesses route here rather than to the org default. Code review is pinned back to the gateway, which is what harness-level pinning is for.",
    facts: [
      { label: "Region", value: "us-east-1", mono: true },
      { label: "Models", value: "claude-opus-5, claude-sonnet-5 (Bedrock endpoints)" },
      { label: "Added by", value: "Sam Whitfield, 2 August 2026" },
    ],
  },
  {
    id: "model.openrouter",
    kind: "model",
    name: "OpenRouter",
    blurb: "Support's default. Approved for Marketing.",
    badges: [
      { label: "openai", tone: "neutral" },
    ],
    decision:
      "Support routes here by default. Marketing may choose it for a harness but does not get it automatically — available is a weaker thing than default.",
  },

  /* Key providers -------------------------------------------------------- */
  {
    id: "keystore.aws",
    kind: "keystore",
    name: "AWS Secrets Manager",
    blurb: "Acme's own vault. Session credentials, expiring with the session.",
    badges: [
      { label: "issues temporary", tone: "ok" },
      { label: "customer-owned", tone: "neutral" },
      { label: "listed", tone: "ok" },
    ],
    decision:
      "This vault can create a credential that did not exist before and make it expire. Whether a given secret in it actually does that is a property of the secret — a static key stored here is still a static key.",
    facts: [
      { label: "Reached by", value: "IAM role assumption" },
      { label: "Grouped by", value: "Tag — Team and Env" },
      { label: "Credential lifetime", value: "Expires with the session" },
    ],
    checks: [
      { label: "Vault reachable", value: "Yes — answered in 240ms" },
      { label: "Can mint", value: "Yes" },
      { label: "Secrets listed", value: "14, across 3 groups — names and metadata only, never values" },
      { label: "Nothing here can reach", value: "1 secret — billing/stripe-live" },
    ],
    elsewhere: [
      {
        what: "What each secret is allowed to do",
        where: "AWS IAM",
        why: "The policy lives on the role. Two teams can hold keys to the same account with different rights.",
      },
    ],
  },
  {
    id: "keystore.vault",
    kind: "keystore",
    name: "HashiCorp Vault",
    blurb: "On-premises. Used for anything touching the production database.",
    badges: [
      { label: "issues temporary", tone: "ok" },
      { label: "customer-owned", tone: "neutral" },
      { label: "listed", tone: "ok" },
    ],
    decision:
      "This vault can create a credential that did not exist before and make it expire. Whether a given secret in it actually does that is a property of the secret.",
    facts: [
      { label: "Reached by", value: "AppRole" },
      { label: "Grouped by", value: "Path" },
      { label: "Credential lifetime", value: "Expires with the session" },
    ],
    checks: [
      { label: "Vault reachable", value: "Yes — answered in 90ms" },
      { label: "Can mint", value: "Yes" },
      { label: "Secrets listed", value: "31, across 5 paths" },
    ],
  },
  {
    id: "keystore.onepassword",
    kind: "keystore",
    name: "1Password",
    blurb: "Read-only. Values are fetched at launch and cannot be cut short.",
    badges: [
      { label: "stores values", tone: "neutral" },
      { label: "customer-owned", tone: "neutral" },
      { label: "not listed", tone: "hold" },
    ],
    decision:
      "We can read secrets here but cannot mint a short-lived one, so anything using it is reported honestly as the weaker guarantee.",
    facts: [
      { label: "Reached by", value: "Service account token" },
      { label: "Credential lifetime", value: "Whatever the stored value's own lifetime is" },
      {
        label: "Inventory",
        value:
          "Not available. Nobody has granted us permission to list this vault, so we can show only what an admin typed here — no secret names, no rotation age, no unused-secret or orphan detection",
      },
    ],
  },

  /* Security groups -------------------------------------------------------- */
  {
    id: "keystore.local",
    kind: "keystore",
    name: "The person's own machine",
    blurb: "Browser sign-ins and CLI logins. Not a vault, and not ours.",
    badges: [
      { label: "stores values", tone: "neutral" },
      { label: "not listed", tone: "hold" },
      { label: "locally-owned", tone: "neutral" },
    ],
    decision:
      "Listed as a provider because that is what it is: somewhere credentials come from. We cannot read, rotate or inject anything here \u2014 what we can do is name it, see which security groups reference it, and say plainly that it is outside our reach.",
    facts: [
      { label: "What lives here", value: "Google and Slack sign-ins, gh and aws CLI logins" },
      { label: "What we can do", value: "Probe whether it is present, and show the command that creates it" },
      { label: "What we cannot do", value: "Read it, rotate it, hand it to a harness, or confirm it before launch" },
    ],
  },
  {
    id: "keystore.hosted",
    kind: "keystore",
    name: "Harness-hosted vault",
    blurb: "Ours. For teams without a vault of their own.",
    badges: [
      { label: "issues temporary", tone: "ok" },
      { label: "we host it", tone: "accent" },
      { label: "listed", tone: "ok" },
    ],
    decision:
      "The only vault an admin can write to from this console. Paste a key, name it, scope it, rotate it — the same flow a marketing manager can run. For a vault you own, creating a secret happens there, by someone with rights there.",
    facts: [
      { label: "Reached by", value: "Managed internally" },
      { label: "Credential lifetime", value: "Expires with the session" },
      { label: "Writes allowed", value: "Yes — create and rotate from this console" },
    ],
    checks: [
      { label: "Secrets held", value: "6" },
      { label: "Rotation overdue", value: "1 — see below" },
    ],
  },
  /* Secrets — names and metadata, read by listing. Never values. --------- */
  {
    id: "secret.alldb",
    kind: "secret",
    name: "db/all-read",
    blurb: "Read-only across every database. Three teams reach it.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "covered", tone: "neutral" },
    ],
    decision:
      "One secret, three security groups, three teams. We do not grant this in your vault — your vault already permits it. What we decide is which of those teams may have it minted, and a team without an security group cannot, whatever the vault would allow.",
    facts: [
      { label: "Minted how", value: "Vault creates a fresh role on request and expires it with the session" },
      { label: "Path", value: "secret/db/all-read", mono: true },
      { label: "Group", value: "secret/db/", mono: true },
    ],
    checks: [
      { label: "Last rotated", value: "31 days ago" },
      { label: "Last read", value: "Today, 09:14" },
    ],
  },
  {
    id: "secret.warehouse-ro",
    kind: "secret",
    name: "analytics/warehouse-ro",
    blurb: "The Finance warehouse role.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "covered", tone: "neutral" },
    ],
    facts: [{ label: "Group", value: "Tag: Team=finance", mono: true }],
    checks: [
      { label: "Last rotated", value: "12 days ago" },
      { label: "Last read", value: "Today, 09:14" },
    ],
  },
  {
    id: "secret.migrator",
    kind: "secret",
    name: "db/migrator",
    blurb: "The production migration role.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "covered", tone: "neutral" },
    ],
    facts: [{ label: "Group", value: "secret/db/", mono: true }],
    checks: [{ label: "Last read", value: "Yesterday, 17:02" }],
  },
  {
    id: "secret.stripe",
    kind: "secret",
    name: "billing/stripe-live",
    blurb: "In the vault. Nothing here can reach it.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "unreached", tone: "warn" },
    ],
    decision:
      "It exists in your vault and no security group covers it, so nobody can get it through us. Either it is dead, or something outside this platform is using it. We cannot tell which — we can only tell you it is there.",
    facts: [
      {
        label: "Minted how",
        value:
          "Read as-is. This vault can mint dynamically; this particular secret is a stored string, so nothing can cut it short",
      },
      { label: "Group", value: "Tag: Env=prod", mono: true },
    ],
    checks: [
      { label: "Last rotated", value: "412 days ago, as the vault reports it" },
      { label: "Last read", value: "Never, as far as the vault reports" },
    ],
  },
  {
    id: "secret.sendgrid",
    kind: "secret",
    name: "marketing/sendgrid",
    blurb: "The mailing key. Marketing only, not interns.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "covered", tone: "neutral" },
    ],
    facts: [{ label: "Group", value: "Tag: Team=marketing", mono: true }],
    checks: [{ label: "Last read", value: "104 days ago" }],
  },
  {
    id: "secret.drive-oauth",
    kind: "secret",
    name: "Google Drive — personal sign-in",
    blurb: "Held by the harness provider. We never see it.",
    badges: [
      { label: "locally-owned", tone: "neutral" },
      { label: "covered", tone: "neutral" },
    ],
    decision:
      "Not in a vault and not ours to hold — each person signs in to Google themselves and the token lives in the tool. It is on this screen because an admin asking \"how does anything here authenticate?\" should get one answer, not two.",
    facts: [
      { label: "Where it lives", value: "The harness provider's own credential store, on the person's machine" },
      { label: "What we can do", value: "Name it, see which groups reference it, and record that it was used" },
      { label: "What we cannot do", value: "Read it, rotate it, or confirm it before a session starts" },
    ],
    checks: [
      { label: "Confirmed?", value: "No — the provider reports it once the session is up, and not before" },
    ],
  },
  {
    id: "secret.gh-cli",
    kind: "secret",
    name: "GitHub CLI login",
    blurb: "Whatever gh auth login left on the machine.",
    badges: [
      { label: "locally-owned", tone: "neutral" },
      { label: "unreached", tone: "warn" },
    ],
    decision:
      "An ambient login nobody granted. It appeared because a session needed it and preflight could not account for it. We cannot hold it or inject it — but we can name it, show the exact command that creates it, and tell an admin it is in use.",
    facts: [
      { label: "Where it lives", value: "~/.config/gh on the person's own machine" },
      { label: "Discovered", value: "Exit reconciliation, after a Code review session used it" },
      { label: "Options", value: "Leave it ambient, or issue a token through a group and have the harness use that instead" },
    ],
    checks: [{ label: "Confirmed?", value: "Probed at launch — present on 3 of 5 machines" }],
  },
  {
    id: "secret.hosted-crm",
    kind: "secret",
    name: "crm-api-key",
    blurb: "In our hosted vault. Pasted here, rotates here.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "covered", tone: "neutral" },
    ],
    decision:
      "Held in the vault we run, so an admin can paste a new value and rotate it from this console without touching a terminal.",
    facts: [{ label: "Reference", value: "secret://marketing/crm-api-key", mono: true }],
    checks: [{ label: "Last rotated", value: "196 days ago, as the vault reports it" }],
  },

  /* Security groups — a named group of secrets, granted to teams ---------- */
  {
    id: "access.finance",
    kind: "access",
    name: "Finance",
    blurb: "What a Finance harness can be given.",
    badges: [
      { label: "vault only", tone: "accent" },
      { label: "vault-supplied", tone: "ok" },
      { label: "verified", tone: "ok" },
          ],
    decision:
      "Finance harnesses may have these two credentials minted for them, under these names. A harness asks for `warehouse`; this is what decides which secret that turns out to be, for this team.",
    contents: [
      { alias: "warehouse", secret: "secret.warehouse-ro", strength: "vault-supplied" },
      { alias: "db-read", secret: "secret.alldb", strength: "vault-supplied" },
    ],
    facts: [{ label: "Minted by", value: "Assuming an IAM role, 1 hour, tagged with the person" }],
    checks: [
      { label: "Both secrets still mint", value: "Yes" },
      { label: "Last used", value: "Today, 09:14" },
    ],
  },
  {
    id: "access.eng-migrations",
    kind: "access",
    name: "Engineering migrations",
    blurb: "The production migration role. Senior Engineering only.",
    badges: [
      { label: "vault only", tone: "accent" },
      { label: "vault-supplied", tone: "ok" },
      { label: "verified", tone: "ok" },
          ],
    decision:
      "Senior Engineering may have the migration role minted. Because this group is classed production, the broker refuses it for a build under review — being on the team is not enough.",
    contents: [{ alias: "prod-db", secret: "secret.migrator", strength: "vault-supplied" }],
    facts: [{ label: "Minted by", value: "Vault dynamic credentials, 30 minute lease" }],
    checks: [{ label: "Last used", value: "Yesterday, 17:02" }],
  },
  {
    id: "access.engineering",
    kind: "access",
    name: "Engineering",
    blurb: "Read-only database access for all of Engineering.",
    badges: [
      { label: "vault only", tone: "accent" },
      { label: "vault-supplied", tone: "ok" },
      { label: "verified", tone: "ok" },
          ],
    decision: "Everyone in Engineering may have the shared read-only database role minted.",
    contents: [{ alias: "db-read", secret: "secret.alldb", strength: "vault-supplied" }],
  },
  {
    id: "access.support",
    kind: "access",
    name: "Support",
    blurb: "The support bot's Slack token, plus read-only databases.",
    badges: [
      { label: "vault or local", tone: "neutral" },
      { label: "vault-supplied", tone: "ok" },
      { label: "verified", tone: "ok" },
          ],
    decision:
      "Support harnesses may have these minted. The Slack token is the weakest link here: 1Password cannot cut a credential short, so the whole group is only as strong as that.",
    contents: [
      {
        alias: "slack",
        secret: "",
        note: "1Password — no listing, so an admin typed the path",
        strength: "vault-supplied",
      },
      { alias: "db-read", secret: "secret.alldb", strength: "vault-supplied" },
    ],
    checks: [
      {
        label: "Why not production",
        value:
          "The Slack entry is a stored string nothing can cut short, so this group cannot be classed production. A group is only as strong as its weakest entry",
      },
    ],
  },
  {
    id: "access.marketing",
    kind: "access",
    name: "Marketing",
    blurb: "The CRM key and the mailing key.",
    badges: [
      { label: "vault or local", tone: "neutral" },
      { label: "vault-supplied", tone: "ok" },
      { label: "verified", tone: "ok" },
          ],
    decision: "Marketing harnesses may have both of these minted, under these names.",
    contents: [
      { alias: "crm", secret: "secret.hosted-crm", strength: "vault-supplied" },
      { alias: "email", secret: "secret.sendgrid", strength: "vault-supplied" },
    ],
  },
  {
    id: "access.marketing-interns",
    kind: "access",
    name: "Marketing interns",
    blurb: "The same group, without the mailing key.",
    badges: [
      { label: "vault or local", tone: "neutral" },
      { label: "vault-supplied", tone: "ok" },
      { label: "verified", tone: "ok" },
          ],
    decision:
      "Interns get the CRM key and not the mailing key. This is how something is kept away from someone: a narrower group granted to a smaller team, not a box unticked on a person.",
    facts: [
      { label: "Narrowed from", value: "Marketing" },
      { label: "Sub-granted by", value: "Rae Lindqvist, Marketing admin" },
      {
        label: "What they could not do",
        value:
          "Add an entry Marketing does not hold, change the class, or grant it outside their own teams. Narrowing down their own subtree is the whole permission",
      },
    ],
    history: [
      {
        when: "9 Sep 2026",
        who: "Rae Lindqvist",
        plain:
          "Created an interns group from Marketing's, leaving out the mailing key. No platform admin was needed — narrowing your own grant is a team admin's to do.",
        git: "commit b40aa17  org/access/marketing-interns.toml\n+ narrowed_from = \"marketing\"\n+ entries = [\"crm\"]\n+ granted_to = [\"marketing/interns\"]",
      },
    ],
    contents: [{ alias: "crm", secret: "secret.hosted-crm", strength: "vault-supplied" }],
  },
  {
    id: "access.web",
    kind: "access",
    name: "Web access",
    blurb: "The search-and-fetch tool, and the reach to use it.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "vault or local", tone: "neutral" },
    ],
    decision:
      "Web access is granted, not switched. It is a group like any other — which is what lets a team have it in general and one harness not have it, without a second mechanism for scoping.",
    contents: [
      { alias: "web", secret: "", note: "Our search provider key, held in the hosted vault", strength: "vault-supplied" },
    ],
    facts: [
      {
        label: "What it opens",
        value:
          "Everything except the boundaries. A harness without this grant reaches only what it is credentialed for, plus its model provider",
      },
      {
        label: "Scope",
        value: "Every harness these teams own. Engineering has a separate, narrower grant",
      },
    ],
  },
  {
    id: "access.web-eng",
    kind: "access",
    name: "Web access — Code review only",
    blurb: "The same tool, named to one harness.",
    badges: [
      { label: "vault-supplied", tone: "ok" },
      { label: "vault or local", tone: "neutral" },
    ],
    decision:
      "Engineering gets web access for one harness and not the rest. Schema migrations touches the production database and has no business browsing, so it is simply not named here.",
    contents: [
      { alias: "web", secret: "", note: "Our search provider key, held in the hosted vault", strength: "vault-supplied" },
    ],
    facts: [
      {
        label: "Why a separate grant",
        value:
          "A differently-scoped grant is a different grant. One group cannot be team-wide for Marketing and harness-specific for Engineering at the same time",
      },
    ],
  },
  {
    id: "access.marketing-drive",
    kind: "access",
    name: "Marketing → Google Drive",
    blurb: "Each person signs in themselves. We never hold the token.",
    badges: [
      { label: "vault or local", tone: "neutral" },
      { label: "locally-owned", tone: "neutral" },
      { label: "declared", tone: "hold" },
          ],
    decision:
      "Marketing reaches Drive through each person's own Google sign-in, held by the harness provider rather than by us.",
    contents: [
      {
        alias: "drive",
        secret: "",
        note: "No secret — a browser sign-in the person does",
        strength: "locally-owned",
      },
    ],
    checks: [
      {
        label: "Can we check it?",
        value: "No. The token lives in the provider, so we only learn about it once the session is up",
      },
    ],
  },

  /* Resources ------------------------------------------------------------ */
  /* Endpoints reached — observed, never catalogued ---------------------- */
  {
    id: "resource.warehouse",
    kind: "resource",
    name: "Analytics warehouse",
    blurb: "acme-prod.snowflakecomputing.com",
    badges: [{ label: "credentialed", tone: "ok" }],
    meta: "Today, 09:14",
    decision:
      "A record of an endpoint your harnesses actually reached. It controls nothing — the group that credentials it is where anything is allowed or refused.",
    facts: [
      { label: "Endpoint", value: "acme-prod.snowflakecomputing.com", mono: true },
      { label: "Named by", value: "Dana Okafor, 14 July 2026" },
      { label: "Permissions live in", value: "Snowflake console" },
    ],
    checks: [
      { label: "How we know", value: "The fence logged the connection, and the broker minted a credential for it" },
      { label: "Reached by", value: "1 harness, 3 people, 41 sessions in the last 30 days" },
      { label: "First seen", value: "14 July 2026" },
    ],
  },
  {
    id: "resource.prod-postgres",
    kind: "resource",
    name: "Production database",
    blurb: "db-prod.internal:5432",
    badges: [{ label: "credentialed", tone: "ok" }],
    meta: "Yesterday, 17:02",
    facts: [{ label: "Endpoint", value: "db-prod.internal:5432", mono: true }],
    checks: [
      { label: "How we know", value: "Fence log and broker mint agree" },
      { label: "Reached by", value: "1 harness, 2 people, 6 sessions in the last 30 days" },
    ],
  },
  {
    id: "resource.slack",
    kind: "resource",
    name: "Slack",
    blurb: "slack.com/api",
    badges: [{ label: "credentialed", tone: "ok" }],
    meta: "Today, 11:40",
    checks: [{ label: "Reached by", value: "1 harness, 9 people, 212 sessions in the last 30 days" }],
  },
  {
    id: "resource.drive",
    kind: "resource",
    name: "Google Drive",
    blurb: "www.googleapis.com/drive",
    badges: [{ label: "not credentialed", tone: "hold" }],
    meta: "3 days ago",
    decision:
      "Reached, but not through anything we mint — Marketing signs in to Google themselves. Expected, and worth showing rather than hiding, because it is the same shape as a connection nobody meant to make.",
    checks: [{ label: "How we know", value: "The fence logged it. No credential was minted, because the token is the person\u2019s own" }],
  },
  {
    id: "resource.hubspot",
    kind: "resource",
    name: "api.hubapi.com",
    blurb: "Nobody has named this. Nothing credentials it.",
    badges: [{ label: "unaccounted for", tone: "warn" }],
    meta: "6 days ago",
    decision:
      "A harness reached this and no group in the org credentials it, so somebody is using a login we do not manage. Nothing here can stop that. Telling you it is happening is the point.",
    checks: [
      { label: "How we know", value: "The fence logged the connection. No credential was ever minted for it" },
      { label: "Reached by", value: "1 harness, 1 person, 4 sessions in the last 30 days" },
    ],
  },
  {
    id: "resource.stripe",
    kind: "resource",
    name: "api.stripe.com",
    blurb: "New. Nothing about this harness predicted it.",
    badges: [{ label: "new", tone: "hold" }],
    meta: "Today, 10:22",
    decision:
      "Campaign drafts reached this today and nothing about the harness suggested it would — no group implies it and no tool names it. That is not a refusal; it is the one thing worth a second look, which is the whole reason for keeping a record of what is normal.",
    facts: [
      { label: "Reached by", value: "Campaign drafts, tool refund-lookup" },
      { label: "Sessions", value: "3, first one today at 09:58" },
      {
        label: "What to do",
        value:
          "Nothing, if the tool is meant to do this — it becomes expected on its own. Blacklist it if it is not, or ask why a marketing harness is calling a payments API",
      },
    ],
    checks: [{ label: "How we know", value: "The fence logged the connections" }],
  },
  {
    id: "resource.openai",
    kind: "resource",
    name: "api.openai.com",
    blurb: "Nobody has named this. Nothing credentials it.",
    badges: [{ label: "unaccounted for", tone: "warn" }],
    meta: "11 days ago",
    decision:
      "A model endpoint reached directly, outside the model providers configured here. Worth knowing about: it is spend and data leaving on a key nobody registered.",
    checks: [{ label: "Reached by", value: "1 harness, 1 person, 2 sessions in the last 30 days" }],
  },

  /* Org-wide assets ------------------------------------------------------ */
  {
    id: "asset.house-style",
    kind: "asset",
    name: "House writing style",
    blurb: "How anything customer-facing should read.",
    everyone: ["Used by harnesses", "Teams"],
    badges: [
      { label: "any format", tone: "neutral" },
      { label: "always loaded", tone: "accent" },
      { label: "prompt", tone: "neutral" },
    ],
    decision: "Loaded into every harness in the org. Nobody can switch it off.",
    facts: [{ label: "Compiles into", value: "Claude Code, Cursor, Pi — written once" }],
    history: [
      {
        when: "2 Sep 2026",
        who: "Rae Lindqvist",
        plain: "Rewrote the section on apologising to customers.",
        git: "commit c71e004  org/assets/house-style/PROMPT.md\n@@ -18,7 +18,9 @@\n- Apologise once, then fix it.\n+ Apologise once, say what you are doing about it, then do it.",
      },
    ],
  },
  {
    id: "asset.never-drop-db",
    kind: "asset",
    name: "Never drop a database",
    blurb: "The standing rule about destructive database work.",
    everyone: ["Used by harnesses", "Teams"],
    badges: [
      { label: "any format", tone: "neutral" },
      { label: "always loaded", tone: "accent" },
      { label: "memory", tone: "neutral" },
    ],
    decision: "Loaded into every harness in the org. Nobody can switch it off.",
  },
  {
    id: "asset.redact-pii",
    kind: "asset",
    name: "Redact personal data",
    blurb: "Strips personal data before anything leaves the building.",
    everyone: ["Used by harnesses", "Teams"],
    badges: [
      { label: "any format", tone: "neutral" },
      { label: "always loaded", tone: "accent" },
      { label: "tool", tone: "neutral" },
    ],
    decision: "Loaded into every harness in the org. Nobody can switch it off.",
  },
  {
    id: "asset.summariser",
    kind: "asset",
    name: "Long-context summariser",
    blurb: "Folds a long thread into a brief. Written against one API shape.",
    badges: [
      { label: "tool", tone: "neutral" },
      { label: "anthropic", tone: "neutral" },
      { label: "when chosen", tone: "neutral" },
    ],
    decision:
      "Needs the Anthropic format — it uses that API's cache-control headers. A harness that includes this and routes to an OpenAI-only endpoint cannot start, and preflight says which asset caused it rather than failing mid-session.",
  },
  {
    id: "asset.incident-runbook",
    kind: "asset",
    name: "Incident runbook",
    blurb: "What to do when something is on fire.",
    needsAliases: ["slack"],
    badges: [
      { label: "any format", tone: "neutral" },
      { label: "skill", tone: "neutral" },
      { label: "when chosen", tone: "neutral" },
    ],
    decision: "Available to every team. Each harness chooses whether to load it.",
  },

  /* Teams ---------------------------------------------------------------- */
  /* Boundaries — what nobody may do ------------------------------------ */
  {
    id: "boundary.paste",
    kind: "boundary",
    name: "Paste and file-drop sites",
    blurb: "pastebin.com, gist.github.com, transfer.sh, and 11 more",
    badges: [
      { label: "endpoint", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set 4 Jan 2026",
    decision:
      "No harness reaches these, whatever it is running or who is running it. A boundary is the one thing on these screens that takes something away rather than granting it.",
    facts: [
      { label: "Why", value: "Somewhere a credential or a customer record could be posted in one step" },
      { label: "Set by", value: "The organisation. Teams may add to this list and may not remove from it" },
    ],
    checks: [{ label: "Refused this month", value: "2 — Campaign drafts, both on the same day" }],
  },
  {
    id: "boundary.openai",
    kind: "boundary",
    name: "api.openai.com",
    blurb: "Model calls outside the configured providers.",
    badges: [
      { label: "endpoint", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set today",
    decision:
      "Added after it turned up in the endpoint log as unaccounted for. Spend and data were leaving on a key nobody registered; the log found it and this is what closes it.",
    facts: [
      { label: "Found by", value: "Endpoints reached — unaccounted for, 11 days ago" },
      { label: "Alternative", value: "Route through a model provider, where spend and policy are visible" },
    ],
  },
  {
    id: "boundary.tor",
    kind: "boundary",
    name: "Anonymising networks",
    blurb: "*.onion and known exit nodes.",
    badges: [
      { label: "endpoint", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set 4 Jan 2026",
  },
  {
    id: "boundary.competitor",
    kind: "boundary",
    name: "competitor-crm.com",
    blurb: "Marketing only. Added by their own admin.",
    badges: [
      { label: "endpoint", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set 12 Sep 2026",
    decision:
      "A team tightening its own fence. Boundaries inherit downward and only ever narrow, so Marketing may add this for itself and its sub-teams, and cannot lift anything the organisation set.",
    facts: [{ label: "Set by", value: "Rae Lindqvist, Marketing admin" }],
  },
  {
    id: "boundary.outbound-mail",
    kind: "boundary",
    name: "Outbound mail APIs",
    blurb: "Marketing interns only. sendgrid, mailgun, postmark.",
    badges: [
      { label: "endpoint", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set 9 Sep 2026",
    decision:
      "Scoped to one team and one harness. A boundary takes the same scoping as a grant — org-wide, named teams, or named harnesses — so a single restriction does not need a sub-team invented to carry it.",
    facts: [
      { label: "Why", value: "Interns draft campaigns; nobody sends from a draft" },
      { label: "Set by", value: "Rae Lindqvist, Marketing admin" },
    ],
  },
  {
    id: "boundary.writes",
    kind: "boundary",
    name: "Writes outside the work tree",
    blurb: "The filesystem the session can change at all.",
    badges: [
      { label: "filesystem", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set 4 Jan 2026",
    decision:
      "The sandbox gives the session no write permission outside its work tree. This is the real answer to destructive commands: it does not matter whether the agent runs rm, a Python script, or a tool it wrote five minutes ago — there is nothing there to write to.",
    facts: [
      { label: "Writable", value: "~/.harness/assets and the session directory" },
      { label: "Readable", value: "The work tree, plus whatever the person's own tools already read" },
      { label: "How", value: "Seatbelt on macOS, namespaces on Linux — a permission, not a pattern" },
    ],
  },
  {
    id: "boundary.privilege",
    kind: "boundary",
    name: "Privilege escalation",
    blurb: "sudo, setuid binaries, anything that changes who you are.",
    badges: [
      { label: "capability", tone: "neutral" },
      { label: "enforced", tone: "ok" },
    ],
    meta: "Set 4 Jan 2026",
    decision:
      "Not present in the sandbox at all. A boundary you enforce by leaving something out is the strongest kind, because there is no lever to find.",
  },
  {
    id: "boundary.patterns",
    kind: "boundary",
    name: "Destructive commands",
    blurb: "rm -rf /, dd to a device, mkfs, chmod -R on system paths, and 23 more.",
    badges: [
      { label: "command", tone: "neutral" },
      { label: "intercepted", tone: "accent" },
    ],
    meta: "Set 4 Jan 2026",
    decision:
      "Every command is checked before it runs. This catches the thing that actually happens — an agent running a destructive command directly — and it is worth having for exactly that reason. What it cannot catch is the same thing written differently, which is why the filesystem boundary sits behind it.",
    facts: [
      {
        label: "Checked where",
        value:
          "Twice: the provider asks permission before any tool call, and the sandbox puts shims ahead of the real binaries, so a script hits it too",
      },
      {
        label: "Matched how",
        value:
          "On the resolved command, not the raw string — the binary path is resolved and flags normalised, so /bin/rm and rm -r -f read the same as rm -rf",
      },
      {
        label: "Starts from a list we ship",
        value:
          "27 entries that destroy machines, curated and updated by us. An org adds to it; nobody has to invent it",
      },
      { label: "Every block is logged", value: "With the exact command, the harness and the person" },
      {
        label: "What it will not catch",
        value:
          "An equivalent written another way — a Python script, a compiled binary, a novel flag order. That is not a reason to skip it; it is the reason the filesystem boundary exists",
      },
    ],
  },

  /* Changes — the definition side of the log --------------------------- */
  {
    id: "change.triage",
    kind: "change",
    name: "A new version of the triage skill",
    blurb: "Ana Ruiz · Finance",
    badges: [{ label: "awaiting review", tone: "hold" }],
    meta: "Today, 09:31",
    decision:
      "Ana pushed this from her own branch. Until a Finance admin accepts it, her teammates keep the version they have and she keeps hers — nothing is blocked while it waits.",
    facts: [
      { label: "What changed", value: "skill/triage — the section on refund requests" },
      { label: "Waiting on", value: "Any Finance admin" },
      { label: "Open for", value: "4 hours" },
    ],
    history: [
      {
        when: "Today, 09:31",
        who: "Ana Ruiz",
        plain: "Rewrote how triage handles a refund request over £500.",
        git: "commit 7c1e4b9  skill/triage/SKILL.md\n@@ -42,6 +42,9 @@\n- Escalate anything over £500.\n+ Escalate anything over £500 to the duty manager,\n+ and say in the ticket why it was escalated.",
      },
    ],
  },
  {
    id: "change.interns",
    kind: "permchange",
    name: "Marketing interns group created",
    blurb: "Rae Lindqvist · Marketing",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "9 Sep 2026",
    decision:
      "A team admin narrowing their own grant. No platform admin was needed, and the record says what it was narrowed from.",
    facts: [
      { label: "What changed", value: "A new group holding crm and not email" },
      { label: "Narrowed from", value: "Marketing" },
    ],
    history: [
      {
        when: "9 Sep 2026",
        who: "Rae Lindqvist",
        plain: "Created an interns group from Marketing's, leaving out the mailing key.",
        git: "commit b40aa17  org/access/marketing-interns.toml\n+ narrowed_from = \"marketing\"\n+ entries = [\"crm\"]",
      },
    ],
  },
  {
    id: "change.refund-tool",
    kind: "change",
    name: "refund-lookup promoted to Marketing",
    blurb: "Rae Lindqvist · Marketing",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "Today, 09:58",
    decision:
      "One person built a tool, an admin promoted it, and every Marketing harness has it at their next session. This is the path a good idea takes — one commit, one review, live for the branch.",
    facts: [
      { label: "What changed", value: "tool/refund-lookup moved from a personal branch to Marketing" },
      { label: "Side effect", value: "It reached api.stripe.com, which is why that endpoint shows as new" },
    ],
  },
  {
    id: "change.boundary-openai",
    kind: "permchange",
    name: "api.openai.com added as a boundary",
    blurb: "Dana Okafor · Organisation",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "Today, 11:12",
    decision:
      "Closed a gap the endpoint log found. The log showed it as unaccounted for eleven days ago; this is the change that stopped it.",
    facts: [{ label: "Found by", value: "Endpoints reached — unaccounted for" }],
  },
  {
    id: "change.vault-hosted",
    kind: "permchange",
    name: "Harness-hosted vault connected",
    blurb: "Dana Okafor · Organisation",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "6 Mar 2026",
    facts: [{ label: "Why", value: "Marketing had no vault of their own and needed somewhere to paste a key" }],
  },
  {
    id: "change.web-eng",
    kind: "permchange",
    name: "Web access narrowed to Code review",
    blurb: "Sam Whitfield · Engineering",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "14 Sep 2026",
    decision:
      "A team admin narrowing a grant their team already held. No platform admin was involved, and the record says what it was narrowed from.",
  },
  {
    id: "change.bedrock-default",
    kind: "provchange",
    name: "Bedrock made Engineering's default",
    blurb: "Dana Okafor · Organisation",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "2 Aug 2026",
  },
  {
    id: "change.pat",
    kind: "peoplechange",
    name: "Pat Silva invited to Support",
    blurb: "Dana Okafor · Support",
    badges: [{ label: "awaiting review", tone: "hold" }],
    meta: "19 Sep 2026",
    decision:
      "Invited, not yet accepted. Nothing is granted until they are, so there is nothing to revoke if it lapses.",
    facts: [{ label: "Expires", value: "26 September 2026" }],
  },
  {
    id: "change.max",
    kind: "peoplechange",
    name: "Max Fenn deactivated",
    blurb: "Dana Okafor · Support",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "6 Aug 2026",
    decision:
      "Removed from every team, which took every security group with it in one step. One follow-up: the shared Slack token Support holds was flagged for rotation.",
    facts: [
      { label: "Credentials still live", value: "None — session-scoped ones died with their sessions" },
      { label: "Flagged", value: "Rotate the Support Slack token" },
    ],
  },
  {
    id: "change.rae-admin",
    kind: "peoplechange",
    name: "Rae Lindqvist made Marketing admin",
    blurb: "Dana Okafor · Marketing",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "9 Mar 2026",
  },
  {
    id: "change.cursor",
    kind: "provchange",
    name: "Cursor approved for Support",
    blurb: "Dana Okafor · Organisation",
    badges: [{ label: "accepted", tone: "ok" }],
    meta: "2 Sep 2026",
    facts: [{ label: "What changed", value: "Approval status, scoped to one team" }],
  },
  {
    id: "change.aider",
    kind: "provchange",
    name: "Aider declined",
    blurb: "Dana Okafor · Organisation",
    badges: [{ label: "declined", tone: "warn" }],
    meta: "3 Mar 2026",
    decision:
      "A no, recorded with its reason. The next person to ask can see it was already decided rather than re-opening it.",
    facts: [{ label: "Why", value: "No way to pin a build, so we cannot tell what people would be running" }],
  },
  {
    id: "change.rollback",
    kind: "change",
    name: "House writing style rolled back",
    blurb: "Dana Okafor · Organisation",
    badges: [{ label: "rolled back", tone: "hold" }],
    meta: "4 Sep 2026",
    decision:
      "Two days after it went out, the new apology wording was reverted. Every harness picked up the old version at its next session — no redeploy, no announcement.",
    facts: [{ label: "Back to", value: "The version from 18 August" }],
  },

  /* People — the layer the tree organises ------------------------------- */
  {
    id: "person.dana",
    kind: "person",
    name: "Dana Okafor",
    blurb: "dana@acme.co",
    badges: [
      { label: "org admin", tone: "accent" },
      { label: "active", tone: "ok" },
    ],
    meta: "Today, 08:40",
    decision:
      "The only role that can approve a build, connect a vault, or create a group. Everything on the credential screens traces back to someone holding this.",
    facts: [{ label: "Joined", value: "4 January 2026" }],
  },
  {
    id: "person.ana",
    kind: "person",
    name: "Ana Ruiz",
    blurb: "ana@acme.co",
    badges: [
      { label: "member", tone: "neutral" },
      { label: "active", tone: "ok" },
    ],
    meta: "Today, 09:14",
    decision:
      "Gets whatever Finance is granted, and nothing else. Adding her to a team is the grant; there is no per-person list to maintain.",
    facts: [{ label: "Joined", value: "2 February 2026" }],
  },
  {
    id: "person.sam",
    kind: "person",
    name: "Sam Whitfield",
    blurb: "sam@acme.co",
    badges: [
      { label: "team admin", tone: "accent" },
      { label: "active", tone: "ok" },
    ],
    meta: "Yesterday, 17:02",
    decision:
      "Admin of Engineering, so he may narrow its groups down to sub-teams and launch builds still in beta. He cannot widen anything, create a group, or change a protection setting.",
    facts: [{ label: "Joined", value: "11 January 2026" }],
  },
  {
    id: "person.kit",
    kind: "person",
    name: "Kit Nakamura",
    blurb: "kit@acme.co",
    badges: [
      { label: "member", tone: "neutral" },
      { label: "active", tone: "ok" },
    ],
    meta: "3 days ago",
  },
  {
    id: "person.rae",
    kind: "person",
    name: "Rae Lindqvist",
    blurb: "rae@acme.co",
    badges: [
      { label: "team admin", tone: "accent" },
      { label: "active", tone: "ok" },
    ],
    meta: "Today, 10:22",
    facts: [{ label: "Joined", value: "9 March 2026" }],
  },
  {
    id: "person.jo",
    kind: "person",
    name: "Jo Adeyemi",
    blurb: "jo@acme.co",
    badges: [
      { label: "member", tone: "neutral" },
      { label: "active", tone: "ok" },
    ],
    meta: "Today, 11:05",
    decision:
      "On Marketing interns, so she gets that team's narrower group — the CRM key and not the mailing key. Same harnesses, less reach, no exception written against her name.",
  },
  {
    id: "person.pat",
    kind: "person",
    name: "Pat Silva",
    blurb: "pat@acme.co",
    badges: [
      { label: "member", tone: "neutral" },
      { label: "invited", tone: "hold" },
    ],
    meta: "—",
    decision:
      "Invited to Support four days ago and has not accepted. Nothing has been granted yet and no credential exists — the invitation is a promise, not access.",
    facts: [
      { label: "Invited by", value: "Dana Okafor, 19 September 2026" },
      { label: "Expires", value: "26 September 2026" },
    ],
  },
  {
    id: "person.max",
    kind: "person",
    name: "Max Fenn",
    blurb: "max@acme.co",
    badges: [
      { label: "member", tone: "neutral" },
      { label: "deactivated", tone: "warn" },
    ],
    meta: "48 days ago",
    decision:
      "Left in August. Removed from every team, so every group went with it in one step. The sessions and endpoint records stay for the retention window; the access did not outlive the membership.",
    checks: [
      { label: "Credentials still live", value: "None — session-scoped ones died with their sessions" },
      { label: "Stored keys to rotate", value: "1 — the Slack bot token Support shares. Flagged on offboarding" },
    ],
  },

  {
    id: "team.finance",
    kind: "team",
    name: "Finance",
    blurb: "9 people.",
    decision: "Everyone in Finance can use whatever Finance has been given.",
    facts: [{ label: "People", value: "9" }],
  },
  {
    id: "team.engineering",
    kind: "team",
    name: "Engineering",
    blurb: "24 people, one sub-team.",
    decision: "Everyone in Engineering can use whatever Engineering has been given.",
    facts: [
      { label: "People", value: "24" },
      { label: "Sub-teams", value: "Senior Engineering" },
    ],
  },
  {
    id: "team.eng-senior",
    kind: "team",
    name: "Senior Engineering",
    blurb: "Inside Engineering. 5 people.",
    decision:
      "A sub-team exists so that production access can sit here rather than with all of Engineering. This is how something is kept away from someone.",
    facts: [{ label: "People", value: "5" }],
    history: [
      {
        when: "18 Aug 2026",
        who: "Dana Okafor",
        plain:
          "Created Senior Engineering and moved production database access to it, so interns and contractors on Engineering no longer inherit it.",
        git: "commit 2d90f13  org/teams/engineering/senior/\n+ members = [\"sam\", \"kit\", \"noor\", \"ade\", \"jun\"]\n  org/access/eng-prod-db.toml\n- team = \"engineering\"\n+ team = \"engineering/senior\"",
      },
    ],
  },
  {
    id: "team.marketing-interns",
    kind: "team",
    name: "Marketing interns",
    blurb: "Inside Marketing. 3 people.",
    decision:
      "A sub-team so that the mailing key can sit with Marketing and not with everyone in it.",
    facts: [{ label: "People", value: "3" }],
  },
  {
    id: "team.support",
    kind: "team",
    name: "Support",
    blurb: "16 people.",
    decision: "Everyone in Support can use whatever Support has been given.",
    facts: [{ label: "People", value: "16" }],
  },
  {
    id: "team.marketing",
    kind: "team",
    name: "Marketing",
    blurb: "7 people.",
    decision: "Everyone in Marketing can use whatever Marketing has been given.",
    facts: [{ label: "People", value: "7" }],
  },

  /* Harnesses ------------------------------------------------------------ */
  {
    id: "harness.monday-reporting",
    kind: "harness",
    name: "Monday reporting",
    blurb: "Finance. The Monday numbers.",
    reach: [
      {
        endpoint: "acme-prod.snowflakecomputing.com",
        from: "security group",
        via: "Finance",
        status: "always reachable",
      },
      {
        endpoint: "models.internal.acme.co",
        from: "model provider",
        via: "Self-hosted gateway",
        status: "always reachable",
      },
      { endpoint: "everything else", from: "web grant", via: "Not granted", status: "refused" },
    ],
    decision: "Owned by Finance. Shown here because the org's rules decide what it can reach.",
    facts: [{ label: "Needs", value: "warehouse", mono: true }],
  },
  {
    id: "harness.migrations",
    kind: "harness",
    name: "Schema migrations",
    blurb: "Senior Engineering. Schema changes.",
    decision: "Owned by Senior Engineering.",
    facts: [{ label: "Needs", value: "prod-db", mono: true }],
  },
  {
    id: "harness.code-review",
    kind: "harness",
    name: "Code review",
    blurb: "Engineering. Reviews open pull requests. Admin-only on the fork.",
    decision: "Owned by Engineering.",
    facts: [
      { label: "Needs", value: "sandbox", mono: true },
      {
        label: "Why limited",
        value: "Its provider is still under review, so it cannot reach anything classed production",
      },
    ],
  },
  {
    id: "harness.triage",
    kind: "harness",
    name: "Ticket triage",
    blurb: "Support. Sorts the queue.",
    decision: "Owned by Support.",
    facts: [{ label: "Needs", value: "slack", mono: true }],
  },
  {
    id: "harness.outreach",
    kind: "harness",
    name: "Sales outreach",
    blurb: "Finance. Cannot launch anywhere as configured.",
    decision:
      "A harness is not tied to a provider — it runs on whichever of them its team may use. This one has none left: it routes through OpenRouter, which is approved only for Cursor, and Finance may not run Cursor.",
    facts: [
      { label: "Routes models through", value: "OpenRouter — approved for Cursor only" },
      { label: "Finance may run", value: "Claude Code, Pi" },
      { label: "Fix", value: "Route through the self-hosted gateway, or permit Cursor for Finance" },
    ],
  },
  {
    id: "harness.campaigns",
    kind: "harness",
    name: "Campaign drafts",
    blurb: "Marketing. Drafts campaigns.",
    reach: [
      {
        endpoint: "www.googleapis.com/drive",
        from: "security group",
        via: "Marketing",
        status: "always reachable",
      },
      {
        endpoint: "models.internal.acme.co",
        from: "model provider",
        via: "Self-hosted gateway",
        status: "always reachable",
      },
      { endpoint: "api.hubapi.com", from: "web grant", via: "Web access", status: "reachable" },
      {
        endpoint: "api.stripe.com",
        from: "web grant",
        via: "Web access — first seen today",
        status: "new",
      },
      {
        endpoint: "pastebin.com",
        from: "boundary",
        via: "Paste and file-drop sites",
        status: "refused",
      },
      {
        endpoint: "api.openai.com",
        from: "boundary",
        via: "Model calls outside the providers",
        status: "refused",
      },
    ],
    decision: "Owned by Marketing.",
    facts: [
      { label: "Needs", value: "drive", mono: true },
      {
        label: "Why not confirmed",
        value: "Drive uses each person's own Google sign-in, which we cannot check before launch",
      },
    ],
  },
];

export const EDGES: Edge[] = [
  /* The guide is walkable like anything else, so a badge can link to the
     screen that defines it rather than to a glossary that drifts. */
  { from: "guide.overview", to: "guide.trust", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.strength", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.requirement", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.resolved", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.record", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.web", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.holds", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.role", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.review", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.certainty", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.reach", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.web", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.holds", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.record", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.requirement", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.role", label: "The vocabulary", inverse: "Explained in" },
  { from: "guide.overview", to: "guide.review", label: "The vocabulary", inverse: "Explained in" },

  /* provider → model */
  { from: "harness.monday-reporting", to: "model.gateway", label: "Routes models through", inverse: "Used by" },
  { from: "harness.migrations", to: "model.bedrock", label: "Routes models through", inverse: "Used by" },
  { from: "harness.code-review", to: "model.gateway", label: "Routes models through", inverse: "Used by" },
  { from: "harness.triage", to: "model.openrouter", label: "Routes models through", inverse: "Used by" },
  { from: "harness.campaigns", to: "model.gateway", label: "Routes models through", inverse: "Used by" },
  { from: "harness.outreach", to: "model.openrouter", label: "Routes models through", inverse: "Used by" },
  { from: "harness.outreach", to: "team.finance", label: "Belongs to", inverse: "Harnesses" },

  /* harness → provider */

  /* harness → team */
  { from: "harness.monday-reporting", to: "team.finance", label: "Belongs to", inverse: "Harnesses" },
  { from: "harness.migrations", to: "team.eng-senior", label: "Belongs to", inverse: "Harnesses" },
  { from: "harness.code-review", to: "team.engineering", label: "Belongs to", inverse: "Harnesses" },
  { from: "harness.triage", to: "team.support", label: "Belongs to", inverse: "Harnesses" },
  { from: "harness.campaigns", to: "team.marketing", label: "Belongs to", inverse: "Harnesses" },

  /* harness → security group */

  /* security group → key provider */
  /* 1Password will not let us list, so there is no secret to walk to — only
     the vault an admin named. The gap is the point. */

  { from: "access.finance", to: "secret.warehouse-ro", label: "Mints", inverse: "Minted by" },
  { from: "access.finance", to: "secret.alldb", label: "Mints", inverse: "Minted by" },
  { from: "access.engineering", to: "secret.alldb", label: "Mints", inverse: "Minted by" },
  { from: "access.support", to: "secret.alldb", label: "Mints", inverse: "Minted by" },
  { from: "access.eng-migrations", to: "secret.migrator", label: "Mints", inverse: "Minted by" },
  { from: "access.marketing", to: "secret.hosted-crm", label: "Mints", inverse: "Minted by" },
  { from: "access.marketing", to: "secret.sendgrid", label: "Mints", inverse: "Minted by" },
  { from: "access.marketing-interns", to: "secret.hosted-crm", label: "Mints", inverse: "Minted by" },
  /* 1Password will not let us list, so there is no secret to walk to. */
  { from: "access.support", to: "keystore.onepassword", label: "Also holds a key in", inverse: "Holds" },

  { from: "access.finance", to: "team.finance", label: "Granted to", inverse: "Can be given" },
  { from: "access.engineering", to: "team.engineering", label: "Granted to", inverse: "Can be given" },
  { from: "access.eng-migrations", to: "team.eng-senior", label: "Granted to", inverse: "Can be given" },
  { from: "access.support", to: "team.support", label: "Granted to", inverse: "Can be given" },
  { from: "access.marketing", to: "team.marketing", label: "Granted to", inverse: "Can be given" },
  { from: "access.marketing-interns", to: "team.marketing-interns", label: "Granted to", inverse: "Can be given" },
  { from: "access.marketing-drive", to: "team.marketing", label: "Granted to", inverse: "Can be given" },
  { from: "access.web", to: "team.marketing", label: "Granted to", inverse: "Can be given" },
  { from: "access.web", to: "team.support", label: "Granted to", inverse: "Can be given" },
  /* The optional third dimension: a grant may name harnesses, and then it
     covers only those. Absent, it covers every harness of its teams. Scoping
     is a property of the grant, so a differently-scoped grant is a separate
     one — Engineering's is below. */
  { from: "access.web-eng", to: "team.engineering", label: "Granted to", inverse: "Can be given" },
  { from: "access.web-eng", to: "harness.code-review", label: "Only for", inverse: "Narrowed grants" },

  /* A model provider is usable only by the builds that can speak to it, and
     that the org has approved for it. Every harness needs one of each. */
  /* Routing uses the same scoping pattern as everything else: exactly one org
     default, a team may have its own, a harness may be pinned regardless of
     its team. Most specific wins. */
  { from: "model.bedrock", to: "team.engineering", label: "Default for", inverse: "Routes here by default" },
  { from: "model.openrouter", to: "team.support", label: "Default for", inverse: "Routes here by default" },
  { from: "model.openrouter", to: "team.marketing", label: "Approved for", inverse: "May route here" },
  { from: "model.gateway", to: "harness.code-review", label: "Default for", inverse: "Routes here by default" },
  { from: "model.gateway", to: "harness.triage", label: "Approved for", inverse: "May route here" },
  { from: "model.bedrock", to: "provider.pi", label: "Default for", inverse: "Routes here by default" },





  { from: "harness.monday-reporting", to: "access.finance", label: "Gets credentials from", inverse: "Used by" },
  { from: "harness.migrations", to: "access.eng-migrations", label: "Gets credentials from", inverse: "Used by" },
  { from: "harness.triage", to: "access.support", label: "Gets credentials from", inverse: "Used by" },
  { from: "harness.campaigns", to: "access.marketing", label: "Gets credentials from", inverse: "Used by" },

  { from: "team.marketing-interns", to: "team.marketing", label: "Inside", inverse: "Contains" },

  { from: "secret.alldb", to: "keystore.vault", label: "Lives in", inverse: "Holds" },
  { from: "secret.migrator", to: "keystore.vault", label: "Lives in", inverse: "Holds" },
  { from: "secret.warehouse-ro", to: "keystore.aws", label: "Lives in", inverse: "Holds" },
  { from: "secret.stripe", to: "keystore.aws", label: "Lives in", inverse: "Holds" },
  { from: "secret.sendgrid", to: "keystore.aws", label: "Lives in", inverse: "Holds" },
  { from: "secret.hosted-crm", to: "keystore.hosted", label: "Lives in", inverse: "Holds" },
  { from: "secret.drive-oauth", to: "keystore.local", label: "Lives in", inverse: "Holds" },
  { from: "secret.gh-cli", to: "keystore.local", label: "Lives in", inverse: "Holds" },
  { from: "access.marketing-drive", to: "secret.drive-oauth", label: "Mints", inverse: "Minted by" },


  /* security group → resource */

  /* security group → team */

  { from: "harness.campaigns", to: "resource.hubspot", label: "Reached", inverse: "Reached by" },
  { from: "harness.campaigns", to: "resource.drive", label: "Reached", inverse: "Reached by" },
  { from: "harness.monday-reporting", to: "resource.warehouse", label: "Reached", inverse: "Reached by" },
  { from: "harness.migrations", to: "resource.prod-postgres", label: "Reached", inverse: "Reached by" },
  { from: "harness.triage", to: "resource.slack", label: "Reached", inverse: "Reached by" },
  { from: "harness.code-review", to: "resource.openai", label: "Reached", inverse: "Reached by" },
  { from: "harness.campaigns", to: "resource.stripe", label: "Tried to reach", inverse: "Asked for by" },

  /* provider permitted for team */
  { from: "provider.cursor", to: "team.support", label: "Permitted for", inverse: "May run" },
  { from: "provider.acme-fork", to: "team.engineering", label: "Permitted for", inverse: "May run" },

  /* sub-team */
  { from: "team.eng-senior", to: "team.engineering", label: "Inside", inverse: "Contains" },
  { from: "boundary.competitor", to: "team.marketing", label: "Applies to", inverse: "Boundaries" },
  { from: "boundary.outbound-mail", to: "team.marketing-interns", label: "Applies to", inverse: "Boundaries" },
  { from: "boundary.outbound-mail", to: "harness.campaigns", label: "Only for", inverse: "Boundaries" },
  { from: "boundary.openai", to: "resource.openai", label: "Found by", inverse: "Closed by" },

  { from: "change.triage", to: "person.ana", label: "By", inverse: "Changes" },
  { from: "change.triage", to: "team.finance", label: "Where", inverse: "Changes" },
  { from: "change.interns", to: "person.rae", label: "By", inverse: "Changes" },
  { from: "change.interns", to: "team.marketing", label: "Where", inverse: "Changes" },
  { from: "change.refund-tool", to: "person.rae", label: "By", inverse: "Changes" },
  { from: "change.refund-tool", to: "team.marketing", label: "Where", inverse: "Changes" },
  { from: "change.boundary-openai", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.vault-hosted", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.web-eng", to: "person.sam", label: "By", inverse: "Changes" },
  { from: "change.web-eng", to: "team.engineering", label: "Where", inverse: "Changes" },
  { from: "change.bedrock-default", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.pat", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.pat", to: "team.support", label: "Where", inverse: "Changes" },
  { from: "change.max", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.max", to: "team.support", label: "Where", inverse: "Changes" },
  { from: "change.rae-admin", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.rae-admin", to: "team.marketing", label: "Where", inverse: "Changes" },
  { from: "change.cursor", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.aider", to: "person.dana", label: "By", inverse: "Changes" },
  { from: "change.rollback", to: "person.dana", label: "By", inverse: "Changes" },

  { from: "person.dana", to: "team.finance", label: "Member of", inverse: "People" },
  { from: "person.ana", to: "team.finance", label: "Member of", inverse: "People" },
  { from: "person.sam", to: "team.eng-senior", label: "Member of", inverse: "People" },
  { from: "person.sam", to: "team.engineering", label: "Admin of", inverse: "Admins" },
  { from: "person.kit", to: "team.eng-senior", label: "Member of", inverse: "People" },
  { from: "person.rae", to: "team.marketing", label: "Admin of", inverse: "Admins" },
  { from: "person.jo", to: "team.marketing-interns", label: "Member of", inverse: "People" },
  { from: "person.pat", to: "team.support", label: "Invited to", inverse: "Invited" },

  /* org assets reach everything */
  { from: "asset.house-style", to: "team.finance", label: "Loaded for", inverse: "Always loads" },
  { from: "asset.house-style", to: "team.engineering", label: "Loaded for", inverse: "Always loads" },
  { from: "asset.house-style", to: "team.support", label: "Loaded for", inverse: "Always loads" },
  { from: "asset.house-style", to: "team.marketing", label: "Loaded for", inverse: "Always loads" },
  { from: "asset.never-drop-db", to: "team.engineering", label: "Loaded for", inverse: "Always loads" },
  { from: "asset.redact-pii", to: "team.support", label: "Loaded for", inverse: "Always loads" },

  /* Which harnesses include which assets, and what an asset needs to work. */
  { from: "harness.code-review", to: "asset.incident-runbook", label: "Includes", inverse: "Used by" },
  { from: "harness.migrations", to: "asset.incident-runbook", label: "Includes", inverse: "Used by" },
  { from: "harness.triage", to: "asset.summariser", label: "Includes", inverse: "Used by" },
  { from: "asset.incident-runbook", to: "access.support", label: "Requires", inverse: "Required by" },
  { from: "asset.incident-runbook", to: "team.engineering", label: "Offered to", inverse: "May load" },
];

const BY_ID = new Map(ENTITIES.map((entity) => [entity.id, entity]));

export function entity(id: string) {
  return BY_ID.get(id);
}

export function ofKind(kind: Kind) {
  return ENTITIES.filter((candidate) => candidate.kind === kind);
}

/** Both directions, from one edge list. */
export function relations(id: string) {
  const groups = new Map<string, Entity[]>();
  const push = (label: string, other?: Entity) => {
    if (!other) return;
    const bucket = groups.get(label) ?? [];
    if (!bucket.some((existing) => existing.id === other.id)) bucket.push(other);
    groups.set(label, bucket);
  };
  for (const edge of EDGES) {
    if (edge.from === id) push(edge.label, BY_ID.get(edge.to));
    if (edge.to === id) push(edge.inverse, BY_ID.get(edge.from));
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

/* Two steps out, and direction matters. Every edge is authored consumer →
   dependency (a harness depends on its provider; an security group depends on
   the vault holding it), so following it forwards answers "what does this
   rest on?" and backwards answers "what rests on this?".

   Walking it undirected merges the two and produces nonsense — revoking a
   fork does not break the org's writing-style asset, but both are reachable
   from it through the Engineering team. */
function step(from: string, forward: boolean) {
  return EDGES.flatMap((edge) =>
    forward ? (edge.from === from ? [edge.to] : []) : edge.to === from ? [edge.from] : [],
  );
}

function twoOut(id: string, forward: boolean) {
  const near = new Set(step(id, forward));
  const far = new Map<Kind, Entity[]>();
  for (const one of near) {
    for (const two of step(one, forward)) {
      if (two === id || near.has(two)) continue;
      const found = BY_ID.get(two);
      if (!found) continue;
      const bucket = far.get(found.kind) ?? [];
      if (!bucket.some((existing) => existing.id === found.id)) bucket.push(found);
      far.set(found.kind, bucket);
    }
  }
  return [...far.entries()].map(([kind, items]) => ({ kind, items }));
}

/** What this rests on, two steps away. */
export function dependsOn(id: string) {
  return twoOut(id, true);
}

/** What rests on this, two steps away — the blast radius of a change. */
export function wouldBreak(id: string) {
  return twoOut(id, false);
}

/** Who this ends up serving: the teams behind whatever consumes it, plus any
    team it is granted to directly. Answers "who is getting this?" on a screen
    that is otherwise one hop away from every person it affects. */
export function teamsServed(id: string) {
  const found = new Map<string, Entity>();
  const add = (candidate: string) => {
    const entity = BY_ID.get(candidate);
    if (entity?.kind === "team") found.set(entity.id, entity);
  };
  for (const direct of step(id, true)) add(direct);
  for (const consumer of step(id, false)) for (const team of step(consumer, true)) add(team);
  return [...found.values()];
}

/** One hop, in a named direction, filtered to a kind. The building block for
    relationship columns: "which vault does this live in", "which security groups
    reach this". */
export function neighbours(id: string, kind: Kind, forward: boolean) {
  const found = new Map<string, Entity>();
  for (const candidate of step(id, forward)) {
    const entity = BY_ID.get(candidate);
    if (entity?.kind === kind) found.set(entity.id, entity);
  }
  return [...found.values()];
}


/** Which runtimes a harness could actually launch with: the ones its team may
    run, kept to those that share a wire format with its model provider. Both
    halves are derived — a harness is never tied to a runtime, and nobody
    maintains a compatibility matrix. */
export function canRunOn(harnessId: string) {
  const model = neighbours(harnessId, "model", true)[0];
  const team = neighbours(harnessId, "team", true)[0];
  if (!model || !team) return [];
  return runtimesFor(model.id).filter((provider) => {
    const scoped = neighbours(provider.id, "team", true);
    if (!scoped.length) return true;
    return scoped.some(
      (scope) => scope.id === team.id || step(team.id, true).includes(scope.id),
    );
  });
}

/** Does a grant cover this harness? A grant with no named harnesses covers
    every harness of the teams it is granted to; one that names harnesses
    covers only those. The optional third dimension of a grant. */
export function grantCovers(accessId: string, harnessId: string) {
  const named = neighbours(accessId, "harness", true);
  if (named.length) return named.some((one) => one.id === harnessId);
  const team = neighbours(harnessId, "team", true)[0];
  if (!team) return false;
  return neighbours(accessId, "team", true).some(
    (granted) => granted.id === team.id || step(team.id, true).includes(granted.id),
  );
}

/** Web access is a grant, so whether a harness has it is derived. */
export function hasWeb(harnessId: string) {
  return ["access.web", "access.web-eng"].some((grant) => grantCovers(grant, harnessId));
}


/** Same as `neighbours`, but only across edges with a given label. Two
    relationships can share a kind and a direction and mean different things —
    default-for and available-to both point a model provider at a team. */
export function neighboursVia(id: string, kind: Kind, forward: boolean, label: string) {
  const found = new Map<string, Entity>();
  for (const edge of EDGES) {
    const match = forward
      ? edge.from === id && edge.label === label
      : edge.to === id && edge.label === label;
    if (!match) continue;
    const other = BY_ID.get(forward ? edge.to : edge.from);
    if (other?.kind === kind) found.set(other.id, other);
  }
  return [...found.values()];
}


/** Boundaries that name this harness or one of its teams. Deliberately not
    the org-wide ones: those cover everything, so repeating them on every row
    buries the one line that is actually about this harness. The full union
    appears on the harness's own reach table. */
export function boundariesFor(harnessId: string) {
  const team = neighbours(harnessId, "team", true)[0];
  const chain = team ? [team.id, ...step(team.id, true)] : [];
  return ofKind("boundary").filter((boundary) => {
    const named = neighbours(boundary.id, "harness", true);
    if (named.some((one) => one.id === harnessId)) return true;
    if (named.length) return false;
    const teams = neighbours(boundary.id, "team", true);
    return teams.length > 0 && teams.some((one) => chain.includes(one.id));
  });
}


/** Which wire formats an entity speaks or exposes. A tag, because it is the
    same fact whether it is on a runtime, an endpoint or an asset. */
const FORMATS = ["anthropic", "openai"];
export function formatsOf(id: string) {
  return (BY_ID.get(id)?.badges ?? [])
    .map((badge) => badge.label)
    .filter((label) => FORMATS.includes(label));
}

/** A runtime can reach a model provider when they share a wire format. This
    is derived, never approved by hand: a hand-kept matrix says the same thing
    less accurately and goes stale the first time a provider adds a format. */
export function runtimesFor(modelId: string) {
  const formats = formatsOf(modelId);
  return ofKind("provider").filter((provider) =>
    formatsOf(provider.id).some((format) => formats.includes(format)),
  );
}

/** And the same rule the other way, for a runtime. */
export function modelsFor(providerId: string) {
  const formats = formatsOf(providerId);
  return ofKind("model").filter((model) =>
    formatsOf(model.id).some((format) => formats.includes(format)),
  );
}


/** Security groups that could satisfy an asset's aliases. Derived: the asset
    says it needs `slack`, and any group with an entry aliased `slack` answers
    it. Which group actually does depends on the team, so this is the set of
    candidates, not a binding. */
export function compatibleGroups(assetId: string) {
  const needs = BY_ID.get(assetId)?.needsAliases ?? [];
  if (!needs.length) return [];
  return ofKind("access").filter((group) =>
    (group.contents ?? []).some((entry) => needs.includes(entry.alias)),
  );
}

/** Assets in a harness whose required wire format its model provider does not
    expose. The conflict nobody thinks about until a session dies halfway. */
export function formatConflicts(harnessId: string) {
  const model = neighbours(harnessId, "model", true)[0];
  if (!model) return [];
  const exposed = formatsOf(model.id);
  return neighbours(harnessId, "asset", true).filter((asset) => {
    const needed = formatsOf(asset.id);
    return needed.length > 0 && !needed.some((one) => exposed.includes(one));
  });
}

/** Everything that stops a harness starting, each pointing at the thing to go
    and look at. A status that does not say where to go is a status somebody
    has to come and ask you about. */
export function launchBlockers(harnessId: string) {
  const blockers: { text: string; fix: string; goTo: Entity | undefined }[] = [];
  const model = neighbours(harnessId, "model", true)[0];
  const team = neighbours(harnessId, "team", true)[0];

  if (canRunOn(harnessId).length === 0) {
    blockers.push({
      text: `No runtime ${team?.name ?? "this team"} may use speaks ${model?.name ?? "this provider"}'s wire format (${formatsOf(model?.id ?? "").join(", ") || "unknown"}).`,
      fix: `Route this harness through a provider exposing a format its runtimes speak, or approve one for ${team?.name ?? "the team"} that does.`,
      goTo: model,
    });
  }
  for (const asset of formatConflicts(harnessId)) {
    blockers.push({
      text: `${asset.name} needs the ${formatsOf(asset.id).join(" or ")} format, and ${model?.name ?? "this provider"} exposes ${formatsOf(model?.id ?? "").join(", ") || "none"}.`,
      fix: `Either drop ${asset.name} from this harness, or route it through a provider exposing ${formatsOf(asset.id).join(" or ")}.`,
      goTo: asset,
    });
  }
  return blockers;
}
