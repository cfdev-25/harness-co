import type { Credentials } from "../credentials.js";
import type { Me } from "../boot.js";
import { api } from "../api.js";
import { readSelection } from "../selection.js";
import { refuse, say } from "../output.js";
import { keyFor, pushKey } from "./push.js";

/**
 * §11.8 (D108). `push`, then open a request the team's admins decide. The CLI
 * opens the promotion kind and nothing else; it never decides one.
 */
export async function offer(credentials: Credentials, me: Me, paths: string[], message: string, title?: string): Promise<number> {
	const keys = paths.map(keyFor);
	let commit = "";
	for (const key of keys) commit = await pushKey(credentials, me, key, message);
	const selection = await readSelection();
	let created: { id: string };
	try {
		created = await api<{ id: string }>(credentials, "/v1/requests", {
			method: "POST",
			body: JSON.stringify({
				title: title ?? message,
				reasoning: message,
				subject: { kind: "promotion", paths: keys, commit, ...(selection?.harness_id === undefined ? {} : { harness: selection.harness_id }) },
			}),
		});
	} catch (thrown) {
		refuse("cli.offer_refused", `The team declined to receive this: ${(thrown as Error).message}`, "—");
	}
	const team = me.role.at ?? "your team";
	say(`Offered \`${keys.join("`, `")}\` to ${team} · request \`${created.id}\` — \`harness withdraw ${created.id}\` to take it back.`);
	return 0;
}

/** §11.9. Author only, open requests only. */
export async function withdraw(credentials: Credentials, id: string): Promise<number> {
	try {
		await api(credentials, `/v1/requests/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
	} catch {
		refuse("cli.withdraw_refused", "That request is not yours to withdraw, or is already closed.", "—");
	}
	say("Withdrawn.");
	return 0;
}
