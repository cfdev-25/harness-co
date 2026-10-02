import type { PreflightReport, Slot, SpawnPlan } from "@harness/compose/contracts";
import { dim, heading, row } from "../style.js";

const credentialSlots = (slots: Slot[]) => slots.filter((slot) => slot.need.kind === "credential");
const state = (slot: Slot) => `${slot.state} · ${slot.evidence}`;

/** Where a slot came from, in the words the person can check (D30a). */
function from(slot: Slot): string {
	if (slot.resolvedFrom === null) return "nothing yet";
	if (slot.resolvedFrom.source === "local") return `your local ${slot.resolvedFrom.tool} login`;
	return `${slot.resolvedFrom.group} · ${slot.resolvedFrom.vault}`;
}

/** Every blocker a person must see: the session-level list, plus each slot's
    own (04 §5.3 step 10 keeps them apart in the record, not on the screen). */
function lines(report: PreflightReport): string[] {
	const all = [...report.blockers, ...report.slots.flatMap((slot) => (slot.blocker ? [slot.blocker] : []))];
	// §5.10: message, then remedy indented, then link dimmed — nothing else.
	return all.flatMap((blocker) => [blocker.message, `  ${blocker.remedy}`, ...(blocker.link ? [dim(`  ${blocker.link}`)] : [])]);
}

/** D131 in the person's words. The plan is the only thing that knows reach, so
    a report written before Plan says so rather than guessing at `off`. */
function reachWords(plan: SpawnPlan | null): string {
	// A report written before Plan has no `plan` at all, and 08 §12.3's `--json`
	// round-trip hands this function whatever the file held.
	if (!plan?.reach) return "not decided yet";
	const { mode, hosts } = plan.reach;
	if (mode === "off") return "off — only the hosts this session holds a credential for";
	if (mode === "on") return hosts.length === 0 ? "on — anything but the boundaries" : `on — anything but ${hosts.length} denied hosts`;
	return `allow-list, ${hosts.length} host${hosts.length === 1 ? "" : "s"}`;
}

/** 03 §5.10, pure. `harness preflight` prints the sections; `run` shows the boot screen instead (08 §11.1). */
export function renderReport(report: PreflightReport): string {
	const { choices, slots } = report;
	// A boot refused before Choose has no choices; the blockers are the whole report (08 §12.3).
	if (choices === null) return lines(report).join("\n");
	const out = [
		heading("identity", report.sessionId),
		row("chain", Object.keys(report.composed.commit).join(" › ") || "none"),
		heading("harness"),
		row("card", choices.harness ? `${choices.harness.name} · ${choices.harness.assets.length} ids` : "none selected — everything you have is loaded"),
		heading("provider"),
		row("runtime", `${choices.provider.id} · ${choices.provider.approval}`),
		row("located", `${choices.located.path} · ${choices.located.version}`),
		heading("model"),
		row("model", `${choices.model.provider.id}/${choices.model.model}`),
		row("wire format", `${choices.model.wireFormat} · ${choices.model.endpoint}`),
		heading("credentials"),
		...slots.map((slot) => row(slot.need.kind === "credential" ? slot.need.alias : slot.need.kind === "login" ? slot.need.tool : slot.need.kind === "environment" ? slot.need.name : slot.need.id, state(slot), from(slot))),
		heading("reach"),
		// C4: nothing prints a claim it did not earn — the fence is what enforces this.
		row("reach", `${reachWords(report.plan)} · enforced`, report.plan ? `set by ${report.plan.reach.setBy}` : undefined),
		row("credentialed hosts", (report.plan?.hosts ?? []).join(", ") || "none"),
		heading("drift"),
		...report.drift.map((one) => row(one.file, `expected ${JSON.stringify(one.expected)}`, `got ${JSON.stringify(one.actual)}`)),
		heading("blockers"),
		...lines(report),
	];
	return `${out.join("\n")}\n`;
}
