import type { Drift, Rehydrated } from "@harness/compose/contracts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 03 §5.8 step 3. One `Drift` per field that differs. This is a control
 * against a buggy adapter — a render that silently omitted a skill or pointed
 * at the wrong endpoint — not against a hostile person, who owns the machine
 * (`00` I4). `files` and `links` are `rehydrate`'s own comparison (07 §5), so
 * they are not re-checked here; `denies` is a superset test, the rest exact.
 */
export function diffRehydrated(expected: Rehydrated, actual: Rehydrated): Drift[] {
	const drift: Drift[] = [];
	const differs = (field: string, want: unknown, got: unknown) => {
		if (!same(want, got)) drift.push({ file: "rendered.json", expected: { [field]: want }, actual: { [field]: got } });
	};
	differs("skills", expected.skills, actual.skills);
	differs("prompts", expected.prompts, actual.prompts);
	differs("instructions.system_prompt", expected.instructions.system_prompt, actual.instructions.system_prompt);
	differs("instructions.memory", expected.instructions.memory, actual.instructions.memory);
	differs("model", expected.model, actual.model);
	// `denies ⊇ plan.filesystem.denyWrite`: more is a tightening, less is drift.
	const missing = expected.denies.filter((deny) => !actual.denies.includes(deny));
	if (missing.length > 0) drift.push({ file: "rendered.json", expected: { denies: expected.denies }, actual: { denies: actual.denies } });
	const hooks = expected.hooks.filter((hook) => !actual.hooks.includes(hook));
	if (hooks.length > 0) drift.push({ file: "rendered.json", expected: { hooks: expected.hooks }, actual: { hooks: actual.hooks } });
	return drift;
}
