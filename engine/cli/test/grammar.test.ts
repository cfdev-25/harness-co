import { describe, expect, it } from "vitest";
import { parseRun, parse } from "../src/main.js";
import { selectAdapter } from "../src/run.js";

/** §6's grammar, and §13's two provider rows. Zero I/O, as row 0 requires. */
describe("run grammar (§6)", () => {
	it("takes the one undashed word as the provider and the one dashed word as the harness", () => {
		const argv = parseRun(["pi", "--marketing"]);
		expect(argv.provider).toBe("pi");
		expect(argv.harnessFlag).toBe("marketing");
		expect(argv.passthrough).toEqual([]);
	});

	it("hands everything after `--` to the provider, verbatim and unread", () => {
		const argv = parseRun(["pi", "--", "--resume", "--team", "-x", "a b"]);
		// Reserved words after `--` keep no meaning of ours, including `--team`.
		expect(argv.passthrough).toEqual(["--resume", "--team", "-x", "a b"]);
		expect(argv.team).toBe(false);
		expect(argv.harnessFlag).toBeUndefined();
	});

	it("does not mistake a reserved flag for a harness name", () => {
		for (const flag of ["--team", "--offline", "--json", "--non-interactive"]) {
			expect(parseRun(["pi", flag]).harnessFlag).toBeUndefined();
		}
		expect(parseRun(["pi", "--team"]).team).toBe(true);
		expect(parseRun(["pi", "--offline"]).offline).toBe(true);
	});

	it("reads `--harness <name>`, the spelling a harness:// link writes (W5-D13)", () => {
		expect(parseRun(["pi", "--harness", "marketing"]).harnessFlag).toBe("marketing");
		// The shorthand still wins when both are given; there is one answer.
		expect(parseRun(["pi", "--sales", "--harness", "marketing"]).harnessFlag).toBe("sales");
	});

	it("refuses a second undashed word, naming the passthrough form", () => {
		expect(() => parseRun(["pi", "--resume"])).not.toThrow();
		expect(() => parseRun(["pi", "extra"])).toThrow(/provider arguments go after `--`/);
		expect(() => parseRun(["pi", "--a", "--b"])).toThrow(/one harness flag/);
	});

	it("reads the valued flags", () => {
		const argv = parseRun(["pi", "--as", "jo", "--model", "anthropic/claude-opus-5"]);
		expect(argv.as).toBe("jo");
		expect(argv.model).toBe("anthropic/claude-opus-5");
		expect(() => parse(["--as"])).toThrow(/needs a value/);
	});

	it("partitions `preflight`'s section words from the provider word (§11.13)", () => {
		const sections = ["identity", "model"];
		expect(parseRun(["identity"], sections)).toMatchObject({ provider: undefined, sections: ["identity"] });
		expect(parseRun(["pi", "model"], sections)).toMatchObject({ provider: "pi", sections: ["model"] });
	});
});

describe("selectAdapter (§13)", () => {
	it("never passes an unknown word through", () => {
		expect(() => selectAdapter("nope")).toThrow();
		try {
			selectAdapter("nope");
		} catch (thrown) {
			expect(thrown).toMatchObject({ code: "cli.provider_unknown", message: '"nope" is not a provider this CLI knows. You have: pi, claude.' });
		}
	});

	it("asks when several are installed and no word is given", () => {
		try {
			selectAdapter(undefined);
		} catch (thrown) {
			expect(thrown).toMatchObject({ code: "cli.provider_ambiguous", message: "Say which provider: pi, claude." });
		}
	});

	it("is not ambiguous when the organisation lists only one", () => {
		expect(selectAdapter(undefined, ["pi"]).id).toBe("pi");
	});
});
