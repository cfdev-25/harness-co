import { g } from "../git.js";
import { say } from "../output.js";

/**
 * §11.6. Commits touching `<key>` on the person's branch (`main`), or on the
 * team's with `--team`. `--git` prints `git log --oneline`.
 */
export async function log(key: string | undefined, team: boolean, git: boolean): Promise<number> {
	const ref = team ? "refs/remotes/origin/org" : "refs/heads/main";
	const path = key === undefined ? [] : ["--", `assets/${key}`];
	const format = git ? "--oneline" : "--format=%s%n  %h  %an, %ar";
	say(await g("log", format, ref, ...path).catch(() => "Nothing has been committed on this branch yet."));
	return 0;
}
