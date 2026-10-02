/** The Providers stories (01 §13). Not a test file.
 *
 *  A row is a nested object — the pin, the wire formats and the scope the
 *  approval switch sends back verbatim — and `mount()` serialises its props,
 *  so the rows are declared here, in the browser bundle, and each story takes
 *  the one flag its spec varies. */
import { HarnessProviderTable } from "@/app/(console)/console/[scope]/providers/_table";
import { ModelProviderTable } from "@/app/(console)/console/[scope]/providers/model/_table";
import { matrixRows } from "@/lib/views/providers";
import type { HarnessProviderRow, ModelProviderRow, RoutingMatrix } from "@/lib/views/providers";
import { EMPTY } from "@/content/empty";

/** `scope` rides on the row as an extra field; the fixture names a team so a
 *  widening to *all* would show in what the switch sends. */
const RUNTIME: HarnessProviderRow = {
  id: "pi",
  name: "Pi",
  approval: "not_approved",
  speaks: ["anthropic-messages", "openai-completions"],
  pin: { repo: "https://example.com/pi", commit: "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759" },
  reason: "Not reviewed yet.",
  scope: { teams: ["acme.marketing"] },
  teams: {
    unit: "teams",
    items: [{ id: "acme.marketing", label: "Marketing", href: "/console/acme.marketing" }],
  },
  canRun: { unit: "harnesses", items: [] },
};

const MODEL: ModelProviderRow = {
  id: "anthropic",
  endpoints: { "anthropic-messages": "https://api.anthropic.com/v1/messages" },
  models: ["claude-opus-5"],
  credential: null,
  status: "needs-key",
  groups: { unit: "groups", items: [] },
  defaultFor: { teams: [], harnesses: [], providers: [] },
  approvedFor: { teams: [], harnesses: [], providers: [] },
};

const HARNESS = "7bb0f4ee-0e8a-4f6a-9df0-4b6bd3f0a001";

/** `GET /v1/console/routing` (W6-D5): the two maps the verbs send back whole,
 *  and the subjects they may pick, each with the word for it. */
const MATRIX: RoutingMatrix = {
  defaultFor: { teams: { acme: "anthropic" }, harnesses: {}, providers: {} },
  approvedFor: { teams: { acme: ["anthropic"] }, harnesses: {}, providers: {} },
  resolved: { "acme.marketing": { value: "anthropic", provenance: "derived" } },
  subjects: {
    teams: [{ id: "acme", label: "acme" }, { id: "acme.marketing", label: "Marketing" }],
    harnesses: [{ id: HARNESS, label: "Newsletter" }],
    providers: [{ id: "pi", label: "Pi" }],
  },
};

export function HarnessProviders({ approved = false }: { approved?: boolean }) {
  return (
    <HarnessProviderTable
      rows={[approved ? { ...RUNTIME, approval: "approved" } : RUNTIME]}
      personal={false}
      orgAdmin
      empty={EMPTY.providers.sentence}
    />
  );
}

/**
 * `connected` is a row with a key (so no *Set up*), `team` is the team scope —
 * `adminHere` without `orgAdmin`, where the only subject is the team's own and
 * *Approve for…* and *Delete* are not the viewer's (D42, P13).
 */
export function ModelProviders({
  connected = false,
  team = false,
  signIn = false,
}: {
  connected?: boolean;
  team?: boolean;
  /** W7-D2: no key is held and the runtime signs in to this provider itself. */
  signIn?: boolean;
}) {
  const row: ModelProviderRow = connected
    ? {
        ...MODEL,
        credential: "anthropic",
        status: "set-up",
        defaultFor: { teams: ["acme"], harnesses: [], providers: [] },
        approvedFor: { teams: ["acme"], harnesses: [], providers: [] },
      }
    : signIn
      ? { ...MODEL, status: "sign-in" }
      : MODEL;
  const only = team ? "acme.marketing" : null;
  return (
    <ModelProviderTable
      rows={[row]}
      orgAdmin={!team}
      adminHere
      matrix={MATRIX}
      byTeam={matrixRows(MATRIX, only)}
      only={only}
      empty={EMPTY["providers.model"].sentence}
    />
  );
}
