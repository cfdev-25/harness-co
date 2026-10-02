import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { type Server, createServer } from "node:net";
import { join } from "node:path";
import { execPath, platform } from "node:process";
import { describe, expect, it } from "vitest";
import { confine } from "../../src/sandbox/confine.js";
import { installProbeBinary } from "../../src/sandbox/probes.js";
import {
	type Fixture,
	connectScript,
	fixture,
	inside,
	insideAsync,
	listenScript,
	outside,
	readScript,
	writeScript,
} from "./support.js";

/**
 * 06 §11 on Linux. Written here, run on the CI ubuntu runner (which installs
 * bubblewrap); **not verified on the machine this landed from**, which is
 * macOS. The semantics differ from macOS by D82 — a denied directory is an
 * empty tmpfs and a denied file reads as empty, rather than EPERM — so these
 * assert the property (the content is unreachable), never the errno.
 */
const stubSocket = async (f: Fixture): Promise<Server> => {
	const server = createServer((socket) => socket.end("HTTP/1.1 200 OK\r\n\r\nproxied"));
	await new Promise<void>((resolve) => server.listen(join(f.session.dir, "proxy.sock"), resolve));
	return server;
};
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe.skipIf(platform !== "linux")("the jail on Linux", () => {
	it("builds the §5 argv", async () => {
		const f = fixture();
		const server = await stubSocket(f);
		try {
			const { command, args } = confine(f.plan, [execPath, "-e", ""], f.session);
			expect(command.endsWith("/bwrap")).toBe(true);
			expect(args.slice(0, 3)).toEqual(["--unshare-all", "--die-with-parent", "--new-session"]);
			expect(args).toContain("--clearenv");
			for (const [key, value] of Object.entries(f.plan.env)) {
				expect(args.join(" ")).toContain(`--setenv ${key} ${value}`);
			}
			// The deny set: a directory is hidden by a tmpfs over it (D82).
			for (const denied of f.plan.filesystem.denyRead) {
				expect(args.join(" ")).toContain(`--tmpfs ${denied}`);
			}
			// denyWrite is a read-only re-bind, after the workspace bind (C7, D81).
			const claude = join(f.workspace, ".claude");
			expect(args.indexOf(claude)).toBeGreaterThan(args.indexOf(f.workspace));
			expect(args.join(" ")).toContain(`--ro-bind ${claude} ${claude}`);
			// The socket is the only route in, and the forwarder is what argv runs.
			expect(args.join(" ")).toContain(`--bind ${join(f.session.dir, "proxy.sock")} /run/harness/proxy.sock`);
			// The CLI itself must be reachable inside, or node cannot load the
			// forwarder at all.
			const forwarderPath = args[args.lastIndexOf("--") - 4] ?? "";
			expect(args.some((source, i) => args[i - 1] === "--ro-bind" && forwarderPath.startsWith(source))).toBe(true);
			const dash = args.lastIndexOf("--");
			expect(args[dash - 3]).toBe("/run/harness/proxy.sock");
			expect(args[dash - 2]).toBe(String(f.session.proxyPort));
			expect(args[dash - 4]?.endsWith("/forwarder.js")).toBe(true);
			expect(args).not.toContain("--share-net");
		} finally {
			await close(server);
		}
	}, 30_000);

	it("denied_host_has_no_route", async () => {
		const f = fixture();
		const server = await stubSocket(f);
		try {
			expect(inside(f, connectScript(443, "1.1.1.1")).stdout).toContain("SHUT");
			expect(outside(f, connectScript(443, "1.1.1.1")).stdout).toContain("OPEN");
		} finally {
			await close(server);
		}
	}, 30_000);

	it("denied_path_unreadable", async () => {
		const f = fixture();
		const server = await stubSocket(f);
		try {
			// A denied file reads as empty, a denied directory lists as empty: the
			// content is unreachable either way.
			expect(inside(f, readScript(join(f.home, ".ssh/id_ed25519"))).stdout).not.toContain("OPEN");
			const list = `console.log(require("node:fs").readdirSync(${JSON.stringify(join(f.session.dir, "denied"))}).length?"OPEN":"EMPTY")`;
			expect(inside(f, list).stdout).toContain("EMPTY");
		} finally {
			await close(server);
		}
	}, 30_000);

	it("compiled_binary_in_denied_dir_does_not_exec", async () => {
		const f = fixture();
		const binary = installProbeBinary(f.session.dir);
		const server = await stubSocket(f);
		try {
			const exec = `try{require("node:child_process").execFileSync(${JSON.stringify(binary)},{stdio:"ignore"});console.log("OPEN")}catch(e){console.log("SHUT",e.code)}`;
			expect(inside(f, exec).stdout).toContain("SHUT");
		} finally {
			await close(server);
		}
		// The control that makes the result mean something: the same binary execs
		// outside the jail.
		expect(execFileSync(binary, { encoding: "utf8" })).toBe("hello\n");
	}, 30_000);

	it("write_outside_geometry_fails", async () => {
		const f = fixture();
		const server = await stubSocket(f);
		try {
			for (const path of [join(f.home, ".harness/assets.git/PROBE"), join(f.workspace, ".claude/x")]) {
				expect(inside(f, writeScript(path)).stdout).toContain("SHUT");
				expect(existsSync(path)).toBe(false);
			}
			expect(inside(f, writeScript(join(f.workspace, "PROBE"))).stdout).toContain("OPEN");
		} finally {
			await close(server);
		}
	}, 30_000);

	it("listener_bind_refused", async () => {
		const f = fixture();
		const server = await stubSocket(f);
		try {
			// The forwarder holds the proxy port inside the namespace, so a second
			// listen on it is refused; a listener on any other port is unreachable
			// from outside the namespace and proves nothing.
			expect(inside(f, listenScript(f.session.proxyPort)).stdout).toContain("EADDRINUSE");
		} finally {
			await close(server);
		}
	}, 30_000);

	it("deny_write_settings_file_holds", async () => {
		for (const claudeDir of [true, false]) {
			const f = fixture({ claudeDir });
			const server = await stubSocket(f);
			try {
				const settings = join(f.workspace, ".claude/settings.json");
				expect(inside(f, writeScript(settings)).stdout).toContain("SHUT");
			} finally {
				await close(server);
			}
			// 06 §6.2: "Neither leaves anything on disk after the session." When the
			// directory was absent, bwrap has to mkdir the mount point inside a
			// read-write bind of the workspace, so this asserts the document and is
			// expected to reveal that an empty `.claude/` survives (see the report).
			expect(existsSync(join(f.workspace, ".claude"))).toBe(claudeDir);
			if (claudeDir) expect(readdirSync(join(f.workspace, ".claude"))).toEqual([]);
		}
	}, 30_000);

	it("forwarder_only_reaches_socket", async () => {
		const f = fixture();
		const server = await stubSocket(f);
		const decoy = createServer((socket) => socket.end("nope"));
		await new Promise<void>((resolve) => decoy.listen(0, "127.0.0.1", resolve));
		const decoyPort = (decoy.address() as { port: number }).port;
		try {
			const request = `const s=require("node:net").connect(${f.session.proxyPort},"127.0.0.1");s.on("connect",()=>s.write("GET / HTTP/1.1\\r\\n\\r\\n"));s.on("data",(d)=>{console.log(d.includes("proxied")?"OPEN":"REFUSED");process.exit(0)});s.on("error",(e)=>{console.log("SHUT",e.code);process.exit(0)})`;
			expect(await insideAsync(f, request)).toContain("OPEN");
			expect(await insideAsync(f, connectScript(decoyPort, "127.0.0.1"))).toContain("SHUT");
		} finally {
			decoy.close();
			await close(server);
		}
	}, 30_000);
});
