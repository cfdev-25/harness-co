import { describe, expect, it } from "vitest";
import { serverName } from "../../src/proxy/hello.js";
import { buildHello, CURL_HELLO, extension, GO_HELLO, NODE_HELLO, sniExtension } from "./hellos.js";

const hex = (s: string) => Buffer.from(s, "hex");

describe("serverName (05 §5.8)", () => {
	it("hello_parses_sni_node", () => {
		expect(serverName(hex(NODE_HELLO))).toBe("example.com");
	});

	it("hello_parses_sni_curl", () => {
		expect(serverName(hex(CURL_HELLO))).toBe("example.com");
	});

	it("hello_parses_sni_go", () => {
		expect(serverName(hex(GO_HELLO))).toBe("api.github.com");
	});

	it("hello_returns_null_without_server_name", () => {
		// Row 14: extensions present, none of them server_name.
		expect(serverName(buildHello(extension(0x002b, Buffer.from([0x02, 0x03, 0x04]))))).toBeNull();
		// Row 11: the buffer ends where the extensions block would start.
		expect(serverName(buildHello(null))).toBeNull();
	});

	it("hello_incomplete_on_short_buffer", () => {
		const whole = hex(NODE_HELLO);
		expect(serverName(whole.subarray(0, 4))).toBe("incomplete");
		expect(serverName(whole.subarray(0, whole.length - 1))).toBe("incomplete");
	});

	it("hello_malformed_on_non_handshake", () => {
		// Content type 0x17 is application data, not a handshake.
		const applicationData = Buffer.from([0x17, 0x03, 0x03, 0x00, 0x01, 0x00]);
		expect(() => serverName(applicationData)).toThrow("hello.malformed");
		// A handshake record that is not a ClientHello.
		const serverHello = hex(NODE_HELLO);
		serverHello[5] = 0x02;
		expect(() => serverName(serverHello)).toThrow("hello.malformed");
	});

	it("hello_ignores_second_record", () => {
		// A hello followed by more bytes still parses from the first record
		// only; the parse never spans records.
		const two = Buffer.concat([buildHello(sniExtension("Api.Stripe.Com.")), hex(NODE_HELLO)]);
		expect(serverName(two)).toBe("api.stripe.com");
	});
});
