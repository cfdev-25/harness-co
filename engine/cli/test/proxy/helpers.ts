import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";

/** A key pair and certificate the test's own TLS upstreams serve. */
export interface Pki {
	ca: string;
	key: string;
	cert: string;
}

/**
 * A CA and one leaf for `localhost`, made with `openssl` so the test's upstream
 * is a real TLS server with a real chain. The proxy is given no CA option of
 * any kind (10 rule 3): the trusted CA is added to the *test process's* default
 * store, which is what `NODE_EXTRA_CA_CERTS` does at bootstrap — and bootstrap
 * is the only time Node reads that variable, so a test that must also see an
 * untrusted upstream in the same process uses `tls.setDefaultCACertificates`.
 */
export function makePki(dir: string, port: number): Pki {
	mkdirSync(dir, { recursive: true });
	const at = (name: string) => `${dir}/${name}`;
	writeFileSync(at("ca.cnf"), "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=harness-test-ca-" + port + "\n[v3]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n");
	writeFileSync(at("leaf.cnf"), "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=localhost\n[v3]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n");
	const ssl = (...argv: string[]) => execFileSync("openssl", argv, { stdio: "pipe" });
	ssl("req", "-x509", "-newkey", "rsa:2048", "-keyout", at("ca.key"), "-out", at("ca.pem"), "-days", "2", "-nodes", "-config", at("ca.cnf"));
	ssl("req", "-new", "-newkey", "rsa:2048", "-keyout", at("leaf.key"), "-out", at("leaf.csr"), "-nodes", "-config", at("leaf.cnf"));
	ssl("x509", "-req", "-in", at("leaf.csr"), "-CA", at("ca.pem"), "-CAkey", at("ca.key"), "-CAcreateserial", "-out", at("leaf.pem"), "-days", "2", "-extfile", at("leaf.cnf"), "-extensions", "v3");
	return { ca: readFileSync(at("ca.pem"), "utf8"), key: readFileSync(at("leaf.key"), "utf8"), cert: readFileSync(at("leaf.pem"), "utf8") };
}

/** A client socket on the proxy's TCP port or unix socket. */
export function open(target: number | string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = typeof target === "number" ? connect(target, "127.0.0.1") : connect(target);
		socket.once("connect", () => resolve(socket));
		socket.once("error", reject);
	});
}

/** Everything the peer sends until it hangs up. */
export function drain(socket: Socket): Promise<string> {
	return new Promise((resolve) => {
		let text = "";
		socket.on("data", (chunk) => {
			text += chunk.toString("utf8");
		});
		socket.once("close", () => resolve(text));
	});
}

/** Read until `needle` appears, so a test can act on a response head without
    waiting for a stream that will not end. */
export function until(socket: Socket, needle: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let text = "";
		const onData = (chunk: Buffer) => {
			text += chunk.toString("utf8");
			if (!text.includes(needle)) return;
			socket.off("data", onData);
			resolve(text);
		};
		socket.on("data", onData);
		socket.once("close", () => reject(new Error(`closed before ${JSON.stringify(needle)}: ${JSON.stringify(text)}`)));
	});
}

/** One HTTP/1.1 request and its whole response, over an otherwise raw socket. */
export async function speak(target: number | string, lines: string[], body = ""): Promise<string> {
	const socket = await open(target);
	const text = drain(socket);
	socket.write(`${lines.join("\r\n")}\r\n\r\n${body}`);
	return text;
}

export function statusOf(response: string): number {
	return Number(response.slice(9, 12));
}

export function bodyOf(response: string): string {
	const split = response.indexOf("\r\n\r\n");
	if (split === -1) return "";
	const body = response.slice(split + 4);
	if (!/\r\ntransfer-encoding:\s*chunked/i.test(response.slice(0, split))) return body;
	let rest = body;
	let decoded = "";
	while (rest.length > 0) {
		const eol = rest.indexOf("\r\n");
		const size = Number.parseInt(rest.slice(0, eol), 16);
		if (!size) break;
		decoded += rest.slice(eol + 2, eol + 2 + size);
		rest = rest.slice(eol + 4 + size);
	}
	return decoded;
}
