import { accent, dim } from "./style.js";

/**
 * 08 §10.0 — the two controls the CLI has, and the one line it asks for.
 *
 * `select` is a cursor over a few choices; `checklist` the same cursor with
 * a tick on each row; `line` a plain question. Arrows or `j`/`k` move, space
 * ticks, enter chooses, escape or `q` answers nothing. They draw with the
 * landing's idiom (`▶` and `■`/`□` in the accent) and redraw in place, so the
 * screen never scrolls under a choice. A caller tests with its own `Ui`.
 */
export interface Ui {
	/** The chosen index, or null for escape. */
	select(title: string, options: string[]): Promise<number | null>;
	/** The ticked indexes, or null for escape. */
	checklist(title: string, items: string[]): Promise<number[] | null>;
	/** The answer as typed; empty when enter alone. `placeholder` shows until the first character. */
	line(question: string, placeholder: string): Promise<string>;
}

const ESC = "";
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const CLEAR_LINE = `${ESC}[2K`;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;

type Key = "up" | "down" | "space" | "enter" | "escape" | "interrupt" | "other";

function keyOf(chunk: string): Key {
	if (chunk === UP || chunk === "k") return "up";
	if (chunk === DOWN || chunk === "j") return "down";
	if (chunk === " ") return "space";
	if (chunk === "\r" || chunk === "\n") return "enter";
	if (chunk === ESC || chunk === "q") return "escape";
	if (chunk === "") return "interrupt";
	return "other";
}

export interface Streams {
	stdin: NodeJS.ReadStream & { setRawMode?: (raw: boolean) => unknown };
	stdout: NodeJS.WriteStream;
}

/**
 * Draw `lines`, read keys until `onKey` returns an answer, redrawing the
 * same rows in place after every key. Raw mode is on only while a choice is
 * open, and the cursor is hidden for the same stretch.
 */
async function menu<T>(streams: Streams, draw: () => string[], onKey: (key: Key) => T | undefined): Promise<T> {
	const { stdin, stdout } = streams;
	let drawn = 0;
	const paint = () => {
		const lines = draw();
		if (drawn > 0) stdout.write(`${ESC}[${drawn}A`);
		for (const line of lines) stdout.write(`${CLEAR_LINE}${line}\n`);
		drawn = lines.length;
	};
	stdin.setRawMode?.(true);
	stdin.resume();
	stdin.setEncoding("utf8");
	stdout.write(HIDE);
	paint();
	try {
		return await new Promise<T>((resolve) => {
			const onData = (chunk: string) => {
				const key = keyOf(chunk);
				if (key === "interrupt") {
					stdin.off("data", onData);
					stdout.write(SHOW);
					process.exit(130);
				}
				const answer = onKey(key);
				if (answer !== undefined) {
					stdin.off("data", onData);
					resolve(answer);
					return;
				}
				paint();
			};
			stdin.on("data", onData);
		});
	} finally {
		stdin.setRawMode?.(false);
		stdin.pause();
		stdout.write(SHOW);
	}
}

const cursorRow = (on: boolean, text: string) => (on ? `  ${accent("▶")} ${text}` : `    ${text}`);

export function terminalUi(streams: Streams): Ui {
	return {
		select(title, options) {
			let at = 0;
			return menu<number | null>(
				streams,
				() => [`  ${title}`, ...options.map((option, index) => cursorRow(index === at, option))],
				(key) => {
					if (key === "up") at = (at + options.length - 1) % options.length;
					else if (key === "down") at = (at + 1) % options.length;
					else if (key === "enter") return at;
					else if (key === "escape") return null;
					return undefined;
				},
			);
		},
		checklist(title, items) {
			let at = 0;
			const ticked = new Set<number>();
			return menu<number[] | null>(
				streams,
				() => [
					`  ${title} ${dim("space ticks · enter keeps")}`,
					...items.map((item, index) => cursorRow(index === at, `${ticked.has(index) ? accent("■") : "□"} ${item}`)),
				],
				(key) => {
					if (key === "up") at = (at + items.length - 1) % items.length;
					else if (key === "down") at = (at + 1) % items.length;
					else if (key === "space") ticked.has(at) ? ticked.delete(at) : ticked.add(at);
					else if (key === "enter") return [...ticked].sort((a, b) => a - b);
					else if (key === "escape") return null;
					return undefined;
				},
			);
		},
		line(question, placeholder) {
			// A raw-mode line: the placeholder shows until the first character and
			// then only what is typed, with the cursor at its end; backspace edits;
			// enter answers; escape answers nothing.
			const { stdin, stdout } = streams;
			let typed = "";
			const paint = () => {
				stdout.write(`\r${CLEAR_LINE}  ${question} ${typed === "" ? dim(placeholder) : typed}`);
			};
			stdin.setRawMode?.(true);
			stdin.resume();
			stdin.setEncoding("utf8");
			paint();
			return new Promise<string>((resolve) => {
				const done = (answer: string) => {
					stdin.off("data", onData);
					stdin.setRawMode?.(false);
					stdin.pause();
					stdout.write(`\r${CLEAR_LINE}  ${question} ${answer === "" ? dim("(default)") : answer}\n`);
					resolve(answer.trim());
				};
				const onData = (chunk: string) => {
					const key = keyOf(chunk);
					if (key === "interrupt") {
						stdout.write("\n");
						process.exit(130);
					}
					if (key === "enter") return done(typed);
					if (chunk === ESC) return done("");
					if (chunk === "\u007f" || chunk === "\b") typed = typed.slice(0, -1);
					else if (!chunk.startsWith(ESC) && chunk >= " ") typed += chunk;
					paint();
				};
				stdin.on("data", onData);
			});
		},
	};
}
