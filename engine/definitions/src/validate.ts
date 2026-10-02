import { compose } from "@harness/compose";
import type { Chain, ChainNode, Composed, Conflict } from "@harness/compose/contracts";
import { Refusal } from "./codes.js";
import { git, gitOut } from "./git.js";
import { EMPTY_TREE, reader } from "./reader.js";
import { ZERO, chainOf, nodes, sizeBytes } from "./repos.js";

export interface Update {
	ref: string;
	old: string;
	new: string;
}

export interface Context {
	repo: string;
	org: string;
	actor: string;
	/** An internal commit may touch any ref: `api` checked the actor's right (§7 step 1). */
	internal: boolean;
	/** `/internal/branches` is the only caller that may create a ref (§7 step 2). */
	creating: boolean;
	/** receive-pack's quarantine while a push is being validated (§6.3). */
	env: Record<string, string>;
	quota: number;
}

/** §7 step 8, owned here. A group's entries hold a SecretRef, never a value. */
const SECRETS = [
	/secret:\/\/[a-z0-9./-]+/,
	/AKIA[0-9A-Z]{16}/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/sk-[A-Za-z0-9]{20,}/,
	/ghp_[A-Za-z0-9]{36}/,
	/xox[bp]-/,
];

/** §7 step 10: only the org branch may hold these. */
const ORG_ONLY = [
	"policy/kinds.json",
	"policy/groups.json",
	"policy/harness-providers.json",
	"policy/model-providers.json",
	"policy/routing.json",
	"policy/always-loaded.json",
];

/**
 * 02 §7. Steps 3–7, 9 and 11–14 are `compose()` over the pushed chain and the
 * §7.1 mapping below — there is no second implementation of a content rule
 * here (test `validate_is_compose`). Steps 1, 2, 8, 10 and 15 are transport
 * rules compose() does not know about and are checked directly.
 */
export async function validate(context: Context, update: Update): Promise<void> {
	// Step 1. Ref ownership.
	if (!context.internal && update.ref !== `refs/heads/users/${context.actor}`)
		throw new Refusal("definitions.not_your_ref", 403);

	// Step 2. Fast-forward.
	if (update.old === ZERO) {
		if (!context.creating) throw new Refusal("definitions.not_fast_forward", 409);
		// A branch is created as an orphan empty tree (D43): there is nothing to read.
		return;
	}
	if ((await git(context.repo, ["merge-base", "--is-ancestor", update.old, update.new], { env: context.env })).code !== 0)
		throw new Refusal("definitions.not_fast_forward", 409);

	const paths = (await gitOut(context.repo, ["ls-tree", "-r", "--name-only", update.new], { env: context.env }))
		.split("\n")
		.filter(Boolean);

	// Step 10. Branch kind rules. A path that is neither policy nor an asset is
	// left to compose(): it resolves to nothing and refusing it would invent a rule.
	if (update.ref.startsWith("refs/heads/users/") && paths.some((path) => path.startsWith("policy/")))
		throw new Refusal("definitions.policy_on_user_branch", 403);
	if (update.ref.startsWith("refs/heads/teams/"))
		for (const path of paths)
			if (ORG_ONLY.includes(path))
				throw new Refusal("definitions.policy_invalid", 403, path, "this file belongs to the organization branch");

	// Step 8. No secrets — over what this push adds or changes. What was already
	// on the branch passed this rule when it landed.
	await refuseSecrets(context, update);

	// Step 15. Quota.
	if ((await sizeBytes(context.repo, context.env)) > context.quota)
		throw new Refusal("definitions.quota", 413, (context.quota / 1024 ** 3).toFixed(0));

	// Steps 3–7, 9, 11–14.
	const read = reader(context.repo, context.env);
	try {
		const { chain, node } = await pushedChain(context, update);
		const composed = await compose(chain, read);
		for (const conflict of composed.conflicts)
			if (blames(conflict).includes(node.ref)) throw refusalFor(conflict, composed, node);
	} finally {
		read.close();
	}
}

async function refuseSecrets(context: Context, update: Update): Promise<void> {
	const raw = await gitOut(
		context.repo,
		["diff-tree", "-r", "--raw", "--no-commit-id", "--diff-filter=AM", update.old, update.new],
		{ env: context.env },
	);
	const read = reader(context.repo, context.env);
	try {
		for (const line of raw.split("\n").filter(Boolean)) {
			const [meta, path] = line.split("\t");
			const oid = meta.split(" ")[3];
			const text = Buffer.from(await read.cat(oid)).toString("utf8");
			// 02 §7 step 8: the scan is for secrets pasted into assets; policy/groups.json holds SecretRefs by design.
			if (path.startsWith("assets/") && SECRETS.some((pattern) => pattern.test(text))) throw new Refusal("definitions.secret_in_tree", 400, path);
		}
	} finally {
		read.close();
	}
}

/**
 * 02 §7: one chain ending at the pushed node suffices. 01 §6 step 1 requires a
 * user-terminated chain, so a push to org or to a team is terminated by a node
 * at the empty tree: it contributes no asset and no policy, and so can neither
 * add a conflict nor hide one.
 */
async function pushedChain(context: Context, update: Update): Promise<{ chain: Chain; node: ChainNode }> {
	const all = await nodes(context.repo, context.org);
	const pushed = all.find((node) => node.ref === update.ref);
	if (!pushed) throw new Error(`${update.ref} has no node: every ref is created by /internal/branches`);
	const chain = await chainOf(context.repo, all, pushed, { ref: update.ref, commit: update.new });
	const node = chain[chain.length - 1];
	if (node.kind !== "user")
		chain.push({ kind: "user", path: `${node.path}.${context.actor}`, ref: `refs/heads/users/${context.actor}`, commit: EMPTY_TREE });
	return { chain, node };
}

/** A `same-path-different-id` names two nodes and no single `from`; the push is
    refused if either of them is the pushed node (§7 step 9). */
const blames = (conflict: Conflict): string[] =>
	conflict.kind === "same-path-different-id" ? [conflict.a.from.ref, conflict.b.from.ref] : [conflict.from.ref];

/** 02 §7.1, the whole table. */
function refusalFor(conflict: Conflict, composed: Composed, node: ChainNode): Refusal {
	switch (conflict.kind) {
		case "same-path-different-id":
			return new Refusal(
				"definitions.id_conflict",
				409,
				conflict.path,
				(conflict.a.from.ref === node.ref ? conflict.b : conflict.a).from.path,
			);
		case "duplicate-id-on-one-branch":
			return new Refusal("definitions.duplicate_id", 409, conflict.id, conflict.paths[0], conflict.paths[1] ?? conflict.paths[0]);
		case "unknown-kind":
			return new Refusal("definitions.unknown_kind", 400, conflict.assetKind, composed.policy.kinds.join(", "));
		case "malformed":
			return conflict.path.startsWith("policy/") || conflict.path.startsWith("harnesses/")
				? new Refusal("definitions.policy_invalid", 400, conflict.path, conflict.why)
				: /missing|absent|no asset\.json/i.test(conflict.why)
					? new Refusal("definitions.sidecar_missing", 400, conflict.path)
					: new Refusal("definitions.sidecar_invalid", 400, conflict.path, conflict.why);
		case "reach-widened":
			return new Refusal("definitions.reach_widens", 403, conflict.at, conflict.why);
		case "reach-grant-retired":
			return new Refusal("definitions.reach_grant_retired", 403, conflict.grant);
		case "invalid-grant":
			// §7.1 splits `invalid-grant` "by why", and `why` is prose: this keys on
			// 01 §6 step 9 clause (c), the only clause about the subtree. A clause
			// letter on the `Conflict` would make this a lookup instead.
			return /not inside|never every team/.test(conflict.why)
				? new Refusal("definitions.grant_outside_subtree", 403, conflict.grant, conflict.why)
				: new Refusal("definitions.grant_widens", 403, conflict.grant, conflict.why);
	}
}
