import { afterAll, beforeAll, expect, it } from "vitest";
import { messages } from "../src/codes.js";
import { type World, person, seedBranch, seedOrg, world } from "./world.js";

/** 02 §5.2, step by step, over the real smart-HTTP entry point. */
let here: World;
let advertise: string;

beforeAll(async () => {
	here = await world();
	const repo = await seedOrg(here.root, "acme");
	await seedBranch(repo, "refs/heads/users/u-dana", "acme.dana");
	here.api.principals.set(
		"dana",
		person("u-dana", "acme", [
			["org", "acme", "refs/heads/org"],
			["user", "acme.dana", "refs/heads/users/u-dana"],
		]),
	);
	advertise = `${here.url}/acme.git/info/refs?service=git-upload-pack`;
});

afterAll(async () => {
	await here.close();
});

it("step 1: no token is 401, and says how to authenticate", async () => {
	const response = await fetch(advertise);
	expect(response.status).toBe(401);
	expect(response.headers.get("www-authenticate")).toBe('Bearer realm="harness", Basic realm="harness"');
	expect(await response.json()).toEqual({
		code: "definitions.unauthenticated",
		message: messages["definitions.unauthenticated"](),
	});
});

it("step 3: a token api does not know is 401", async () => {
	const response = await fetch(advertise, { headers: { authorization: "Bearer nobody" } });
	expect(response.status).toBe(401);
});

it("step 3: api not answering is 503 definitions.api_unreachable, never a stale answer", async () => {
	expect((await fetch(advertise, { headers: { authorization: "Bearer dana" } })).status).toBe(200);
	here.api.failPrincipal = true;
	// A different token, so the 30 s cache cannot mask the outage.
	here.api.principals.set("kim", person("u-kim", "acme", [["org", "acme", "refs/heads/org"]]));
	const response = await fetch(advertise, { headers: { authorization: "Bearer kim" } });
	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		code: "definitions.api_unreachable",
		message: messages["definitions.api_unreachable"](),
	});
	here.api.failPrincipal = false;
});

it("step 4: the principal is cached, so a fetch is one lookup not many", async () => {
	const before = here.api.principalCalls;
	for (let attempt = 0; attempt < 3; attempt += 1)
		expect((await fetch(advertise, { headers: { authorization: "Bearer dana" } })).status).toBe(200);
	expect(here.api.principalCalls).toBe(before);
});

it("step 5: another organisation's repo is 404, not 403", async () => {
	await seedOrg(here.root, "other");
	const response = await fetch(`${here.url}/other.git/info/refs?service=git-upload-pack`, {
		headers: { authorization: "Bearer dana" },
	});
	expect(response.status).toBe(404);
});

it("step 1: HTTP Basic is accepted, for a person running git by hand", async () => {
	const basic = Buffer.from("harness:dana").toString("base64");
	expect((await fetch(advertise, { headers: { authorization: `Basic ${basic}` } })).status).toBe(200);
});
