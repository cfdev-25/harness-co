import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import process, { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { confine } from "../../src/sandbox/confine.js";
import { installProbeBinary } from "../../src/sandbox/probes.js";
import { blockerOf, fixture } from "./support.js";

const PROBE_DIR = fileURLToPath(new URL("../../probe/", import.meta.url));

it("windows_refuses_plainly", () => {
	const f = fixture();
	const real = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: "win32", configurable: true });
	let wrapped: unknown;
	let thrown: unknown;
	try {
		wrapped = confine(f.plan, ["node", "-e", ""], f.session);
	} catch (error) {
		thrown = error;
	} finally {
		if (real) Object.defineProperty(process, "platform", real);
	}
	expect(wrapped).toBeUndefined(); // there is nothing to spawn: no child is started
	expect(blockerOf(thrown).code).toBe("sandbox.unsupported_platform");
	expect(blockerOf(thrown).message).toBe(
		"The harness confines the agent with a sandbox, and there is no native sandbox for Windows yet. It will not start a session it cannot confine.",
	);
	expect(blockerOf(thrown).remedy).toBe(
		"Run it inside WSL2 (`harness setup windows` installs what is needed, §9a W1), or on macOS or Linux. If your organization has approved unfenced Windows sessions, `harness preflight` will say so instead of this.",
	);
	expect(process.platform).not.toBe("win32");
});

describe.skipIf(platform !== "darwin")("the profile", () => {
	it("profile_is_deterministic", () => {
		const f = fixture();
		const once = confine(f.plan, ["node", "-e", ""], f.session);
		const twice = confine(f.plan, ["node", "-e", ""], f.session);
		expect(once.args[1]).toBe(twice.args[1]);
		const profile = once.args[1];
		for (const path of f.plan.filesystem.denyRead) {
			expect(profile).toContain(`(deny file-read* (subpath "${path}"))`);
			expect(profile).toContain(`(deny process-exec (subpath "${path}"))`);
		}
		expect(profile).toContain(`(allow network-outbound (remote ip "localhost:${f.session.proxyPort}"))`);
		expect(profile).toContain("(deny network*)");
		// The proxy line is the only thing the network family allows: no inbound,
		// no bind, no unix-domain socket (S3).
		expect(profile.split("\n").filter((line) => line.startsWith("(allow network"))).toHaveLength(1);
	});

	it("realpath_applied", () => {
		const f = fixture();
		const link = join(f.root, "link-home");
		symlinkSync(f.home, link);
		// The same geometry spelled through a symlinked HOME and through /tmp,
		// which is /private/tmp on macOS. Seatbelt matches what the kernel sees.
		f.plan.filesystem.denyRead = [join(link, ".ssh"), `/tmp/${basename(f.root)}/home/.config/harness`];
		const profile = confine(f.plan, ["node", "-e", ""], f.session).args[1];
		expect(profile).toContain(`(deny file-read* (subpath "${join(f.home, ".ssh")}"))`);
		expect(profile).toContain(`(deny file-read* (subpath "${join(f.home, ".config/harness")}"))`);
		expect(profile).not.toContain(link);
		expect(profile).not.toContain('"/tmp/');
	});
});

describe("the probe binary", () => {
	it("probe_binary_checksum_refuses_tamper", () => {
		const f = fixture();
		const source = join(PROBE_DIR, `${platform}-${arch}`);
		const original = readFileSync(source);
		try {
			writeFileSync(source, Buffer.concat([original, Buffer.from([0])]));
			let installed: unknown;
			let thrown: unknown;
			try {
				installed = installProbeBinary(f.session.dir);
			} catch (error) {
				thrown = error;
			}
			expect(installed).toBeUndefined();
			expect(blockerOf(thrown).code).toBe("sandbox.probe_binary_checksum");
			expect(blockerOf(thrown).message).toBe(
				`The sandbox probe binary for ${platform}-${arch} does not match its recorded checksum. The harness will not run an unverified binary.`,
			);
			expect(blockerOf(thrown).remedy).toBe("Reinstall the harness CLI.");
		} finally {
			writeFileSync(source, original);
		}
		// And the untampered binary installs, from the recorded checksum alone.
		expect(installProbeBinary(f.session.dir)).toBe(join(f.session.dir, "denied", "probe"));
	});
});
