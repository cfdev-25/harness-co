// engine/cli/src/sandbox/forwarder.js — runs INSIDE the jail on Linux (06 §9).
// Holds nothing. argv: <socketPath> <port> -- <command…>
// ESM, not the `require` of 06 §9's listing: @harness/cli is "type": "module",
// so a .js file here is a module whatever it is written in. Same twenty lines.
import { spawn } from "node:child_process";
import net from "node:net";

const [sock, port, dash, ...argv] = process.argv.slice(2);
if (dash !== "--" || !argv.length) {
	process.stderr.write("forwarder: bad argv\n");
	process.exit(64);
}
const server = net.createServer((client) => {
	const upstream = net.connect(sock);
	client.pipe(upstream).pipe(client);
	const drop = () => {
		client.destroy();
		upstream.destroy();
	};
	client.on("error", drop);
	upstream.on("error", drop);
});
server.listen(Number(port), "127.0.0.1", () => {
	// D84: it starts the provider and exits with its code — one process for
	// bwrap's --die-with-parent to attach to, no lifecycle of its own.
	const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
	child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
});
