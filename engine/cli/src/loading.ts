import { accent, dim } from "./style.js";

/**
 * 08 §11.1 — the loading pixels: a short strip of cells with a lit run that
 * sweeps across it, and one word beside it, drawn the moment a command starts
 * and again while a session closes, so the wait before the landing or the
 * review is visibly a wait and not a hang. It redraws its one line in place
 * and clears it when the real screen is ready. Not a TTY: nothing.
 */
const ESC = "";
const CELLS = 6;
const RUN = 2;
const LIT = "█";
const DARK = "░";

export interface Loading {
	stop(): void;
}

/** One frame of the strip, the lit run at `step`. */
export function strip(step: number, lit = LIT, dark = DARK): string {
	const start = step % (CELLS + RUN) - RUN;
	return Array.from({ length: CELLS }, (_cell, at) => (at >= start && at < start + RUN ? lit : dark)).join("");
}

export function loading(word: string, stream: NodeJS.WriteStream, options: { tty?: boolean; intervalMs?: number } = {}): Loading {
	if (options.tty === false || (options.tty === undefined && stream.isTTY !== true)) return { stop: () => {} };
	let step = 0;
	let stopped = false;
	const draw = () => stream.write(`\r${ESC}[2K  ${accent(strip(step))}  ${dim(word)}`);
	draw();
	const timer = setInterval(() => {
		step += 1;
		draw();
	}, options.intervalMs ?? 90);
	timer.unref?.();
	return {
		stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(timer);
			stream.write(`\r${ESC}[2K`);
		},
	};
}
