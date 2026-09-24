/* The definition plane, as files. A harness is a directory of assets, and the
   team and user surfaces are mostly about looking at them, seeing what
   changed, and settling disagreements about them. */

export type FileState = "clean" | "modified" | "conflict" | "incoming" | "yours";
export type Owner = "organisation" | "team" | "you";

export interface HarnessFile {
  path: string;
  kind: string;
  owner: Owner;
  state: FileState;
  note?: string;
  body: string;
  /** Present when the file differs from what the team last delivered. */
  diff?: { summary: string; who: string; when: string; hunk: string };
  /** Present when both sides moved. */
  conflict?: { yours: string; theirs: string; whoTheirs: string; whenTheirs: string };
}

export interface HarnessTree {
  id: string;
  name: string;
  team: string;
  blurb: string;
  preflight: "passing" | "failing";
  files: HarnessFile[];
}

const HOUSE = `# House writing style

Write the way a competent colleague speaks.

- Apologise once, say what you are doing about it, then do it.
- No exclamation marks in anything customer-facing.
- Never promise a date the team has not agreed.`;

export const TREES: HarnessTree[] = [
  {
    id: "campaign-drafts",
    name: "Campaign drafts",
    team: "Marketing",
    blurb: "Drafts campaigns from a brief.",
    preflight: "passing",
    files: [
      {
        path: "prompt/house-style/PROMPT.md",
        kind: "prompt",
        owner: "organisation",
        state: "clean",
        note: "Always loaded. Nothing below the organisation can change it.",
        body: HOUSE,
      },
      {
        path: "memory/never-drop-db/never-drop-db.md",
        kind: "memory",
        owner: "organisation",
        state: "clean",
        body: `Never run a destructive database command.\n\nIf a task seems to need one, stop and say so.`,
      },
      {
        path: "skill/campaign-brief/SKILL.md",
        kind: "skill",
        owner: "team",
        state: "conflict",
        note: "You changed this and Marketing changed it. Nothing is lost — pick one.",
        body: `# Campaign brief\n\n## Tone\nWarm, specific, never breathless.`,
        conflict: {
          yours: `## Tone\nWarm, specific, never breathless.\nLead with the customer's problem, not the product.`,
          theirs: `## Tone\nWarm and specific.\nOpen with the offer in the first line.`,
          whoTheirs: "Rae Lindqvist",
          whenTheirs: "2 days ago",
        },
      },
      {
        path: "skill/campaign-brief/examples.md",
        kind: "skill",
        owner: "team",
        state: "clean",
        body: `Three briefs that worked, and one that did not.`,
      },
      {
        path: "tool/crm-sync/run",
        kind: "tool",
        owner: "team",
        state: "modified",
        note: "Yours differs from the team's copy. Push it or reset it.",
        body: `#!/usr/bin/env bash\n# Pull the campaign list from HubSpot.\nset -euo pipefail\ncurl -sS "$CRM_BASE/lists/$1" -H "Authorization: Bearer $CRM_API_KEY"`,
        diff: {
          summary: "Added a retry so a flaky list call stops failing the whole run.",
          who: "You",
          when: "yesterday",
          hunk: `@@ -2,4 +2,6 @@\n set -euo pipefail\n-curl -sS "$CRM_BASE/lists/$1" \\\n+curl -sS --retry 3 --retry-connrefused "$CRM_BASE/lists/$1" \\\n   -H "Authorization: Bearer $CRM_API_KEY"`,
        },
      },
      {
        path: "tool/refund-lookup/run",
        kind: "tool",
        owner: "team",
        state: "incoming",
        note: "Rae promoted this today. You will get it at your next session.",
        body: `#!/usr/bin/env bash\n# Look up a refund by order id.\ncurl -sS "https://api.stripe.com/v1/refunds/$1"`,
        diff: {
          summary: "New tool. Reaches api.stripe.com, which is why that endpoint shows as new.",
          who: "Rae Lindqvist",
          when: "today, 09:58",
          hunk: `@@ -0,0 +1,3 @@\n+#!/usr/bin/env bash\n+# Look up a refund by order id.\n+curl -sS "https://api.stripe.com/v1/refunds/$1"`,
        },
      },
      {
        path: "memory/brand-voice/brand-voice.md",
        kind: "memory",
        owner: "you",
        state: "yours",
        note: "Only you have this. Push it if the team should too.",
        body: `We say "people", not "users", in anything a customer reads.`,
      },
    ],
  },
  {
    id: "brand-voice-check",
    name: "Brand voice check",
    team: "Marketing",
    blurb: "Reads a draft and flags anything off-voice.",
    preflight: "passing",
    files: [
      {
        path: "prompt/house-style/PROMPT.md",
        kind: "prompt",
        owner: "organisation",
        state: "clean",
        body: HOUSE,
      },
      {
        path: "skill/voice-check/SKILL.md",
        kind: "skill",
        owner: "team",
        state: "clean",
        body: `# Voice check\n\nRead the draft twice. Flag, do not rewrite.`,
      },
    ],
  },
  {
    id: "launch-checklist",
    name: "Launch checklist",
    team: "Marketing",
    blurb: "Walks a launch from brief to send.",
    preflight: "failing",
    files: [
      {
        path: "tool/summariser/run",
        kind: "tool",
        owner: "team",
        state: "clean",
        note: "Needs the Anthropic format. This harness routes through OpenRouter, which does not expose it.",
        body: `#!/usr/bin/env bash\n# Fold a long thread into a brief.`,
      },
    ],
  },
];

export const STATE_TONE: Record<FileState, "ok" | "hold" | "warn" | "accent" | "neutral"> = {
  clean: "neutral",
  modified: "hold",
  conflict: "warn",
  incoming: "accent",
  yours: "accent",
};

export const STATE_WORD: Record<FileState, string> = {
  clean: "unchanged",
  modified: "you changed it",
  conflict: "conflict",
  incoming: "incoming",
  yours: "yours only",
};

export function tree(id: string) {
  return TREES.find((one) => one.id === id);
}
