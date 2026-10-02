import { authList, authLogin, authLogout } from "../auth.js";
import { refuse, say } from "../output.js";

/**
 * §11.15. The provider's own login, **outside the jail** (07 §11, C22): a
 * browser callback and a credential store that survives the process are both
 * things the sandbox exists to deny a session, and this is not one.
 */
export async function auth(argv: { list?: boolean; logout?: string; provider?: string }): Promise<number> {
	if (argv.list === true) {
		for (const { agentId, loggedIn } of await authList()) say(`${agentId.padEnd(8)}${loggedIn ? "signed in" : "not signed in"}`);
		return 0;
	}
	if (argv.logout !== undefined) {
		await authLogout(argv.logout);
		return 0;
	}
	if (argv.provider === undefined) refuse("cli.provider_ambiguous", "Say which provider: pi, claude.", "—");
	await authLogin(argv.provider);
	say(`Signed in to ${argv.provider}. \`harness run ${argv.provider}\` will use it when your organization's policy allows it.`);
	return 0;
}
