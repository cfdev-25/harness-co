/**
 * Requests panel and Request — console 04 §7.
 *
 * The panel has two distinct empty states by filter (open vs closed; 04 §7),
 * but one screen module names one `empty` key (05 §3) — `requests.closed`
 * here; the open-filter empty state is `content/empty.ts`'s `harness.
 * requests` (05 §8 places that sentence under the Harness row, since the
 * panel lives at `?view=requests` on the harness route), read directly by
 * the panel when `state=open`.
 */
import type { ScreenContent } from "../types";

export type RequestsColumn = "title" | "author" | "files" | "when" | "outcome";
export type RequestsVerb = "acceptAll" | "decline" | "comment" | "withdraw";

export const REQUESTS: ScreenContent<RequestsColumn, RequestsVerb, "requests.closed"> = {
  title: "Requests",
  lede: "A request offers a change to the team; a team admin accepts, declines or leaves it waiting.",
  columns: {
    title: { heading: "Title", help: "What the change is called." },
    author: { heading: "Author", help: "Who offered the change." },
    files: { heading: "Files", help: "How many files the request touches." },
    when: { heading: "When", help: "When the request was opened." },
    outcome: {
      heading: "Outcome",
      help: "Accepted, declined or withdrawn, shown only once the request is closed.",
    },
  },
  verbs: {
    acceptAll: { label: "Accept all", explain: "Publishes every file in this request to everyone on the team." },
    decline: { label: "Decline", explain: "Closes the request without publishing it, with a reason." },
    comment: { label: "Comment", explain: "Adds a message to the request's discussion." },
    withdraw: { label: "Withdraw", explain: "Closes a request you opened, without it being decided." },
  },
  empty: "requests.closed",
};

/** 05 R8's strings for the panel and the request page. `{team}` and `{n}` are
 *  filled by `lib/views/requests.ts`, never assembled in a component. */
export const REQUESTS_WORDS = {
  filterLabel: "Which requests",
  states: { open: "Open", closed: "Closed" },
  outcomes: { accepted: "accepted", declined: "declined", withdrawn: "withdrawn" },
  files: "files",
  file: "file",
  roleAsk: "asked to be a {team} admin",
  discussion: "Discussion",
  noDiscussion: "Nothing has been said yet.",
  commentLabel: "Add to the discussion",
  commentSubmit: "Comment",
  decision: "Decision",
  decisionBy: "Decided by {who}",
  acceptLabel: "Accept all {n}",
  acceptTitle: "Accept this request",
  acceptTakes: "Publishes {n} files to everyone on {team}.",
  acceptConfirm: "Accept",
  declineLabel: "Decline",
  declineTitle: "Decline this request",
  declineReason: "Why you are declining",
  declineTakes: "Closes the request without publishing it. The reason is kept with it.",
  declineConfirm: "Decline",
  withdrawLabel: "Withdraw",
  withdrawTitle: "Withdraw this request",
  withdrawTakes: "Closes the request you opened. Nothing is published.",
  withdrawConfirm: "Withdraw",
  cancel: "Cancel",
  // 04 §7's refusal, verbatim, with the team named at render (05 §7 R10).
  refusal: "Accepting a request publishes it to everyone on {team}, so a team admin decides it.",
  stale: "the team's copy has since changed",
  proposed: "proposed",
  reasoning: "Why",
} as const;
