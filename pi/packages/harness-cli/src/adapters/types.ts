import type { Manifest } from "../core.js";

/**
 * What `render` and `launch` need to do their job. One shape shared by every
 * adapter, so a second implementation (13.5) drops in without `run` changing.
 * `sessionDir`/`agentDir` are handed down rather than derived from `id`
 * inside the adapter: where a session lives on disk is core bookkeeping, not
 * something Pi or Claude Code gets an opinion on.
 */
export interface RenderContext {
	manifest: Manifest;
	id: string;
	sessionDir: string;
	agentDir: string;
}

export interface Adapter {
	/** The word `harness run <id>` matches against, and what an unknown-agent
	    error and `harness run` (no word, several adapters) list by. */
	readonly id: string;

	/** Write this agent's file formats under `ctx.agentDir` / `ctx.sessionDir`. */
	render(ctx: RenderContext): Promise<void>;

	/** This agent's argv and the env keys only it needs to boot. */
	launch(ctx: RenderContext): { argv: string[]; env: Record<string, string> };
}
