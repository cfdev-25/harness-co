/**
 * 05 §5.8 — the ClientHello byte-walk, pure, so the SNI gate (G5) is T1-tested
 * without a socket. The only thing the proxy ever reads out of a tunnel: after
 * the hello it is TLS we do not terminate and do not try to (P9, D72).
 *
 * Returns the host name, `null` when the hello names no server, or
 * `"incomplete"` while the first record is still arriving. A structural fault
 * throws `hello.malformed`, which the tunnel treats as `"no-sni"`.
 */
export function serverName(buf: Buffer): string | null | "incomplete" {
	// Rows 1–3: content type, legacy version, record length.
	if (buf.length < 5) return "incomplete";
	if (buf[0] !== 0x16) throw new Error("hello.malformed");
	const record = buf.readUInt16BE(3);
	if (buf.length < 5 + record) return "incomplete";
	// Rows 4–5: the handshake must be a ClientHello filling exactly this
	// record — the parse never spans records.
	if (buf[5] !== 0x01) throw new Error("hello.malformed");
	if (buf.readUIntBE(6, 3) !== record - 4) throw new Error("hello.malformed");
	const end = 5 + record;
	// Rows 6–7: client version and 32 bytes of random, skipped.
	let p = 43;
	const session = take(buf, p, 1, end); // Row 8
	if (session > 32) throw new Error("hello.malformed");
	p += 1 + session;
	const suites = take(buf, p, 2, end); // Row 9
	if (suites < 2 || suites % 2 !== 0) throw new Error("hello.malformed");
	p += 2 + suites;
	const methods = take(buf, p, 1, end); // Row 10
	if (methods < 1) throw new Error("hello.malformed");
	p += 1 + methods;
	if (p === end) return null; // Row 11: no extensions block at all.
	const extensions = take(buf, p, 2, end);
	p += 2;
	const last = p + extensions;
	while (p + 4 <= last) {
		// Row 12
		const type = buf.readUInt16BE(p);
		const length = buf.readUInt16BE(p + 2);
		p += 4;
		if (p + length > last) throw new Error("hello.malformed");
		if (type === 0x0000) return hostName(buf.subarray(p, p + length)); // Row 13
		p += length;
	}
	return null; // Row 14
}

/** A length prefix that does not fit inside a complete record is malformed. */
function take(buf: Buffer, p: number, width: number, end: number): number {
	if (p + width > end) throw new Error("hello.malformed");
	const n = width === 1 ? buf[p] : buf.readUInt16BE(p);
	if (p + width + n > end) throw new Error("hello.malformed");
	return n;
}

/** Row 13: the first `name_type === 0` entry of the `server_name` list. */
function hostName(ext: Buffer): string | null {
	if (ext.length < 2) throw new Error("hello.malformed");
	const last = 2 + ext.readUInt16BE(0);
	if (last > ext.length) throw new Error("hello.malformed");
	let p = 2;
	while (p + 3 <= last) {
		const type = ext[p];
		const length = ext.readUInt16BE(p + 1);
		p += 3;
		if (p + length > last) throw new Error("hello.malformed");
		if (type === 0) return ext.subarray(p, p + length).toString("ascii").toLowerCase().replace(/\.$/, "");
		p += length;
	}
	return null;
}
