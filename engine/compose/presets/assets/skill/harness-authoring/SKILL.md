---
name: harness-authoring
description: How to make a harness asset in place, and how to extract one from another tool's setup (Claude Code, Codex, Cursor, Gemini CLI, Aider, Pi) so it runs anywhere. Read this when asked to build a skill, tool or prompt, or to move a setup into the harness.
---

# Harness authoring

## The seam

Two places, separated by path:

- **The project** is the working directory. Code, tests, docs — the person's
  repository. Nothing here is harness infrastructure.
- **The harness** is `~/.harness/assets/<kind>/<name>/`. Everything the
  assistant is *given* — skills, tools, prompts, memories — lives here and
  follows the person into every project and every runtime.

If asked to build something that should work again next time, in another
project, or under another runtime, it belongs in the harness. If it is part
of this codebase, it belongs in the project. When unsure, ask one question:
*"Should this follow you to other projects, or stay in this one?"*

You have write access to both. What you create under `~/.harness/assets/`
is listed when the session ends and the person decides whether to keep it.
Do not add an `asset.json` file; the harness mints it when the asset is
kept.

## Kinds and their shapes

Every asset is one directory, `~/.harness/assets/<kind>/<name>/`. The name
is a slug: lowercase, digits and hyphens.

| Kind | Directory holds | Use it for |
| --- | --- | --- |
| `skill` | `SKILL.md` (frontmatter `name`, `description`, then instructions) plus any supporting files | a repeatable procedure the assistant should know: how to review a PR, how to write a migration, a house style |
| `tool` | an executable `run` (any language; reads arguments and stdin, writes stdout) and `TOOL.md` describing arguments and output | something that runs: a script, a CLI wrapper, a query |
| `prompt` | exactly one `.md` file | a slash-command-style template the person invokes by name |
| `memory` | exactly one `.md` file | a standing fact or rule: *never drop the production database*, *we use pnpm* |
| `system_prompt` | `system_prompt.md` | the opening brief the assistant works under; keep it short, and prefer `memory` for individual rules |
| `connection` | `model.json` or a service description — **never a key** | where a model or service is reached; the credential comes from a key vault by alias |

A directory whose shape matches none of these is not kept.

## Making an asset

1. Pick the kind from the table. Most requests are a `skill` (know-how) or a
   `tool` (something that runs).
2. Create `~/.harness/assets/<kind>/<name>/` and write the files in that
   kind's shape. For a `tool`, make `run` executable and give it a usage
   line at the top of `TOOL.md`.
3. Write for any runtime. Do not reference a runtime's own tool names
   (`Bash`, `Read`, `str_replace_editor`), config paths (`.claude/`,
   `.cursor/`, `~/.codex/`) or slash-command syntax inside the asset.
   Describe what to do; the runtime decides how.
4. Say what you made and where: *Created `~/.harness/assets/skill/pr-review/`
   — it will be offered to keep when this session ends.*

Never write a credential value into an asset. If something needs a key,
say which alias it needs (`needs: credential <alias>`) and tell the person
to connect the key in the console (*Providers → Set up*, or *Key vaults*).

## Extracting a setup from another tool

When the person says *bring my setup over*, *extract my Codex config*, or
*I'm switching from Cursor*: read the tool's own locations, turn each piece
into the asset kind it is, and report what was carried, carried partially,
and dropped — with the reason for every drop. Read before writing; list what
you found and what you propose before creating anything.

### Where each tool keeps its setup

| Tool | Look in | Becomes |
| --- | --- | --- |
| **Claude Code** | `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./.claude/CLAUDE.md` | `memory`, one per top-level heading; a section headed *Instructions* or *System* → `system_prompt` |
| | `~/.claude/commands/*.md`, `./.claude/commands/*.md` | `prompt`, one each |
| | `~/.claude/skills/*`, `./.claude/skills/*` | `skill`, directory whole |
| | `settings.json` → `permissions`, `hooks`, `mcpServers`, `env`, `model` | see *what is not carried* |
| **Codex** | `~/.codex/AGENTS.md`, `./AGENTS.md`, `~/.codex/instructions.md` | `memory` per heading; *Instructions* → `system_prompt` |
| | `~/.codex/config.toml` → `[profiles]`, `model`, `approval_policy`, `sandbox` | dropped: model routing and approval are the organisation's |
| | `~/.codex/config.toml` → `[mcp_servers]` | `connection` stub naming the server and its command — no `env` values |
| | `~/.codex/prompts/*.md` | `prompt`, one each |
| **Cursor** | `.cursor/rules/*.mdc`, `.cursorrules`, `~/.cursor/rules` | `memory` per rule file (strip the `globs`/`alwaysApply` frontmatter into the first line as *applies to: …*) |
| | `.cursor/mcp.json` | `connection` stub, no `env` values |
| **Gemini CLI** | `GEMINI.md` (home, project), `~/.gemini/GEMINI.md` | `memory` per heading; *Instructions* → `system_prompt` |
| | `~/.gemini/settings.json` → `mcpServers`, `contextFileName` | `connection` stub; the context file name is a Gemini detail — dropped |
| | `.gemini/commands/*.toml` | `prompt`, the `prompt` field as the file |
| **Aider** | `.aider.conf.yml` → `read`, `file` | the listed files' content → `memory` if they are conventions |
| | `CONVENTIONS.md` | `memory` per heading |
| **Pi** | `~/.pi/agent/AGENTS.md`, `prompts/`, `skills/` | as Claude Code's equivalents |
| **Any tool** | shell scripts the setup calls (`scripts/`, `bin/`, `Makefile` targets used by the agent) | `tool` — copy the script as `run`, write `TOOL.md` from its usage |

### What is not carried, and what to say instead

| Found | Do | Say |
| --- | --- | --- |
| API keys, tokens, `env` blocks, `apiKeyHelper`, anything that looks like a secret | **never copy the value**; note the alias it would need | *`OPENAI_API_KEY` was set in `config.toml` — keys live in a key vault here. Connect it under Providers → Set up (or Key vaults) and the alias `openai` reaches it.* |
| Model choice, provider URLs, `defaultModel`, profiles | drop | *Model routing is the organisation's; your team's default applies.* |
| Permission lists (`permissions.allow/deny`, `approval_policy`, `sandbox`) | drop, list them | *These are boundaries — an admin sets them on Boundaries for the team; here is what you had.* |
| Hooks, lifecycle scripts, `PreToolUse` commands | drop, name each | *A hook is arbitrary code run on every call; it is not carried. If it did one job, say which and it can become a tool.* |
| MCP servers | a `connection` stub: name, command/URL, **no env** | *Recorded as a connection; the runtime decides whether it can attach it.* |
| Runtime-specific syntax inside instructions (tool names, `/commands`, config paths) | rewrite into plain description | *"Use the Bash tool to run tests" → "Run the test suite before finishing."* |

### The report

End with three lists, in this order and these words, so it matches what
`harness import` prints:

```
Carried   memory/no-force-push        from ~/.codex/AGENTS.md § Git
          prompt/release-notes        from ~/.codex/prompts/release-notes.md
Partial   memory/style                from .cursor/rules/style.mdc — globs dropped, noted in the first line
Dropped   config.toml model           model routing is the organisation's
          config.toml mcp_servers.env values are secrets; alias needed: openai
```

Then: *These are under `~/.harness/assets/` and will be offered to keep when
this session ends. Nothing has been pushed.*

## Checking your work

- Every directory you made is `~/.harness/assets/<kind>/<name>/` with that
  kind's shape and no `asset.json`.
- No file under `~/.harness/assets/` contains a key, token or password.
- No asset names a specific runtime.
- The project directory holds only project changes.
