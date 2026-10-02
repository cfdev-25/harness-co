import type { EffectiveReach, Icon } from "@harness/compose/contracts";
import { pixelText, textWidth, wrapName } from "./font.js";
import { iconCells, renderIcon } from "./pixels.js";
import { type ColorMode, accent, bold, dim } from "./style.js";

/**
 * 08 §11.1 — the landing: the harness's drawing, its name in the pixel font,
 * its description, and the four facts, laid out for a given width. One
 * function draws it wherever it appears: the CLI's boot screen and exit
 * review, and — for a runtime whose landing is ours (07 §6, Pi) — the
 * runtime's own header, which re-renders it at every resize. Nothing here
 * reads `process`, so the Pi extension can import this module by path and
 * call it with the width it was given.
 */
export interface Landing {
	/** The harness's drawing, or null for the grey placeholder. */
	icon: Icon | null;
	name: string;
	description: string;
	/** Counts by kind, from `layout.ts`'s `deliveredCounts` and nowhere else. */
	delivered: string;
	/** `provider · model`, or *your own sign-in · not metered* (C22). */
	model: string;
	/** Reach in words (`reachBrief`). */
	reach: string;
	workspace: string;
}

const GUTTER = "  ";
const BETWEEN = "   ";
const LABEL = 9;
/** The name may take this many pixel lines beside the drawing (four rows each). */
const NAME_LINES = 2;

/** A harness with no drawing yet (`harness new` mints a blank one) is grey
    rather than absent: the frame keeps its shape, and the empty square is a
    visible invitation to give it one in the console. */
const GREY: Icon = { palette: ["#555555"], rows: Array.from({ length: 16 }, () => "0".repeat(16)) };

const ANSI = /\[[0-9;]*m/g;
export const visible = (text: string): number => text.replace(ANSI, "").length;

/** Cut to `room`, with an ellipsis, counting visible characters only. */
export function fit(text: string, room: number): string {
	if (room <= 0) return "";
	return visible(text) <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`;
}

/**
 * The landing as terminal lines for `width` columns.
 *
 * Layout follows the room beside the drawing: the name is drawn in the pixel
 * font when it fits in one or two lines there, and is plain text when even
 * two lines would not hold it. The description and the facts sit below the
 * block at the gutter, description first, so the exit review's table can take
 * the same column.
 */
export function landingLines(landing: Landing, width: number, mode: ColorMode): string[] {
	const tint = (paint: (text: string) => string) => (mode === "mono" ? (text: string) => text : paint);
	const icon = landing.icon && landing.icon.palette.length > 0 ? landing.icon : GREY;
	const drawing = renderIcon(icon, mode);
	const cells = iconCells(icon);
	const room = Math.max(0, width - GUTTER.length - cells - BETWEEN.length);

	const lines = room >= textWidth("A") ? wrapName(landing.name, room, NAME_LINES + 1) : [];
	const pixels = lines.length > 0 && lines.length <= NAME_LINES;
	const beside = pixels ? pixelText(lines, mode, tint(accent)) : [tint(bold)(tint(accent)(fit(landing.name, Math.max(room, 1))))];

	const height = Math.max(drawing.length, beside.length);
	const block = Array.from({ length: height }, (_row, at) => {
		const left = drawing[at] ?? "";
		return `${GUTTER}${left}${" ".repeat(Math.max(0, cells - visible(left)))}${BETWEEN}${beside[at] ?? ""}`.trimEnd();
	});
	// The facts, the description first: it reads as the first thing said about
	// the harness, not as a caption on the drawing.
	const field = (label: string, value: string) =>
		value === "" ? "" : `${GUTTER}${tint(dim)(label.padEnd(LABEL))} ${fit(value, width - GUTTER.length - LABEL - 1)}`;
	const facts = [
		landing.description === "" ? "" : `${GUTTER}${fit(landing.description, width - GUTTER.length)}`,
		field("delivers", landing.delivered),
		field("model", landing.model),
		field("reach", landing.reach),
		field("in", landing.workspace),
	].filter((line) => line !== "");
	return [...block, "", ...facts];
}

/** 08 §12: a pipe gets the same facts as plain lines and no drawing. */
export function plainLanding(landing: Landing): string[] {
	const said = landing.name === "" ? "" : `${landing.name}${landing.description === "" ? "" : ` — ${landing.description}`}`;
	const field = (label: string, value: string) => (value === "" ? "" : `${label.padEnd(LABEL)} ${value}`);
	return [said, field("delivers", landing.delivered), field("model", landing.model), field("reach", landing.reach), field("in", landing.workspace)].filter(
		(line) => line !== "",
	);
}

/** The rule where ours ends and the provider's own start-up begins. */
export function startRule(provider: string, width: number, mode: ColorMode): string {
	const lead = `── Starting ${provider} `;
	const line = lead + "─".repeat(Math.max(0, width - GUTTER.length - lead.length));
	return `${GUTTER}${mode === "mono" ? line : dim(line)}`;
}

/** The model fact. C22: a session on the person's own sign-in is *not metered*, never zero. */
export function modelBrief(choices: { native: boolean; model: { provider: { id: string }; model: string } } | null): string {
	if (choices === null) return "";
	return choices.native ? "your own sign-in · not metered" : `${choices.model.provider.id} · ${choices.model.model}`;
}

/** W5-D12's reach, in the fewest words that are still true. The long form the
    preflight report prints is `reachWords` in `preflight/report.ts`. */
export function reachBrief(reach: EffectiveReach | undefined): string {
	if (!reach) return "not decided yet";
	if (reach.mode === "off") return "off";
	if (reach.mode === "allow") return `allow-list, ${reach.hosts.length} host${reach.hosts.length === 1 ? "" : "s"}`;
	return reach.hosts.length === 0 ? "on" : `on, ${reach.hosts.length} host${reach.hosts.length === 1 ? "" : "s"} denied`;
}
