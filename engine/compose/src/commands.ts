/**
 * D153 — one matcher for a boundary of kind `command`, shared by the Pi
 * harness extension (which refuses a `bash` call with it), the Claude adapter
 * (which turns the pattern into a `permissions.deny` rule) and the console's
 * add form (which validates the shape with it).
 *
 * The rule is not invented here. It is what Claude Code 2.1.286 was **measured**
 * to do (07 §8's table, 1 Oct 2026):
 *
 * 1. the command line is split into subcommands at `|`, `&&` and `;`, and each
 *    one is matched on its own (`Bash(cat*)` refuses `echo hello | cat`);
 * 2. inside a subcommand the pattern is a **glob** — `*` matches any run of
 *    characters, spaces included, in any position, so `git push * --force*`
 *    refuses `git push origin main --force`;
 * 3. a pattern with no `*` matches the whole subcommand exactly, so
 *    `git push --force` lets `git push --force --tags` through;
 * 4. and therefore a pattern that itself holds a shell operator can never
 *    match a subcommand, because no subcommand holds one.
 *
 * Rule 4 is the one place the two runtimes part. A pattern like `curl * | sh`
 * says something real — *do not pipe a download into a shell* — and Claude
 * cannot say it at all. Rather than drop the shape, such a pattern is read
 * against the **whole line**, which is what Pi's extension sees, and
 * `claudeHolds` returns false for it so the console row reads *intercepted by
 * Pi*, the Claude adapter writes no rule for it, and nothing claims a refusal
 * that was never measured. For every pattern `claudeHolds` accepts, this
 * module and Claude's own matcher are the same function on the same input,
 * which is the only way a boundary can mean one thing in two runtimes.
 *
 * **There is one rule and it is a regular expression.** `commandRuleSource`
 * compiles a pattern once; `commandMatches` is that regular expression, and
 * the Pi adapter writes the same source into `policy.json` so the extension —
 * which is in the vendored Pi tree and cannot import this package — applies
 * the rule rather than holding a second copy of it (07 §7).
 *
 * Quoting is not parsed: a `;` inside a quoted string is read as a split here
 * and the boundary is tried against more subcommands than the shell will run.
 * That is the safe direction — it can only refuse more — and interception is
 * advisory anyway: the control is the geometry (06).
 */

/** The characters a shell command line is cut at, and that therefore can never
    appear inside one subcommand. One class, used by both arms of the rule. */
const OPERATOR = "|;&\\n";
const HAS_OPERATOR = new RegExp(`[${OPERATOR}]`);

/** Can Claude Code's `permissions.deny` hold this pattern? Rule 4 above: a
    pattern with a shell operator in it matches no subcommand, so writing
    `Bash(<pattern>)` would be a claim that nothing backs. */
export function claudeHolds(pattern: string): boolean {
	return !HAS_OPERATOR.test(pattern.trim());
}

const quote = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The pattern as one regular expression over the **whole** command line, so
 * that applying the rule is `new RegExp(source).test(line.trim())` and nothing
 * more — the form `policy.json` carries to the extension.
 *
 * An operator-free pattern becomes *some subcommand is this*: the glob with
 * `*` reading as any run of characters that is not an operator, fenced by the
 * start of the line or an operator on each side. A pattern that holds an
 * operator becomes the anchored whole line, because no subcommand could hold
 * one; only Pi applies those.
 */
export function commandRuleSource(pattern: string): string {
	const one = pattern.trim();
	if (!claudeHolds(one)) return `^${one.split("*").map(quote).join("[\\s\\S]*")}$`;
	const body = one.split("*").map(quote).join(`[^${OPERATOR}]*`);
	return `(?:^|[${OPERATOR}])[ \\t]*${body}[ \\t]*(?:$|[${OPERATOR}])`;
}

/**
 * Does this command boundary's pattern hold against this command line? The
 * compiled rule and nothing else, so the console, the two adapters and the
 * extension cannot drift apart.
 */
export function commandMatches(pattern: string, commandLine: string): boolean {
	if (pattern.trim() === "") return false;
	return new RegExp(commandRuleSource(pattern)).test(commandLine.trim());
}

/**
 * The console's add form, and `api`'s own validator, ask the same question of
 * a typed pattern: is this a shape that can hold anything? One sentence back,
 * or `null`. Not a taste test — a pattern of `*` alone denies every command
 * there is, which is a boundary nobody meant to write.
 */
export function commandPatternProblem(pattern: string): string | null {
	const one = pattern.trim();
	if (one === "") return "A command boundary needs a pattern — the command line it holds against.";
	if (one.replace(/[*\s]/g, "") === "")
		return "A pattern of only * denies every command there is. Name the command you mean.";
	return null;
}

/** Which runtimes intercept this pattern, for the row that says so. Pi applies
    every pattern this module accepts; Claude Code only the operator-free ones. */
export function interceptedBy(pattern: string): Array<"Pi" | "Claude Code"> {
	return claudeHolds(pattern) ? ["Pi", "Claude Code"] : ["Pi"];
}
