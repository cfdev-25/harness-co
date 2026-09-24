"use client";

/* Prototype: the org-level admin configuration surface.
   Fixtures only, no API. See ./data.ts for why relationships are one edge
   list rather than fields on each object. */

import { useEffect, useMemo, useState } from "react";
import type { Tone } from "../ui";
import {
  Badge,
  BrandMark,
  Button,
  Chip,
  CommandBlock,
  CONTROL_CLASS,
  Disclosure,
  Dot,
  EmptyState,
  Eyebrow,
  Field,
  HeaderSearch,
  Modal,
  Mono,
  Notice,
  Table,
  Td,
  Toolbar,
  Tr,
} from "../ui";
import {
  Entity,
  GROUPS,
  Kind,
  KIND_LABEL,
  dependsOn,
  boundariesFor,
  canRunOn,
  compatibleGroups,
  launchBlockers,
  modelsFor,
  runtimesFor,
  hasWeb,
  neighbours,
  neighboursVia,
  ofKind,
  teamsServed,
  entity as lookup,
  relations,
  wouldBreak,
} from "./data";

/* NOTE for the port: this and `KIND_LABEL` in ./data.ts are two hand-kept
   maps of the same thing. Collapse them into one when these screens move to
   the real route — parallel maps drift. */

/* Each list screen states the one decision it owns, in a sentence. */
/* Every tag in the console is a value on one of five scales, and each scale
   has a screen. A tag links to the screen that defines it, so the
   explanation lives at the destination rather than in a legend that drifts
   out of date. One map, so the same word never means two things. */
const BADGE_GUIDE: Record<string, string> = {
  approved: "guide.trust",
  beta: "guide.trust",
  "not approved": "guide.trust",
  "vault-supplied": "guide.strength",
    "locally-owned": "guide.strength",
  verified: "guide.certainty",
  ready: "guide.certainty",
  "checked at start-up": "guide.certainty",
  limited: "guide.trust",
  "org-wide": "guide.reach",
  "1 team": "guide.reach",
  required: "guide.reach",
  optional: "guide.reach",
  enforced: "guide.holds",
  intercepted: "guide.holds",
  "issues temporary": "guide.strength",
  "stores values": "guide.strength",
  allowed: "guide.web",
  prohibited: "guide.web",
  declared: "guide.certainty",
  credentialed: "guide.record",
  "not credentialed": "guide.record",
  "unaccounted for": "guide.record",
  new: "guide.record",
  covered: "guide.record",
  unreached: "guide.record",
  "vault only": "guide.requirement",
  "vault or local": "guide.requirement",
  "org admin": "guide.role",
  "team admin": "guide.role",
  member: "guide.role",
  "awaiting review": "guide.review",
  accepted: "guide.review",
  declined: "guide.review",
  "rolled back": "guide.review",
  listed: "guide.certainty",
  "not listed": "guide.certainty",
  default: "guide.reach",
  override: "guide.reach",
};

/* A tag is a value on a scale, and the scale is the column it belongs in.
   "Status" as a heading hides that; naming the scale shows it, and makes a
   row scannable across the same question every time. */
type Scale =
  | "trust"
  | "reach"
  | "strength"
  | "certainty"
  | "requirement"
  | "kind"
  | "type"
  | "format"
  | "ownership"
  | "inventory"
  | "capability"
  | "validity"
  | "review"
  | "web"
  | "holds"
  | "role"
  | "status"
  | "record";

const SCALE_OF: Record<string, Scale> = {
  approved: "trust",
  beta: "trust",
  "not approved": "trust",
  "org-wide": "reach",
  "1 team": "reach",
  "always loaded": "reach",
  "when chosen": "reach",
  "vault-supplied": "strength",
    "locally-owned": "strength",
  verified: "certainty",
  declared: "certainty",
  "vault only": "requirement",
  "vault or local": "requirement",
  allowed: "web",
  prohibited: "web",
  anthropic: "format",
  openai: "format",
  "any format": "format",
  endpoint: "type",
  command: "type",
  filesystem: "type",
  capability: "type",
  enforced: "holds",
  intercepted: "holds",
  prompt: "kind",
  memory: "kind",
  tool: "kind",
  skill: "kind",
  "customer-owned": "ownership",
  "we host it": "ownership",
  listed: "inventory",
  "not listed": "inventory",
  "issues temporary": "capability",
  "stores values": "capability",
  covered: "record",
  "org admin": "role",
  "team admin": "role",
  member: "role",
  "awaiting review": "review",
  accepted: "review",
  declined: "review",
  "rolled back": "review",
  active: "status",
  invited: "status",
  deactivated: "status",
  passing: "validity",
  failing: "validity",
  credentialed: "record",
  new: "record",
  "not credentialed": "record",
  "unaccounted for": "record",
};

const SCALE_LABEL: Record<Scale, string> = {
  trust: "Approval",
  reach: "Reach",
  strength: "Comes from",
  certainty: "Certainty",
  requirement: "Sources allowed",
  kind: "Kind",
  type: "Type",
  format: "Wire format",
  ownership: "Vault",
  inventory: "Contents",
  capability: "Issues",
  validity: "Can launch",
  review: "State",
  web: "Outside endpoints",
  holds: "Enforcement",
  role: "Role",
  status: "Status",
  record: "Record",
};

/* Relationships are not scales, so they get their own columns and read as
   linked values rather than tags. A list that shows only tags describes each
   row in isolation; these columns are what put the data structure on screen —
   a secret rolls up to a vault, is reached by security groups, and through them
   by teams. */
type Rel = {
  heading: string;
  kind: Kind;
  dir: "out" | "in" | "teams" | "runnable" | "boundaries" | "runtimes" | "models" | "groups";
  /** Restrict to edges carrying this label, when two relations share a kind
      and a direction but mean different things. */
  via?: string;
};

/* Every column says what it means, keyed by its heading. A heading alone
   leaves an admin guessing what "applies to" applies to. */
const COLUMN_HELP: Record<string, string> = {
  Name: "What this is called here. Click it to open.",
  Description: "One line on what it is for.",
  "Approval status": "Whether this build may run. Approved means anyone scoped to it; beta means admin-only while you try it; not approved means nobody. Official builds have a known supply chain; a fork is unaudited code that would hold your credentials.",
  "Default for teams": "The teams whose harnesses route here unless something more specific says otherwise. Empty means it is nobody's default.",
  "Default for harnesses": "Harnesses routed here whatever their team's default is. The most specific level, and it wins.",
  "Default for providers": "Runtimes routed here unless the harness or its team says otherwise.",
  "Approved for teams": "Teams that may choose this, without it being their default. Approved is weaker than default.",
  "Approved for harnesses": "Harnesses that may choose this, without it being their default.",
  "Compatible runtimes": "The runtimes that share a wire format with this endpoint. Derived, not approved by hand \u2014 nothing routes here from a runtime that cannot speak to it.",
  "Compatible model providers": "The endpoints this runtime can speak to, by shared wire format.",
  "Wire format": "The API shape. Anthropic and OpenAI-compatible are the two that matter; a runtime and an endpoint must share one.",
  Speaks: "The wire formats this runtime can talk. Claude Code speaks Anthropic; Cursor speaks OpenAI-compatible; a gateway usually exposes both.",
  "API format": "The wire format this endpoint exposes. What can speak to it follows from this, rather than from a list somebody maintains.",
  "Model needs": "The wire format this asset requires, if any. Most work anywhere; a tool written against one API shape does not.",
  Reach: "Who gets it — everyone, or only named teams.",
  "Approval scope": "How widely that approval reaches — the whole org, or only named teams.",
  "Sources allowed": "Which sources may fill this group. Vault only means the chain has one entry and a launch fails rather than falling back to a local login. Vault or local means an ambient sign-in is acceptable, and preflight reports which one actually resolved.",
  "Comes from": "Whether we supply the credential or the person does. Server-supplied means we resolve it from a key provider at launch; locally-owned means a sign-in or machine login we never hold. How long it lives and when it rotates is the vault's business, not ours to grade.",
  Issues: "What comes out of this provider. Temporary credentials are created on request and expire; stored values are read as they are. A provider that can issue temporary ones may still hold plain stored values.",
  Certainty: "How we know. Verified means we checked just now; declared means expected but unobserved.",
  "How it loads": "Always loaded means it goes into every harness and no filter can leave it out \u2014 where a compliance rule belongs. When chosen means it is published and available, included by whoever builds the harness.",

  Contents: "Whether we may list what is inside. Listing names is a separate permission from reading values \u2014 without it, this shows only what an admin typed here.",
  Enforcement: "Enforced means there is no route and no permission, so it holds whatever the agent tries. Intercepted means every invocation is checked before it runs \u2014 the check always happens; what is incomplete is coverage, not enforcement.",
  Kind: "What sort of asset this is.",
  Type: "What the boundary acts on \u2014 an endpoint, a command, the filesystem, or a capability.",
  "Applies to teams": "Which teams this covers. Nothing here means the whole organisation.",
  Added: "When the boundary was set.",
  Record: "Whether anything in the org credentials this endpoint. Unaccounted for means a harness reached it on a login we do not manage.",
  "Last seen": "The most recent time any harness reached this endpoint.",
  Endpoint: "The host a tool tried to reach. The fence works in hostnames, not product names.",
  From: "Which object decided this row \u2014 a security group, a boundary, the model provider, or the web grant. Security groups give; boundaries take away, and this table is where their union lands.",
  "Which one": "The specific object. Nobody writes this table; it is composed from what is granted and what is denied.",
  "Why we expect it": "Why it is reachable, or why not — a group it holds, its model provider, the web switch, or a boundary. Nobody types these — a group it holds, a tool that names the host, or simply that it happens most sessions. Nobody types these.",
  Observed: "Always reachable means it is credentialed or is its model provider. Reachable means the web switch allows it. New means nothing predicted it \u2014 worth a look, not a refusal. Refused means a boundary stopped it.",
  Vault: "Whose vault this is — yours, or the one we host.",
  Secrets: "The secrets this holds or resolves to. Never values.",
  "Key vault": "The vault this secret lives in.",
  "Security groups": "The groups involved — on a secret, the ones that reach it, and a secret with none cannot be reached through us at all; on a harness, the ones it draws credentials from.",
  Teams: "The teams that end up with this, through whatever reaches it.",
  Preflight: "Whether the checks that run before a session would pass. Failing means something stops it \u2014 no runtime that speaks its model provider's format, or an asset needing a format that provider does not expose. The harness's own page names the cause and links to it.",
  "Outside endpoints": "Anything beyond what this harness is credentialed for and its model provider. Allowed means it reaches them through a search-and-fetch tool, minus the boundaries; prohibited means it reaches only what it was granted. What it actually reached is in Endpoints reached.",
  Role: "What they may do. Org admins approve builds, connect vaults and create groups; team admins may narrow what their team already holds; members just use it.",
  Status: "Active, invited and not yet accepted, or deactivated.",
  "Last active": "When they last started a session.",
  "Inside team": "The team this one sits within. A sub-team is how something is kept from part of a team.",
  "Sub-teams": "Teams nested inside this one.",
  People: "Who is in it. Being in a team is the grant.",
  State: "Awaiting review, accepted, declined, or rolled back afterwards.",
  "Changed by": "Who made the change.",
  When: "When it happened.",
  "Granted to teams": "The teams this group is given to. Being on one is what grants it.",
  "Only for harnesses": "Optionally, the harnesses it covers \u2014 a grant and a boundary take the same scoping. Empty means every harness those teams own — the usual case. Naming harnesses is least privilege by job rather than by person.",

  Harnesses: "The harnesses using this.",
  Assets: "The organisation assets this harness includes. Always-loaded ones are in every harness and are not listed per row.",
  Boundaries: "Boundaries that name this harness or its teams. Org-wide ones cover everything and are not repeated here \u2014 the harness's own page shows the full union.",
  "Compatible security groups": "Groups that could satisfy this asset's aliases \u2014 it needs `slack`, and any group with an entry aliased `slack` answers it. Which one actually does depends on the team, so these are candidates, not a binding.",
  "Security groups required": "The groups this harness draws credentials from.",
  "Used by harnesses": "Which harnesses include this. Always loaded means every one of them.",
  "Model providers": "The model providers in play — on a build, the ones it may route through; on a harness, the one it uses. A build and a model provider only pair up if the model provider is approved for it.",
  Team: "Who owns this.",
  "Asked for as": "The name a harness uses. One definition can run at several teams because each team's group binds the name differently.",
  "Resolves to": "The secret that name turns out to be, for this team.",
  "In vault": "Which key provider that secret lives in. One group can span several.",
};

function Head({ label }: { label: string }) {
  const help = COLUMN_HELP[label];
  if (!help) return <>{label}</>;
  return (
    <span title={help} className="inline-flex cursor-help items-baseline gap-1">
      {label}
      <span aria-hidden className="text-faint">
        ?
      </span>
    </span>
  );
}

const REL_COLUMNS: Partial<Record<Kind, Rel[]>> = {
  keystore: [{ heading: "Secrets", kind: "secret", dir: "in" }],
  secret: [
    { heading: "Key vault", kind: "keystore", dir: "out" },
    { heading: "Security groups", kind: "access", dir: "in" },
    { heading: "Teams", kind: "team", dir: "teams" },
  ],
  access: [
    { heading: "Secrets", kind: "secret", dir: "out" },
    { heading: "Granted to teams", kind: "team", dir: "out" },
    { heading: "Only for harnesses", kind: "harness", dir: "out" },
  ],
  change: [
    { heading: "Changed by", kind: "person", dir: "out" },
    { heading: "Team", kind: "team", dir: "out" },
  ],
  permchange: [
    { heading: "Changed by", kind: "person", dir: "out" },
    { heading: "Team", kind: "team", dir: "out" },
  ],
  provchange: [
    { heading: "Changed by", kind: "person", dir: "out" },
    { heading: "Team", kind: "team", dir: "out" },
  ],
  peoplechange: [
    { heading: "Changed by", kind: "person", dir: "out" },
    { heading: "Team", kind: "team", dir: "out" },
  ],
  person: [{ heading: "Teams", kind: "team", dir: "out" }],
  team: [
    { heading: "Inside team", kind: "team", dir: "out" },
    { heading: "Sub-teams", kind: "team", dir: "in" },
    { heading: "People", kind: "person", dir: "in" },
    { heading: "Security groups", kind: "access", dir: "in" },
  ],
  /* A harness is the thing an audit is about, so its row carries everything
     that decides what it can do. */
  harness: [
    { heading: "Assets", kind: "asset", dir: "out", via: "Includes" },
    { heading: "Security groups required", kind: "access", dir: "out", via: "Gets credentials from" },
    { heading: "Boundaries", kind: "boundary", dir: "boundaries" },
    { heading: "Model providers", kind: "model", dir: "out" },
    { heading: "Team", kind: "team", dir: "out" },
  ],
  boundary: [
    { heading: "Applies to teams", kind: "team", dir: "out" },
    { heading: "Only for harnesses", kind: "harness", dir: "out" },
  ],
  asset: [
    { heading: "Compatible security groups", kind: "access", dir: "groups" },
    { heading: "Used by harnesses", kind: "harness", dir: "in", via: "Includes" },
    { heading: "Teams", kind: "team", dir: "teams" },
  ],
  resource: [
    { heading: "Harnesses", kind: "harness", dir: "in" },
    { heading: "Teams", kind: "team", dir: "teams" },
  ],
  provider: [{ heading: "Compatible model providers", kind: "model", dir: "models" }],
  /* Two relations across three dimensions, named the same way in every
     heading. Default is what you get; approved is what you may choose. */
  model: [
    { heading: "Default for teams", kind: "team", dir: "out", via: "Default for" },
    { heading: "Default for harnesses", kind: "harness", dir: "out", via: "Default for" },
    { heading: "Default for providers", kind: "provider", dir: "out", via: "Default for" },
    { heading: "Approved for teams", kind: "team", dir: "out", via: "Approved for" },
    { heading: "Approved for harnesses", kind: "harness", dir: "out", via: "Approved for" },
    { heading: "Compatible runtimes", kind: "provider", dir: "runtimes" },
  ],
};

function relate(id: string, rel: Rel) {
  if (rel.dir === "runnable") return canRunOn(id);
  if (rel.dir === "boundaries") return boundariesFor(id);
  if (rel.dir === "groups") return compatibleGroups(id);
  if (rel.dir === "runtimes") return runtimesFor(id);
  if (rel.dir === "models") return modelsFor(id);
  if (rel.dir === "teams") return teamsServed(id);
  if (rel.via) return neighboursVia(id, rel.kind, rel.dir === "out", rel.via);
  return neighbours(id, rel.kind, rel.dir === "out");
}

/* A scale can read differently depending on what it is describing. Trust on
   a provider is its approval status; reach is the scope of that approval. */
const SCALE_LABEL_FOR: Partial<Record<Kind, Partial<Record<Scale, string>>>> = {
  provider: { trust: "Approval status", reach: "Approval scope", format: "Speaks" },
  model: { format: "API format" },
  /* "Certainty" on a harness was asking whether its credentials can be
     confirmed before it starts. Say that. */
  /* Every org asset reaches every team, so the interesting half of reach is
     whether a harness may leave it out. */
  asset: { reach: "How it loads", format: "Model needs" },
};

function scaleLabel(kind: Kind, scale: Scale) {
  return SCALE_LABEL_FOR[kind]?.[scale] ?? SCALE_LABEL[scale];
}

/* A scanned value that is neither a tag nor a link. A log is read by
   recency, and burying that in a detail page makes the list useless. */
const META_COLUMN: Partial<Record<Kind, string>> = {
  resource: "Last seen",
  boundary: "Added",
  person: "Last active",
  change: "When",
  permchange: "When",
  provchange: "When",
  peoplechange: "When",
};

/* Where a screen's own limits belong: on it, not in a footnote somewhere. */
const KIND_NOTE: Partial<Record<Kind, string>> = {
  resource:
    "This sees the network and nothing else. A harness reaching a local database over a socket, a mounted file share, or anything on the machine itself produces no connection to log — and local work is exactly where the interesting access lives. Treat this as a floor on what was reached, never a ceiling.",
};

/* Which scales each list shows, in order. */
const COLUMNS: Record<Kind, Scale[]> = {
  guide: [],
  provider: ["trust", "format", "reach"],
  model: ["format"],
  keystore: ["capability", "inventory", "ownership"],
  secret: ["strength"],
  access: ["requirement"],
  boundary: ["type", "holds"],
  resource: ["record"],
  asset: ["kind", "format", "reach"],
  change: ["review"],
  permchange: ["review"],
  provchange: ["review"],
  peoplechange: ["review"],
  person: ["role", "status"],
  team: [],
  harness: [],
};

const KIND_PURPOSE: Record<Kind, string> = {
  secret:
    "Every way a harness authenticates to anything — what sits in your vaults, read by listing, plus the sign-ins and machine logins we do not hold. The ones we cannot hold are here on purpose: an admin asking how something authenticates should get one answer, not two. Names and metadata only; never values.",
  guide:
    "What every screen and every tag in here means, and the one rule they all feed. Worth five minutes before anything else.",
  provider:
    "Every runtime you could run, and whether you may. Approved means anyone scoped to it; beta means admin-only while you try it or review a fork; not approved is everything you have not turned on, or have deliberately said no to.",
  model:
    "Where models come from, and who routes to which. Two relations across three dimensions: default for a team, a harness or a harness provider is what you get; approved for one of those is what you may choose. Most specific wins \u2014 harness, then harness provider, then team.",
  keystore: "Which vaults your secrets live in. We keep references, never the values themselves.",
  access:
    "A named group of secrets, granted to teams. Each entry pairs the alias a harness asks for with the secret it resolves to, so one harness definition works across teams with different vaults.",
  boundary:
    "What may not be done, however it is running \u2014 the only thing here that takes something away rather than granting it. Boundaries compound: a harness is covered by every one that names it, its teams, or the whole organisation, and adding a source can only ever narrow. They are never carried by a security group, because removing a group would then remove a restriction.",
  resource:
    "Every endpoint your harnesses actually reached, from the network fence that already has to see the traffic and the broker that minted the credentials. Nobody catalogues this and no agent reports it \u2014 it is observed. Kept for 30 days, by team and by person.",
  asset: "Skills, rules and conventions that apply everywhere, written once for every tool.",
  permchange:
    "Every change to how anything authenticates or what is fenced off \u2014 vaults connected, security groups created and narrowed, boundaries set. The audit an auditor actually asks for.",
  provchange:
    "Every change to what may run and where models come from \u2014 builds approved, declined or moved to beta, and routing defaults changed.",
  peoplechange:
    "Invitations, role changes and deactivations. Because membership is the grant, this log is also the record of who gained and lost access, and when.",
  change:
    "Every change to a harness or an organisation asset — pushed, promoted, accepted, declined, rolled back. Each with an author, a time and the diff underneath.",
  person:
    "Everyone in the org, and everyone invited. A person gets what their teams are granted — there is no per-person permission list, which is why removing someone from a team removes their access in one step.",
  team: "The groups everything else is given to. Being in a team is what grants it.",
  harness: "Everything your teams have built. Owned by them, governed by the rules on this side.",
};

const KIND_PLURAL: Record<Kind, string> = {
  guide: "How this works",
  secret: "Secrets inventory",
  provider: "Harness providers",
  model: "Model providers",
  keystore: "Key vaults",
  access: "Security groups",
  boundary: "Boundaries",
  resource: "Endpoints reached",
  asset: "Organisation assets",
  change: "Harness changes",
  permchange: "Permission changes",
  provchange: "Provider changes",
  peoplechange: "People changes",
  person: "People",
  team: "Teams",
  harness: "Harnesses",
};

/* Every entity is a destination, so every entity has an address. The hash
   carries the whole walk — `#access/access.finance-warehouse/keystore.aws` —
   so a screen can be linked to, reloaded, and stepped back through with the
   browser's own back button. */
function readHash(): { kind: Kind; trail: string[] } {
  const raw = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
  const [kind, ...trail] = raw.split("/").filter(Boolean);
  const known = kind && kind in KIND_PLURAL ? (kind as Kind) : "provider";
  return { kind: known, trail: trail.filter((id) => Boolean(lookup(id))) };
}

function Tags({
  badges,
  onWalk,
}: {
  badges?: { label: string; tone: Tone }[];
  onWalk?: (id: string) => void;
}) {
  if (!badges?.length) return <span className="text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {badges.map((badge) => {
        const guide = BADGE_GUIDE[badge.label];
        if (!guide || !onWalk) {
          return (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          );
        }
        return (
          <Button
            key={badge.label}
            variant="bare"
            size="none"
            title={`What "${badge.label}" means`}
            className="rounded-md opacity-90 hover:opacity-100"
            onClick={() => onWalk(guide)}
          >
            <Badge tone={badge.tone}>
              {badge.label}
              <span aria-hidden className="opacity-60">
                ?
              </span>
            </Badge>
          </Button>
        );
      })}
    </span>
  );
}

/* Adding things. Fixture-only: the point is to settle what an admin is asked
   for, and what happens next for everyone else. */
const ADD_FORM: Partial<
  Record<
    Kind,
    {
      title: string;
      lede: string;
      fields: { label: string; placeholder: string; hint?: string; options?: string[] }[];
      after?: { label: string; command: string; hint: string };
    }
  >
> = {
  provider: {
    title: "Add a harness provider",
    lede: "Point at a repository and pin it to one exact build. Nobody has to clone anything — once this is saved, anyone in the org installs it by name.",
    fields: [
      { label: "Source repository", placeholder: "github.com/acme/acme-code" },
      { label: "Pin to commit", placeholder: "4f2c9ab", hint: "A commit, never a branch. A branch can move under you." },
      { label: "Name people will type", placeholder: "acme-code" },
      { label: "Who may run it", placeholder: "", options: ["Engineering", "Support", "Everyone"] },
    ],
    after: {
      label: "Then anyone you scoped it to runs",
      command: "harness provider add acme-code",
      hint: "once per machine",
    },
  },
  model: {
    title: "Add a model provider",
    lede: "Where models come from. One provider is the org default and every harness inherits it; anything else is an override a team has to ask for.",
    fields: [
      { label: "Name", placeholder: "Self-hosted gateway" },
      { label: "Endpoint", placeholder: "models.internal.acme.co" },
      { label: "Wire format", placeholder: "", options: ["OpenAI-compatible", "Anthropic", "Bedrock"] },
      { label: "Who may route here", placeholder: "", options: ["The org default", "Engineering only", "Support only"] },
    ],
  },
  person: {
    title: "Invite people",
    lede: "An invitation grants nothing on its own. They get what their team holds, from the moment they accept.",
    fields: [
      {
        label: "Email addresses",
        placeholder: "ana@acme.co, ben@acme.co",
        hint: "One invitation each, same team and role.",
      },
      {
        label: "Team",
        placeholder: "",
        options: ["Finance", "Engineering", "Senior Engineering", "Support", "Marketing", "Marketing interns"],
      },
      { label: "Role", placeholder: "", options: ["Member", "Team admin", "Org admin"] },
    ],
  },
  team: {
    title: "Add a team",
    lede: "A team is a group things are granted to. Nesting one inside another is how a narrower group reaches fewer people.",
    fields: [
      { label: "Name", placeholder: "Marketing interns" },
      {
        label: "Inside",
        placeholder: "",
        options: ["\u2014 top level \u2014", "Finance", "Engineering", "Support", "Marketing"],
      },
    ],
  },
  keystore: {
    title: "Connect a vault",
    lede: "We store a reference and ask your vault for a credential at launch. The value never lands here.",
    fields: [
      { label: "Name", placeholder: "AWS Secrets Manager" },
      { label: "Kind", placeholder: "", options: ["AWS Secrets Manager", "Azure Key Vault", "HashiCorp Vault", "Ours, hosted"] },
      { label: "How we authenticate", placeholder: "", options: ["Assume an IAM role", "AppRole", "Service principal"] },
    ],
  },
};

function AddDialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const form = ADD_FORM[kind];
  if (!form) return null;
  return (
    <Modal title={form.title} onClose={onClose}>
      <div className="grid gap-4 p-5">
        <p className="text-[13px] leading-relaxed text-muted">{form.lede}</p>
        {form.fields.map((field) => (
          <Field key={field.label} label={field.label} hint={field.hint}>
            {field.options ? (
              <select className={CONTROL_CLASS} defaultValue={field.options[0]}>
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input className={CONTROL_CLASS} placeholder={field.placeholder} />
            )}
          </Field>
        ))}
        {form.after && (
          <div className="border-t border-hairline pt-4">
            <CommandBlock
              label={form.after.label}
              command={form.after.command}
              hint={form.after.hint}
            />
          </div>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onClose}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RelLinks({
  id,
  rel,
  onWalk,
}: {
  id: string;
  rel: Rel;
  onWalk: (target: string) => void;
}) {
  /* Some scopes are "all of them" rather than a list. Saying so beats either
     an empty cell or every row of the other table pasted into this one. */
  if (lookup(id)?.everyone?.includes(rel.heading)) {
    return <Chip>All {rel.heading.split(" ").pop()?.toLowerCase()}</Chip>;
  }
  const items = relate(id, rel);
  if (!items.length) return <span className="text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Button
          key={item.id}
          variant="bare"
          size="none"
          className="rounded-md"
          onClick={() => onWalk(item.id)}
          title={`Open ${item.name}`}
        >
          <Chip>{item.name}</Chip>
        </Button>
      ))}
    </span>
  );
}

export function OrgPreview() {
  const [kind, setKind] = useState<Kind>("provider");
  /* The trail is the walk: every relationship is a destination, and going
     back through how you arrived is most of what makes the graph usable. */
  const [trail, setTrail] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Kind>();

  useEffect(() => {
    const apply = () => {
      const next = readHash();
      setKind(next.kind);
      setTrail(next.trail);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const open = trail.length ? lookup(trail[trail.length - 1]) : undefined;

  function go(nextKind: Kind, nextTrail: string[]) {
    window.location.hash = [nextKind, ...nextTrail].join("/");
    setKind(nextKind);
    setTrail(nextTrail);
    setSearch("");
  }

  function walk(id: string) {
    go(kind, [...trail, id]);
  }

  function showList(next: Kind) {
    go(next, []);
  }

  const rows = useMemo(() => {
    const all = ofKind(kind);
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter((row) =>
      `${row.name} ${row.blurb}`.toLowerCase().includes(query),
    );
  }, [kind, search]);

  return (
    <div className="grid min-h-screen grid-cols-1 bg-canvas md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-line bg-sunken px-4 py-5 md:border-r">
        <div className="flex items-center gap-2.5 px-2">
          <BrandMark small />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">Acme Holdings</span>
            <span className="block font-mono text-[10px] tracking-[0.06em] text-faint uppercase">
              Organisation
            </span>
          </span>
        </div>

        <nav className="mt-6 grid gap-5">
          {GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="px-2 text-[10px] font-bold tracking-[0.11em] text-faint uppercase">
                {group.heading}
              </p>
              <ul className="mt-1.5 grid list-none gap-0.5 p-0">
                {group.kinds.map((candidate) => {
                  const active = candidate === kind;
                  return (
                    <li key={candidate}>
                      <Button
                        variant="bare"
                        size="none"
                        full
                        className={`items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
                          active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface hover:text-fg"
                        }`}
                        onClick={() => showList(candidate)}
                      >
                        <span className="truncate">{KIND_PLURAL[candidate]}</span>
                        <span className="font-mono text-[10px] text-faint">
                          {ofKind(candidate).length}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <p className="mt-8 px-2 text-[11px] leading-relaxed text-faint">
          Prototype. Everything here is made up, and nothing you click changes anything.
        </p>
      </aside>

      <main className="min-w-0 px-5 py-5 md:px-8 md:py-7">
        <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
          <Trail
            kind={kind}
            trail={trail}
            onRoot={() => go(kind, [])}
            onStep={(index) => go(kind, trail.slice(0, index + 1))}
          />
          <span className="ml-auto">
            {!open && (
              <HeaderSearch
                value={search}
                onValueChange={setSearch}
                placeholder={`Search ${KIND_PLURAL[kind].toLowerCase()}`}
              />
            )}
          </span>
        </header>

        {open ? (
          <Detail entity={open} onWalk={walk} />
        ) : (
          <ListScreen kind={kind} rows={rows} onOpen={walk} onAdd={() => setAdding(kind)} />
        )}
      </main>

      {adding && <AddDialog kind={adding} onClose={() => setAdding(undefined)} />}
    </div>
  );
}

/* Navigation -------------------------------------------------------------- */

function Trail({
  kind,
  trail,
  onRoot,
  onStep,
}: {
  kind: Kind;
  trail: string[];
  onRoot: () => void;
  onStep: (index: number) => void;
}) {
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
      <Button
        variant="bare"
        size="none"
        className={`px-0 ${trail.length ? "text-muted hover:text-fg" : "font-semibold text-fg"}`}
        onClick={onRoot}
      >
        {KIND_PLURAL[kind]}
      </Button>
      {trail.map((id, index) => {
        const step = lookup(id);
        const last = index === trail.length - 1;
        return (
          <span key={`${id}-${index}`} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="text-faint">
              ›
            </span>
            <Button
              variant="bare"
              size="none"
              className={`truncate px-0 ${last ? "font-semibold text-fg" : "text-muted hover:text-fg"}`}
              onClick={() => onStep(index)}
            >
              {step?.name ?? id}
            </Button>
          </span>
        );
      })}
    </nav>
  );
}

/* List -------------------------------------------------------------------- */

/* Teams nest, so the list has to read as a tree — a flat list of names hides
   the one thing that matters about them, which is what sits inside what. */
function nest(rows: Entity[], open: Set<string>) {
  const parentOf = (id: string) => neighbours(id, "team", true)[0]?.id;
  const ids = new Set(rows.map((row) => row.id));
  const childrenOf = (id?: string) =>
    rows.filter((row) => {
      const parent = parentOf(row.id);
      return id ? parent === id : !parent || !ids.has(parent);
    });
  const out: { row: Entity; depth: number; kids: number }[] = [];
  const walk = (id: string | undefined, depth: number) => {
    for (const row of childrenOf(id)) {
      const kids = childrenOf(row.id).length;
      out.push({ row, depth, kids });
      /* Collapsed by default: the top level is the shape of the org, and
         sub-teams are the detail you open when you want it. */
      if (open.has(row.id)) walk(row.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

function ListScreen({
  kind,
  rows,
  onOpen,
  onAdd,
}: {
  kind: Kind;
  rows: Entity[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const form = ADD_FORM[kind];
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <>
      <p className="mt-4 max-w-[62ch] text-[13px] leading-relaxed text-muted">
        {KIND_PURPOSE[kind]}
      </p>

      {KIND_NOTE[kind] && (
        <div className="mt-4 max-w-[68ch]">
          <Notice tone="hold">{KIND_NOTE[kind]}</Notice>
        </div>
      )}

      <Toolbar
        count={`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
        actions={
          form ? (
            <Button variant="primary" size="sm" onClick={onAdd}>
              {form.title}
            </Button>
          ) : undefined
        }
      />

      <div className="mt-1">
        {rows.length === 0 ? (
          <EmptyState>Nothing matches.</EmptyState>
        ) : (
          <Table
            head={[
              <Head label="Name" />,
              <Head label="Description" />,
              ...(kind === "harness"
                ? [<Head key="launch" label="Preflight" />, <Head key="web" label="Outside endpoints" />]
                : []),
              ...COLUMNS[kind].map((scale) => <Head key={scale} label={scaleLabel(kind, scale)} />),
              ...(META_COLUMN[kind] ? [<Head key="meta" label={META_COLUMN[kind] as string} />] : []),
              ...(REL_COLUMNS[kind] ?? []).map((rel) => (
                <Head key={rel.heading} label={rel.heading} />
              )),
            ]}
          >
            {(kind === "team"
              ? nest(rows, open)
              : rows.map((row) => ({ row, depth: 0, kids: 0 }))
            ).map(({ row, depth, kids }) => (
              <Tr key={row.id}>
                <Td className="w-[20rem]">
                  <span
                    className="flex items-center gap-1.5"
                    style={{ paddingLeft: `${depth * 1.25}rem` }}
                  >
                    {kids > 0 ? (
                      <Button
                        variant="bare"
                        size="none"
                        className="w-4 justify-center font-mono text-[11px] text-faint hover:text-fg"
                        title={open.has(row.id) ? "Collapse" : `Show ${kids} sub-team${kids > 1 ? "s" : ""}`}
                        onClick={() =>
                          setOpen((current) => {
                            const next = new Set(current);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })
                        }
                      >
                        {open.has(row.id) ? "▾" : "▸"}
                      </Button>
                    ) : depth > 0 ? (
                      <span aria-hidden className="w-4 text-center font-mono text-[11px] text-faint">
                        └
                      </span>
                    ) : null}
                    <Button
                      variant="bare"
                      size="none"
                      className="text-left text-[13px] font-semibold text-fg hover:text-accent"
                      onClick={() => onOpen(row.id)}
                    >
                      {row.name}
                    </Button>
                  </span>
                </Td>
                <Td className="text-muted">{row.blurb}</Td>
                {kind === "harness" && (
                  <Td>
                    {launchBlockers(row.id).length > 0 ? (
                      <Tags badges={[{ label: "failing", tone: "warn" }]} onWalk={onOpen} />
                    ) : (
                      <Tags badges={[{ label: "passing", tone: "ok" }]} onWalk={onOpen} />
                    )}
                  </Td>
                )}
                {kind === "harness" && (
                  <Td>
                    <Tags
                      badges={[
                        hasWeb(row.id)
                          ? { label: "allowed", tone: "accent" }
                          : { label: "prohibited", tone: "neutral" },
                      ]}
                      onWalk={onOpen}
                    />
                  </Td>
                )}
                {COLUMNS[kind].map((scale) => (
                  <Td key={scale}>
                    <Tags
                      badges={row.badges?.filter((badge) => SCALE_OF[badge.label] === scale)}
                      onWalk={onOpen}
                    />
                  </Td>
                ))}
                {META_COLUMN[kind] && (
                  <Td>
                    <Mono>{row.meta ?? "—"}</Mono>
                  </Td>
                )}
                {(REL_COLUMNS[kind] ?? []).map((rel) => (
                  <Td key={rel.heading}>
                    <RelLinks id={row.id} rel={rel} onWalk={onOpen} />
                  </Td>
                ))}
              </Tr>
            ))}
          </Table>
        )}
      </div>
    </>
  );
}

/* Detail ------------------------------------------------------------------ */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-[10px] font-bold tracking-[0.11em] text-muted uppercase">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* One row in a relationship list. Used at one hop and at two. */
function WalkRow({ item, onWalk }: { item: Entity; onWalk: (id: string) => void }) {
  return (
    <Button
      variant="bare"
      size="none"
      full
      className="items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-line hover:bg-sunken"
      onClick={() => onWalk(item.id)}
    >
      <Dot tone="accent" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{item.name}</span>
      <span className="hidden font-mono text-[10px] tracking-[0.05em] text-faint uppercase sm:inline">
        {KIND_LABEL[item.kind]}
      </span>
      <span aria-hidden className="text-faint">
        ›
      </span>
    </Button>
  );
}

function TwoHop({
  title,
  lede,
  groups,
  onWalk,
}: {
  title: string;
  lede: string;
  groups: { kind: Kind; items: Entity[] }[];
  onWalk: (id: string) => void;
}) {
  return (
    <Card title={title}>
      <p className="-mt-1 mb-3 max-w-[60ch] text-[13px] leading-relaxed text-muted">{lede}</p>
      <div className="grid gap-4">
        {groups.map((group) => (
          <div key={group.kind}>
            <p className="text-[11px] font-bold tracking-[0.08em] text-faint uppercase">
              {KIND_PLURAL[group.kind]}
            </p>
            <ul className="mt-1.5 grid list-none gap-1 p-0">
              {group.items.map((item) => (
                <li key={item.id}>
                  <WalkRow item={item} onWalk={onWalk} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Detail({ entity, onWalk }: { entity: Entity; onWalk: (id: string) => void }) {
  const groups = relations(entity.id);
  const rests = dependsOn(entity.id);
  const serves = ["provider", "model", "keystore", "secret"].includes(entity.kind)
    ? teamsServed(entity.id)
    : [];
  const breaks = wouldBreak(entity.id);

  return (
    <article className="mt-5 grid max-w-[64rem] gap-5">
      <div>
        <Eyebrow>{KIND_LABEL[entity.kind]}</Eyebrow>
        <h1 className="mt-1.5 font-serif text-[27px] leading-tight">{entity.name}</h1>
        <p className="mt-1.5 text-[13px] text-muted">{entity.blurb}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {entity.badges && <Tags badges={entity.badges} onWalk={onWalk} />}
          {entity.kind === "harness" && launchBlockers(entity.id).length > 0 && (
            <Tags badges={[{ label: "failing", tone: "warn" }]} onWalk={onWalk} />
          )}
          {entity.kind === "harness" && (
            <Tags
              badges={[
                hasWeb(entity.id)
                  ? { label: "allowed", tone: "accent" }
                  : { label: "prohibited", tone: "neutral" },
              ]}
              onWalk={onWalk}
            />
          )}
          {(REL_COLUMNS[entity.kind] ?? []).map((rel) => (
            <span key={rel.heading} className="flex items-center gap-2">
              <span
                title={COLUMN_HELP[rel.heading]}
                className="cursor-help text-[11px] font-bold tracking-[0.08em] text-faint uppercase"
              >
                {rel.heading}
              </span>
              <RelLinks id={entity.id} rel={rel} onWalk={onWalk} />
            </span>
          ))}
        </div>
      </div>

      {entity.decision && (
        <section className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3.5">
          <h2 className="text-[10px] font-bold tracking-[0.11em] text-accent uppercase">
            What this screen decides
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed">{entity.decision}</p>
        </section>
      )}

      {entity.facts && (
        <Card title={entity.checks ? "Set by an admin" : "Details"}>
          <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            {entity.facts.map((fact, index) => (
              <div key={index} className="contents">
                <dt className="text-[13px] text-muted">{fact.label}</dt>
                <dd className="text-[13px]">
                  {fact.mono ? <Chip>{fact.value}</Chip> : fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {entity.kind === "harness" && launchBlockers(entity.id).length > 0 && (
        <section className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3.5">
          <h2 className="text-[10px] font-bold tracking-[0.11em] text-warn uppercase">
            Why preflight would refuse this
          </h2>
          <ul className="mt-2.5 grid list-none gap-3.5 p-0">
            {launchBlockers(entity.id).map((blocker) => (
              <li key={blocker.text} className="grid gap-1">
                <span className="text-[14px] leading-relaxed">{blocker.text}</span>
                <span className="text-[13px] leading-relaxed text-muted">{blocker.fix}</span>
                {blocker.goTo && (
                  <span>
                    <Button
                      variant="bare"
                      size="none"
                      className="items-center gap-1.5 text-[13px] text-accent hover:underline"
                      onClick={() => onWalk(blocker.goTo!.id)}
                    >
                      Open {blocker.goTo.name}
                      <span aria-hidden>›</span>
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3.5 border-t border-warn/20 pt-3 text-[13px] leading-relaxed text-muted">
            Found before anything starts, named, and linked to the thing to change. The
            alternative is a session that dies halfway through with a stack trace from somebody
            else&apos;s API.
          </p>
        </section>
      )}

      {entity.reach && (
        <Card title="What it may reach">
          <p className="-mt-1 mb-3 max-w-[64ch] text-[13px] leading-relaxed text-muted">
            Two ends need no decision: what it is credentialed for is reachable, what a boundary
            names is not. In between there is one switch. Nobody authors this list — it is what
            the grants already imply, set against what the fence actually logged.
          </p>
          <Table
            head={[
              <Head key="a" label="Endpoint" />,
              <Head key="b" label="From" />,
              <Head key="b2" label="Which one" />,
              <Head key="c" label="Observed" />,
            ]}
          >
            {entity.reach.map((item) => (
              <Tr key={item.endpoint}>
                <Td className="w-[22rem]">
                  <Chip>{item.endpoint}</Chip>
                </Td>
                <Td className="w-[11rem]">
                  <Mono>{item.from}</Mono>
                </Td>
                <Td className="text-muted">{item.via}</Td>
                <Td>
                  <Tags
                    badges={[
                      {
                        label: item.status,
                        tone:
                          item.status === "refused"
                            ? "warn"
                            : item.status === "new"
                              ? "hold"
                              : item.status === "always reachable"
                                ? "accent"
                                : "ok",
                      },
                    ]}
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}

      {entity.contents && (
        <Card title="What this group holds">
          <p className="-mt-1 mb-3 max-w-[64ch] text-[13px] leading-relaxed text-muted">
            A harness asks for the name on the left; the group decides which secret that turns out
            to be for this team, which is why one harness definition works across teams with
            different vaults. Strength is per entry — the group is only as strong as its weakest.
          </p>
          <Table
            head={[
              <Head key="a" label="Asked for as" />,
              <Head key="b" label="Resolves to" />,
              <Head key="c" label="In vault" />,
              <Head key="d" label="Credential strength" />,
            ]}
          >
            {entity.contents.map((item) => {
              const target = item.secret ? lookup(item.secret) : undefined;
              const vault = target ? neighbours(target.id, "keystore", true) : [];
              return (
                <Tr key={item.alias}>
                  <Td className="w-[10rem]">
                    <Chip>{item.alias}</Chip>
                  </Td>
                  <Td>
                    {target ? (
                      <Button
                        variant="bare"
                        size="none"
                        className="items-center gap-2 text-left text-[13px] font-semibold hover:text-accent"
                        onClick={() => onWalk(target.id)}
                      >
                        <span className="truncate">{target.name}</span>
                        <span aria-hidden className="text-faint">
                          ›
                        </span>
                      </Button>
                    ) : (
                      <span className="text-[13px] text-muted">{item.note}</span>
                    )}
                  </Td>
                  <Td>
                    {vault.length ? (
                      <Button
                        variant="bare"
                        size="none"
                        className="rounded-md"
                        onClick={() => onWalk(vault[0].id)}
                      >
                        <Chip>{vault[0].name}</Chip>
                      </Button>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                  <Td>
                    {item.strength && (
                      <Tags
                        badges={[
                          {
                            label: item.strength,
                            tone: item.strength === "vault-supplied" ? "ok" : "hold",
                          },
                        ]}
                        onWalk={onWalk}
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        </Card>
      )}

      {entity.checks && (
        <Card title="Checked just now">
          <p className="-mt-1 mb-3 max-w-[60ch] text-[13px] leading-relaxed text-muted">
            Asked when this screen loaded, not stored anywhere. Everything above it was typed by
            someone and has a history; this is the live half.
          </p>
          <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            {entity.checks.map((check, index) => (
              <div key={index} className="contents">
                <dt className="flex items-center gap-2 text-[13px] text-muted">
                  <Dot tone="ok" />
                  {check.label}
                </dt>
                <dd className="text-[13px]">{check.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {groups.length > 0 && (
        <Card title="Connected to">
          <div className="grid gap-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-bold tracking-[0.08em] text-faint uppercase">
                  {group.label}
                </p>
                <ul className="mt-1.5 grid list-none gap-1 p-0">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <WalkRow item={item} onWalk={onWalk} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {serves.length > 0 && (
        <Card title="Who this ends up serving">
          <p className="-mt-1 mb-3 max-w-[60ch] text-[13px] leading-relaxed text-muted">
            The teams reached through whatever uses this — the answer to “who is actually getting
            it?”, which is a hop further than the list of things attached to it.
          </p>
          <ul className="grid list-none gap-1 p-0">
            {serves.map((team) => (
              <li key={team.id}>
                <WalkRow item={team} onWalk={onWalk} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {breaks.length > 0 && (
        <TwoHop
          title="What would break"
          lede="Not attached to this directly, but resting on it. This is the answer to “if I change this, what stops working?”"
          groups={breaks}
          onWalk={onWalk}
        />
      )}

      {rests.length > 0 && (
        <TwoHop
          title="What this rests on"
          lede="Two steps away in the other direction — the things this needs in order to work."
          groups={rests}
          onWalk={onWalk}
        />
      )}

      {entity.elsewhere && (
        <Card title="Set somewhere else, on purpose">
          <div className="grid gap-3">
            {entity.elsewhere.map((item, index) => (
              <div key={index} className="grid gap-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{item.what}</span>
                  <Chip>{item.where}</Chip>
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{item.why}</p>
              </div>
            ))}
            <p className="border-t border-hairline pt-3 text-[12px] leading-relaxed text-faint">
              If changing it here would not actually change it there, the control does not belong
              here. We show what is true and link out.
            </p>
          </div>
        </Card>
      )}

      {entity.history && (
        <Card title="What changed">
          <ul className="grid list-none gap-3.5 p-0">
            {entity.history.map((change, index) => (
              <li key={index} className="grid gap-1.5">
                <p className="text-[13px] leading-relaxed">{change.plain}</p>
                <p className="font-mono text-[11px] text-faint">
                  {change.who} · {change.when}
                </p>
                <Disclosure
                  summary={<span className="font-mono text-[11px]">View as git</span>}
                >
                  <pre className="mt-2 overflow-auto rounded-md bg-sunken px-3.5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre text-fg">
                    {change.git}
                  </pre>
                </Disclosure>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </article>
  );
}
