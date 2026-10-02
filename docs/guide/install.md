# Install

Harness is not published to a registry yet. It runs from a checkout: the
CLI, the console and the API are one repository, and the Pi runtime is
vendored inside it at a pinned commit. These steps were run on macOS on
28 September 2026; Linux is the same, Windows is not supported yet
(engine 06 §9a).

**This is the developer path** — the whole stack, by hand. If you only want
the CLI on a machine, `scripts/install.sh` is these five commands with the
checks in front of them, and [`first-session.md`](first-session.md) is the
walkthrough that starts with it (W7-D6).

The console serves that script from its own origin — `npm run prebuild` in
`web/` copies `scripts/install.sh` to `web/public/install.sh` before every
build, so the line *How this works* → *Set up* prints is
`curl -fsSL https://theharnessmanager.com/install.sh | sh`. The script is
the one source; the copy under `public/` is a build artefact and is
gitignored.

> **The repository must be public.** Serving the script is not enough: the
> script `git clone`s `https://github.com/cfdev-25/harness-co`, so on a
> private repository `git clone` asks a stranger for a password and the
> install stops there. Make the repository public before pointing anyone at
> the `curl` line, or set `HARNESS_REPO` to a checkout they can reach.

## What you need

- Node 22.19 or newer (`.nvmrc` says which) and `npm`
- [uv](https://docs.astral.sh/uv/) for the Python backend
- `git`
- `backend/.env` and `web/.env` — the Supabase keys and the two service
  values (`HARNESS_SERVICE_TOKEN`, `DEFINITIONS_URL`). They are not in git;
  `docs/supabase-migration-plan.md` §7.1 says where each comes from.

## Five commands

```
git clone <this repository> harness-co && cd harness-co
npm install                       # workspaces: engine/*, web, dev tooling
(cd backend && uv sync --all-groups)
npm run build                     # engine, the vendored Pi bundle, the console
npm link -w engine/cli            # puts `harness` on your PATH
```

`npm run build` is the long step: it builds `engine/compose`, `engine/cli`
and `engine/definitions`, then Pi's bundle (`pi/packages/coding-agent/
dist/bundle/cli.js`, which `harness run pi` locates by absolute path from
the checkout), then the console. The CLI alone is
`npm run build -w engine/compose -w engine/cli`, but the first `harness run pi` still
needs the Pi bundle.

`npm link -w engine/cli` symlinks `harness` into your Node prefix's `bin`
(`which harness` shows where). Because it is a link into the checkout, a
rebuild is picked up without relinking. To remove it: `npm unlink -g
@harness/cli`.

Check:

```
harness --version        # 0.1.0
harness commands         # the sheet
```

## Start the stack

```
npm run dev
```

One terminal, three services with log prefixes: `[api]` on 8400,
`[definitions]` on 8402, `[web]` on 3000. `definitions` runs from `dist/`
and does not hot-reload — after `npm run build -w engine/definitions`,
restart `npm run dev`. The ports are fixed and reclaimed on start.

If `[api]` dies in its lifespan with `socket.gaierror`, the database host in
`backend/.env` is the IPv6-only direct host and your network has no IPv6
route; use the session pooler URL instead (`docs/build-decisions.md`,
2026-09-28).

## Sign in from the CLI

1. Open `http://localhost:3000`, sign in, and go to **Account** →
   *Command-line access* → **Create an access token**. Name it after the
   machine. It is shown once.
2. `harness login` — paste the token. The API is `http://localhost:8400`
   unless you pass `--api-url`.
3. `harness whoami` — your organization, team and role.

`harness login` keeps the token in `~/.harness/credentials.json`
(`HARNESS_HOME` moves the whole directory). Nothing else is written outside
that directory.

## Opening a session from the console

`harness setup` also registers the `harness://` link type for your login,
so the **Open in …** buttons on a harness card start a session on this
machine. It is per user and needs no password: on macOS it writes a small
application at `~/Applications/Harness.app` and registers it with
LaunchServices; on Windows it writes `HKCU\Software\Classes\harness`; on
Linux it writes `~/.local/share/applications/harness.desktop` and runs
`xdg-mime default`. Running `harness setup` again changes nothing.

Clicking a button opens a link like
`harness://run?harness=<id>&provider=pi`. Your operating system hands it to
the CLI, which asks — in a normal system dialog, because there is no
terminal yet — **Open an existing folder** or **Create a new workspace**,
then for the folder, then for the new folder's name. It creates the folder
if you asked for a new one and opens a terminal in it running the session —
the same thing as typing `harness run pi` there with that harness selected.
A card that already knows where you last ran it offers *Open again in …*,
which skips the question. Closing any dialog stops there and starts nothing.

**Nothing happened when you clicked?** A web page cannot tell whether the
CLI is installed, so it cannot warn you — it can only draw the link.

- The CLI is not installed or not registered: run `harness setup`.
- You rebuilt or moved the checkout: the registration names the exact paths
  of `node` and `dist/cli.js`, so run `harness setup` again after moving it.
- You are not logged in: the dialog says so. `harness login`.
- Linux with no `zenity` and no `kdialog`: there is nothing to draw the
  folder picker with, so the CLI prints the exact command to run by hand
  instead. Install `zenity`.
- macOS may ask, once, whether *Harness* may open the link. Allow it.

To take it off a machine: `harness setup --unregister`. It needs no login
and works with the API down.

## Then

- An organization admin: [`first-hour-admin.md`](first-hour-admin.md), or
  just `harness setup`, which prints the same five steps with the command
  that closes each.
- Everyone else: [`first-session.md`](first-session.md) — sign up, a model,
  a first harness, `harness run pi`, the exit review. It assumes
  `scripts/install.sh` rather than these five commands; the result is the
  same checkout.
- Already running Claude Code by hand: `harness import claude` reads its
  setup into assets and a harness on your own branch and prints what was
  carried, what came across partial, and what was dropped. Nothing is
  pushed. Then `harness switch` and `harness run claude`.
