import { Tab } from "@/lib/types";

/* What the (?) button opens, and the source these docs grow from.

   Three parts, because they answer three different questions and readers
   arrive with one of them: what is this thing, what would I use it for, and
   what does the platform do with it. Keep them separate — the first two are
   about the reader's work, the third is about our machinery, and mixing them
   is what made the earlier copy unreadable.

   Written for someone who runs a team, not someone who runs a terminal. No
   file formats, no field names, nothing that needs a second document to
   understand. Every claim here is true of the code today; when it stops being
   true, this file is the thing to fix. */
export interface Help {
  /** One line. If a reader takes away nothing else, this is it. */
  summary: string;
  /** What the thing is, in the reader's terms. Never the mechanism. */
  what: string;
  /** One concrete situation, so the definition has something to hang on. */
  example: string;
  /** How the platform handles it: versions, scope, limits, who may change it. */
  mechanics: string[];
}

/* True of all six asset kinds, and worth repeating on each: a reader opens
   one tab, not all of them. */
const ASSET_MECHANICS = [
  "Every save is a version. You can read any of them, compare an old one against what is live, and put it back. The live version is the one in use — if your team requires review, a new version waits until someone approves it.",
  "Scope follows the org chart. What the organisation publishes reaches every team; what a team publishes reaches its people; and anyone may keep their own copy of a name, which wins for them alone. Manage shows where a name is coming from and whether someone's copy has fallen behind the one it came from.",
  "Disable switches something off without deleting it. Nothing resolves it any more, the history stays untouched, and enabling puts it straight back.",
];

export const HELP: Record<Tab, Help> = {
  system_prompt: {
    summary: "How the assistant should behave, always.",
    what: "The standing brief: tone, what to do first, what never to do. It is the day-one conversation you would have with a new colleague about how this team works. Nobody types it and nobody can skip it — it is in front of the assistant for every message, before anything else it is given.",
    example:
      "A support team's system prompt: answer in three short sentences, always quote the order number back, never promise a delivery date you cannot see in the system, and hand anything above £200 to a person. Every reply from everyone on that team now starts from those four rules.",
    mechanics: [
      "This is the system prompt in the technical sense: it is sent with every single message of a conversation, not just the first one.",
      "The organisation's comes first, then the team's, then a person's own — so a narrower one adds to the broader one rather than replacing it.",
      "Memories sit in the same place, just after. The split is behaviour here, facts there. If you are writing a rule, it belongs here.",
      "Keep it short for the same reason you would keep a briefing short. Everything here is paid for on every message.",
      ...ASSET_MECHANICS,
    ],
  },

  prompt: {
    summary: "A saved piece of writing you call up instead of retyping it.",
    what: "The paragraph you find yourself typing every week. Save it once, give it a name, and from then on it is one word. Nothing here reaches the assistant until somebody asks for it by name — a saved prompt is a shortcut for the person, not a rule for the assistant.",
    example:
      "“Draft the weekly update” saved as weekly-update: the structure you always use, the sections in the order your director reads them, the tone. On Friday you type /weekly-update instead of three sentences of setup, and everyone's update comes out in the same shape.",
    mechanics: [
      "A saved prompt appears in the assistant as /name. Type the slash and the names are listed.",
      "It can take arguments, so /review-ticket 4182 fills the number into the text you saved.",
      "Nothing is sent until someone picks it, so a saved prompt costs nothing when it is not being used — unlike a system prompt or a memory, which are paid for on every message.",
      "Only the ones published here are available. Saved prompts sitting on someone's own machine are not loaded, so what a team has is what a team agreed on.",
      ...ASSET_MECHANICS,
    ],
  },

  memory: {
    summary: "What the assistant should know, always.",
    what: "The facts your team keeps having to repeat: who owns what, the escalation ladder, the approved wording for a policy, what your products are actually called. A memory is always to hand, so the assistant never has to guess and nobody has to paste it into the conversation again.",
    example:
      "An escalation ladder memory lists who to page for a severe incident at two in the morning, in order, with each name's pager. Someone asks the question at two in the morning and the answer is right, without anyone hunting for the rota.",
    mechanics: [
      "A memory is in every conversation, so it is worth keeping short. Anything long, or only needed occasionally, does more good as a skill.",
      "Memories and system prompts are delivered the same way and stack the same way: the organisation's, then the team's, then a person's own. Behaviour belongs in a system prompt; a fact belongs here.",
      ...ASSET_MECHANICS,
    ],
  },

  skill: {
    summary: "A method the assistant picks up when the job calls for it.",
    what: "A written method for one kind of work: the steps, the things to watch for, and what a good result looks like. Unlike a system prompt or a memory, a skill is not in front of the assistant the whole time — it sits on the shelf until the work matches it. That is what lets you keep fifty of them without slowing every conversation down.",
    example:
      "A refund check skill sets out how your team handles a refund: confirm the order is inside the window, check whether it shipped, work out the amount, and stop short of promising a date. Nobody has to remember all four steps, and every refund is handled the same way — including by the person who joined last week.",
    mechanics: [
      "The assistant is told each skill's name and a one-line summary up front, and reads the whole thing only when the task matches. That is why skills are cheap to keep and memories are not.",
      "A skill is picked up by the assistant when the work fits. A saved prompt is picked by you, by name. That is the whole difference between the two.",
      "A skill can carry more than instructions. Anything in its folder — a checklist, a template, an example of the finished thing — comes with it.",
      ...ASSET_MECHANICS,
    ],
  },

  tool: {
    summary: "Something the assistant can actually run.",
    what: "Every other kind here is words. A tool does something: pulls a report, files a ticket, exports a file. It is the only kind with effects outside the conversation, which is why a tool has to be approved for a session before it can be used at all.",
    example:
      "An overdue invoices tool runs the query and hands back the list. “Which invoices are overdue, and who owns them?” becomes one question, instead of a request to the data team and a two-day wait.",
    mechanics: [
      "Publishing a tool adds it to what a session is allowed to run. A request to run anything not on that list is refused.",
      "Whoever writes the tool decides what it does; the platform decides who may run it. Read one before you publish it to a team, the same as you would any other code.",
      ...ASSET_MECHANICS,
    ],
  },

  connection: {
    summary: "Which AI model or service the work runs on.",
    what: "The wiring. A connection says which model or service to use, where to reach it, and which stored secret unlocks it. It holds a pointer to the secret, never the secret itself — which is what lets a connection be read, reviewed, versioned and shared while the key stays hidden.",
    example:
      "The connection named model-default decides which model the whole team talks to. Moving everyone onto a newer model is one change here: nobody touches a key, nothing else is edited, and the change appears in the audit trail like any other.",
    mechanics: [
      "A connection refers to a connector by name. Publishing one is refused if it names a connector this org unit is not allowed to see.",
      "The connection called model-default is the one sessions use for their model. Others describe services the work may reach.",
      "This is the companion to the Connectors tab: the connection is the shareable half, the connector is the secret half.",
      ...ASSET_MECHANICS,
    ],
  },

  keys: {
    summary: "The secrets, kept apart from everything else.",
    what: "The keys and passwords your work needs to reach outside services. They are deliberately kept out of every document: a connection or a skill may point at a connector by name, but nothing can read its value except the platform, which puts it in front of a running session and nowhere else.",
    example:
      "A connector called “Anthropic production” holds the key for your model provider. Six months later you rotate it: paste the new value, and everything pointing at it keeps working. No document changes, and nobody reads the key — including you, after you save it.",
    mechanics: [
      "The value is encrypted as you save it and never shown again. Only the last four characters are, so you can tell two apart.",
      "Rotating stores a new value under the same reference, so nothing that points at it has to be edited. The previous value stays usable for a short grace period, so work already running does not break.",
      "Each connector is injected into the session as an environment variable — the name you give it in the Environment variable column — and is visible to nothing else.",
    ],
  },

  boundary: {
    summary: "The limits everyone inside this unit works within.",
    what: "Where work may connect, what it may spend, and whether changes need review. Set them on the organisation and they hold for every team inside it. A team may make its own limits stricter; it can never loosen what it was given.",
    example:
      "The organisation allows two outside destinations and caps spend at $2,500 a month. A team that handles customer records removes one of those destinations for itself. That team now reaches one destination and cannot add a third — not even its own admin — and neither can anyone below it.",
    mechanics: [
      "Every unit's limits are merged down the chain. Lists are narrowed to what both allow, and the lowest budget anywhere above you is the one that applies.",
      "“Set here” marks a limit this unit writes itself. Everything else arrived from a unit above it.",
      "A list that nothing in the chain constrains allows everything. An empty list allows nothing. That difference is deliberate, not a blank.",
      "Changing limits is not done here yet — this page shows you where they land.",
    ],
  },

  invites: {
    summary: "How someone joins a team.",
    what: "You invite an email address. The first time that person signs in they get their own space inside the team, and everything the team publishes arrives with them.",
    example:
      "An analyst joins on Monday. By the time they open the assistant they already have the team's brief, its reference material and its methods — and anything they write for themselves stays theirs until they choose to share it upward.",
    mechanics: [
      "Invites belong to a team, so pick a team in the tree on the left to send one.",
      "Team admin lets that person manage this team and everything under it. You can never grant a role above the one you hold.",
      "An invite can be withdrawn at any point before it is accepted.",
    ],
  },

  audit: {
    summary: "The record of what happened.",
    what: "Who changed what, when, and what each session was given. It is the answer to “why did it start doing that?” and to “who approved this?” — without either question turning into an investigation.",
    example:
      "The assistant starts refusing something it used to handle. The audit shows a prompt went live at 9:04 that morning, who published it, and which version it replaced — so you can read the difference and put the old one back if it was a mistake.",
    mechanics: [
      "The 50 most recent events for this unit, newest first.",
      "Each entry is sealed against the one before it, so an entry that was removed or altered afterwards can be detected.",
      "Authoritative entries are the platform's own record of something it did. Attested entries are reported by a machine running the assistant: the platform records them faithfully, but it is repeating what it was told.",
    ],
  },
};
