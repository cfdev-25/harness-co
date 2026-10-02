/**
 * Every failure code in 02 §10, with its message, in one place — 02 §16 asks
 * that a code appear exactly once in the code base, so nothing below is
 * repeated as a string literal anywhere else.
 *
 * A `Refusal` is 00 §4.7's `Blocker` on the wire: `code` and `message` reach
 * the person either as a `remote:` line from a hook or as a JSON body from
 * `/internal`. 10 rule 12 — anything a person can act on is one of these;
 * anything else throws and crashes.
 */
export class Refusal extends Error {
	code: string;
	status: number;
	constructor(code: string, status: number, ...parts: string[]) {
		super((messages[code] ?? (() => code))(...parts));
		this.code = code;
		this.status = status;
	}
}

/** Named parameters keep each sentence readable; the cast keeps the table one literal. */
export const messages = {
	"definitions.unauthenticated": () => "Sign in first: harness login.",
	"definitions.api_unreachable": () =>
		"The Harness API did not answer, so your identity could not be checked. Try again in a moment.",
	"definitions.not_your_ref": () =>
		"You can only push to your own version. Offering a change to the team is `harness offer`; promoting one is done in the console.",
	"definitions.not_fast_forward": () =>
		"Your version's history has diverged from what the server holds. Run `harness pull` and try again.",
	"definitions.sidecar_missing": (path: string) => `${path} has no asset.json. \`harness adopt ${path}\` creates one.`,
	"definitions.sidecar_invalid": (path: string, reason: string) => `${path}/asset.json: ${reason}.`,
	"definitions.unknown_kind": (kind: string, kinds: string) =>
		`"${kind}" is not a kind this organisation uses. Kinds: ${kinds}.`,
	"definitions.duplicate_id": (id: string, a: string, b: string) =>
		`Two directories carry the same id ${id}: ${a} and ${b}. One of them needs a new one — \`harness adopt --new-id ${a}\`.`,
	"definitions.secret_in_tree": (path: string) =>
		`${path} looks like it contains a secret. Definitions never hold secret values; put it in a key vault and reference it from a security group.`,
	"definitions.id_conflict": (path: string, node: string) =>
		`${path} already exists on ${node} with a different id. To override the team's, keep its id (\`harness reset ${path}\` then edit); to add a new thing, give it a new name.`,
	"definitions.policy_on_user_branch": () =>
		"Policy files belong to teams and the organisation, not to a personal version.",
	// The path already carries its `policy/` or `harnesses/` prefix, so the
	// rendered sentence is §10's `policy/<file>: <field> <reason>.` verbatim.
	"definitions.policy_invalid": (path: string, reason: string) => `${path}: ${reason}.`,
	// §10 words these two with fields `Conflict.invalid-grant` does not carry
	// (sub-team, alias, team, scope); `why` is 01 §6 step 9's clause and is what
	// compose() knows. The remedy sentence is verbatim.
	"definitions.grant_widens": (grant: string, why: string) =>
		`The grant "${grant}" would give more than the grant it narrows: ${why}. A narrowed grant can only remove entries.`,
	"definitions.grant_outside_subtree": (grant: string, why: string) =>
		`"${grant}" is not inside this team: ${why}. A team admin may only grant or bound within their own team.`,
	// D131 and D132: reach is `policy/reach.json`, it only narrows, and the
	// grant that used to carry it is gone. Both are refused at the push rather
	// than left to fail every session with a compose blocker.
	"definitions.reach_widens": (at: string, why: string) =>
		`The reach at ${at} would give more than it inherits: ${why}. Reach only ever narrows on the way down.`,
	"definitions.reach_grant_retired": (grant: string) =>
		`The grant "${grant}" gives outside endpoints, which is no longer how reach is set. Remove it and set reach on Boundaries → Reach; it writes policy/reach.json.`,
	"definitions.quota": (gib: string) =>
		`This organisation's definitions exceed ${gib} GiB. Remove large files, or ask us to raise the limit.`,
	"definitions.head_moved": () => "The branch moved while this change waited.",
	"definitions.index_failed": () =>
		"remote: index failed; an operator has been paged. Your push is saved; the console will catch up.",
	// 02 §12 names `definitions.busy` under Locks but gives no sentence; this is
	// the one it needs, and belongs in §10's table.
	"definitions.busy": () => "Another change to this organisation is being saved. Try again in a moment.",
} as Record<string, (...parts: string[]) => string>;
