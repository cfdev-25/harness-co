import { fill } from "./refusals";
import type { DiffHunk, Viewer } from "./types";

/**
 * The request primitive's view models (console 00 §4.4, PRD §13, 04 D43) and
 * the pure functions the panel and the request page render with. `verbs` is
 * the server's (K8); nothing here computes a permission from a role name.
 */

export type RequestVerb = "accept" | "decline" | "withdraw" | "comment";

export type RequestSubject =
  | { kind: "promotion"; paths: string[]; commit: string }
  | { kind: "role"; level: "team-admin"; team: string };

export interface RequestFile {
  assetId: string;
  path: string;
  added: number;
  removed: number;
  stale: boolean;
  diff: DiffHunk[];
}

export interface RequestView {
  id: string;
  harness: { id: string; name: string } | null;
  team: { path: string; name: string };
  subject: RequestSubject;
  title: string;
  reasoning: string;
  author: { id: string; name: string };
  at: string;
  state: "open" | "closed";
  outcome?: { decision: "accepted" | "declined" | "withdrawn"; by: string; at: string; reason: string } | null;
  files: RequestFile[];
  discussion: Array<{ id: string; who: string; at: string; text: string }>;
  verbs: RequestVerb[];
}

export type RequestState = "open" | "closed";

export function readState(raw: string | undefined): RequestState {
  return raw === "closed" ? "closed" : "open";
}

export function has(request: RequestView, verb: RequestVerb): boolean {
  return request.verbs.includes(verb);
}

/**
 * 04 §7: a member sees `PermissionNotCleared` where Accept and Decline would
 * be. The server decides by sending no `accept` verb; the console only asks
 * whether the space needs filling, and never renders a disabled button (P13).
 */
export function refusesDecision(request: RequestView): boolean {
  return request.state === "open" && !has(request, "accept") && !has(request, "decline");
}

/**
 * The refusal names the team the acceptance would publish to, so it cannot be
 * a fixed string (05 §7 R10). There is exactly one substitution step in the
 * console and it lives in `lib/views/refusals.ts`; this re-export is here so
 * the screens that already import it from this module keep working.
 */
export { fill };

/** 04 §7: the panel's row reads `<author> · <n> files`, and a role request
 *  has no files at all (D43), so it reads what it asked for instead. */
export function rowNote(
  request: RequestView,
  words: { files: string; file: string; roleAsk: string },
): string {
  if (request.subject.kind === "role") {
    return `${request.author.name} · ${fill(words.roleAsk, { team: request.team.name })}`;
  }
  const count = request.files.length;
  return `${request.author.name} · ${count} ${count === 1 ? words.file : words.files}`;
}

/** Closed rows carry the outcome word in the same line, never a badge. */
export function outcomeNote(request: RequestView, words: Record<string, string>): string | null {
  if (request.state !== "closed" || !request.outcome) return null;
  return words[request.outcome.decision] ?? request.outcome.decision;
}

export function totals(request: RequestView): { added: number; removed: number } {
  return request.files.reduce(
    (sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }),
    { added: 0, removed: 0 },
  );
}

/** PRD §17.3: a file whose team copy moved under the offer is stale. */
export function staleFiles(request: RequestView): RequestFile[] {
  return request.files.filter((file) => file.stale);
}

/** 07 §3: a personal account has no team to offer to, so no request screen. */
export function requestsHaveMeaning(viewer: Viewer): boolean {
  return viewer.edition !== "personal";
}

/** 04 §7's confirm names the team: *Publishes n files to everyone on <team>*. */
export function acceptTakes(request: RequestView, sentence: string): string {
  return fill(sentence, { n: String(request.files.length), team: request.team.name });
}
