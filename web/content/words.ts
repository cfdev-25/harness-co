/**
 * The vocabulary — `docs/console/05-in-platform-docs.md` §5.
 *
 * Each key is the word itself (so the `Word` component's children and the
 * *How this works* page's alphabetical list both read straight off the
 * registry key); each entry is one sentence for anyone, one sentence more for
 * the technical reader, and the PRD section that decides it.
 */

/** 05 §5's shape, widened by one case: the `session` row's reference is
 *  `engine 04`, not a PRD `§` section, because a session is an engine
 *  contract (engine 00 §4) rather than a PRD-numbered concept. Reported to
 *  the caller as a spec gap rather than inventing a `§` number. */
export type PrdRef = `§${string}` | `engine ${string}`;

export interface WordEntry {
  short: string;
  more: string;
  prd: PrdRef;
}

export const WORDS = {
  harness: {
    short: "The set of things an AI assistant is given for a job: instructions, skills, tools, and the rules around them.",
    more: "A named list of asset ids on a branch, with a description and a drawing; it filters what a session loads and never adds a permission.",
    prd: "§17",
  },
  "harness provider": {
    short: "The program the assistant runs in — Pi, Claude Code.",
    more: "The runtime the engine launches inside a sandbox; approved, beta or not approved per organization.",
    prd: "§9.1",
  },
  "model provider": {
    short: "Where the model itself comes from — Anthropic, a gateway your company runs.",
    more: "An endpoint per wire format, a list of models, and the credential alias it is reached with.",
    prd: "§9.2",
  },
  skill: {
    short: "A packaged way of doing one kind of task that the assistant can pick up when it fits.",
    more: "A directory the runtime discovers; loaded when the harness includes it.",
    prd: "§17.1",
  },
  memory: {
    short: "Something the assistant should always keep in mind.",
    more: "Standing context appended to the instructions file on every turn.",
    prd: "§17.1",
  },
  prompt: {
    short: "A saved instruction you can start with, chosen by name.",
    more: "A slash command; nothing reaches the model until someone picks it.",
    prd: "§17.1",
  },
  "system prompt": {
    short: "The opening brief the assistant works under.",
    more: "The preamble of the instructions file, broadest scope first.",
    prd: "§17.1",
  },
  tool: {
    short: "Something the assistant can run — a script your team wrote.",
    more: "A directory with an executable `run`, vendored dependencies, and a sidecar id; runs inside the sandbox at the agent's privilege.",
    prd: "§17.1",
  },
  connection: {
    short: "A named way to reach an outside service.",
    more: "An alias in a security group entry, bound to an upstream and a secret.",
    prd: "§6.3",
  },
  "security group": {
    short: "A named bundle of credentials that a team is given.",
    more: "Entries of alias → secret, a sources rule, and mint parameters; granted to teams and optionally narrowed to harnesses.",
    prd: "§6.3",
  },
  grant: {
    short: "A security group handed to a team, or reach handed to a team.",
    more: "A scoped instance of a group or of outside endpoints; a differently scoped grant is a different grant.",
    prd: "§6.4",
  },
  boundary: {
    short: "Something the assistant may never do, however it is running.",
    more: "A deny — endpoint, command, filesystem or capability — that compounds by union down the tree and only tightens.",
    prd: "§7",
  },
  "outside endpoints": {
    short: "Whether the assistant may reach anything beyond what it was given.",
    more: "A grant whose payload is reach; derived on the harness, never stored; boundaries still apply.",
    prd: "§8",
  },
  chain: {
    short: "The line from your organization, through your teams, to you.",
    more: "The ordered refs composed by precedence to produce your effective harness.",
    prd: "§2",
  },
  "your version": {
    short: "Your copy of a file, which is what runs for you.",
    more: "The work tree, backed by your own branch.",
    prd: "§17.2",
  },
  "team version": {
    short: "The copy everyone on the team receives.",
    more: "The team branch, moved only by promote.",
    prd: "§17.2",
  },
  differences: {
    short: "Where your copy and the team's disagree.",
    more: "A comparison of the two; the only view in which a conflict exists.",
    prd: "§17.2",
  },
  offer: {
    short: "Ask a team admin to publish your change to the whole team.",
    more: "`push` to your branch plus a request over the paths.",
    prd: "§17.4",
  },
  "keep as mine": {
    short: "Save your change to your own copy; nobody reviews it.",
    more: "A commit on your branch; it follows you between machines and shadows the team's copy for you alone.",
    prd: "§17.4",
  },
  "take the team's": {
    short: "Replace your copy of a file with the team's.",
    more: "`reset`: checks out the delivered version over yours; confirms first.",
    prd: "§17.4",
  },
  request: {
    short: "A change offered to the team, waiting on an admin.",
    more: "A pull request over a set of paths with one decision and its reason.",
    prd: "§17.3",
  },
  promote: {
    short: "Publish a change to the team so everyone receives it.",
    more: "A commit onto the team branch; the same verb whether from a request or from reading a member's branch.",
    prd: "§17.3",
  },
  "sub-team": {
    short: "A team inside a team, used to keep something from part of it.",
    more: "A branch under the parent; it starts empty and inherits, so withholding is placing a thing on a sibling.",
    prd: "§5.3",
  },
  "key vault": {
    short: "Where secrets are kept — yours, or the one we host.",
    more: "A resolver behind one interface: `probe` and `resolve`.",
    prd: "§6.1",
  },
  alias: {
    short: "The name a tool uses for a credential, so the same tool works at two teams with different vaults.",
    more: "An entry key in a security group, resolved per team.",
    prd: "§6.3",
  },
  "resolved from": {
    short: "Which source actually supplied a credential for this session.",
    more: "Recorded per slot at preflight and kept with the session; the field that makes a fallback chain reviewable.",
    prd: "§6.5",
  },
  evidence: {
    short: "How we know something is true.",
    more: "Verified, harness-reported or declared; never rounded up.",
    prd: "§6.6",
  },
  preflight: {
    short: "The checks that run before a session starts.",
    more: "Compose, choose, mint, plan, probe, report — a detector, not a fence; the broker and the proxy enforce.",
    prd: "§10.2",
  },
  session: {
    short: "One run of an assistant under a harness.",
    more: "A record of the commits it ran on, its slots, its preflight report and the endpoints it reached.",
    prd: "engine 04",
  },
  "endpoint reached": {
    short: "A host the assistant actually contacted.",
    more: "A row in the authoritative log the proxy writes; the source of the *Endpoints reached* screen.",
    prd: "§19",
  },
  attested: {
    short: "Reported from inside the assistant's sandbox; best effort.",
    more: "Telemetry the runtime's hooks wrote; labelled so, never mixed with authoritative.",
    prd: "§19",
  },
  authoritative: {
    short: "Recorded by something outside the sandbox that saw it happen.",
    more: "The proxy, the broker or the definitions service; hash-chained.",
    prd: "§19",
  },
} as const satisfies Record<string, WordEntry>;

/** `WordId` is the union of keys in 05 §5, derived from `WORDS` itself so a
 *  new word cannot be referenced before it is defined. */
export type WordId = keyof typeof WORDS;
