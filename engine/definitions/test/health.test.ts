import { afterEach, expect, it } from "vitest";
import { type World, world } from "./world.js";

let here: World | undefined;

afterEach(async () => {
	await here?.close();
	here = undefined;
});

it("answers the health check when the socket, the root and api are all there (02 §12)", async () => {
	// Port 0: the OS picks one, so a developer's own `definitions` on the real
	// port cannot make this test pass or fail.
	here = await world();
	const response = await fetch(`${here.url}/health`);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true, api: true, root: true, socket: true });
});

it("is unhealthy, not healthy, when api does not answer", async () => {
	here = await world();
	await here.api.close();
	const response = await fetch(`${here.url}/health`);
	expect(response.status).toBe(503);
	expect((await response.json()).api).toBe(false);
});

it("answers nothing else", async () => {
	here = await world();
	expect((await fetch(`${here.url}/`)).status).toBe(404);
});
