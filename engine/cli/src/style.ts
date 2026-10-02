const ESC = "[";

// Colour is decoration, so it disappears whenever it might corrupt output:
// a pipe, a dumb terminal, NO_COLOR, or CI.
const enabled =
	process.stdout.isTTY === true &&
	!process.env.NO_COLOR &&
	process.env.TERM !== "dumb" &&
	process.env.CI === undefined;

const wrap = (code: string) => (text: string) => (enabled ? `${ESC}${code}m${text}${ESC}0m` : text);

export const bold = wrap("1");
export const dim = wrap("2");
export const accent = wrap("38;5;173"); // the brand's muted amber
export const good = wrap("32");
export const warn = wrap("33");
export const bad = wrap("31");

/** A section heading, with its aside kept quiet. */
export function heading(title: string, aside?: string): string {
	return `\n${bold(accent(title))}${aside ? dim(`  ${aside}`) : ""}`;
}

/** A label/value row. The label width is fixed so values line up everywhere. */
export function row(label: string, value: string, note?: string): string {
	return `  ${dim(label.padEnd(26))} ${value}${note ? ` ${dim(note)}` : ""}`;
}

export const absent = (text: string) => dim(`(${text})`);

export type ColorMode = "truecolor" | "256" | "mono";

/**
 * What the terminal can be trusted with. `mono` whenever colour is already
 * off for the reasons above, so a drawing piped to a file keeps its shape
 * and loses its escapes.
 */
export function colorMode(): ColorMode {
	if (!enabled) return "mono";
	const declared = process.env.COLORTERM;
	return declared === "truecolor" || declared === "24bit" ? "truecolor" : "256";
}
