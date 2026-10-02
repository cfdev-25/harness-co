#!/bin/sh
# Harness — one command installs the CLI (W7-D6).
#
#   curl -fsSL https://theharnessmanager.com/install.sh | sh
#
# The console serves this file: `npm run prebuild` in `web/` copies it to
# `web/public/install.sh`, so the line above points at the site the person is
# already reading. This file stays the one source; that copy is a build
# artefact and is gitignored. The clone below still comes from GitHub, so the
# repository must be public for a stranger — see `docs/guide/install.md`.
#
# Harness is not published to a registry: the CLI, the console and the API are
# one repository and the Pi runtime is vendored inside it at a pinned commit,
# which `engine/cli/src/paths.ts` finds relative to the checkout. So installing
# *is* cloning, and this script is the five commands of `docs/guide/install.md`
# with the checks in front of them.
#
# POSIX sh. No sudo: everything is written under $HOME and into the Node prefix
# the person's own `npm` already uses. Idempotent: run it again to update.
#
# Environment, for testing and for a fork:
#   HARNESS_REPO      the repository to clone (default: the one above)
#   HARNESS_CLI_DIR   where to put it (default: ~/.harness/cli)

set -eu

REPO="${HARNESS_REPO:-https://github.com/cfdev-25/harness-co}"
DIR="${HARNESS_CLI_DIR:-$HOME/.harness/cli}"
NODE_MIN=22

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

# --- what you need ----------------------------------------------------------
#
# Both checks print exactly how to get the thing and stop. A half-installed
# checkout is worse than none: the person would meet the same error later,
# further from the cause.

# `git --version`, not `command -v git`: macOS ships a `/usr/bin/git` shim that
# exists on a machine with no developer tools and fails the moment it is used,
# so *present* is the wrong question and *works* is the right one.
if ! git --version >/dev/null 2>&1; then
	say "harness needs git, and it is not installed."
	say ""
	if [ "$(uname -s)" = "Darwin" ]; then
		say "  Install it with:  xcode-select --install"
	else
		say "  Install it with your package manager, e.g.:"
		say "    apt install git     (Debian, Ubuntu)"
		say "    dnf install git     (Fedora, RHEL)"
	fi
	say "  Or download it from https://git-scm.com/downloads"
	exit 1
fi

if command -v node >/dev/null 2>&1; then
	NODE_VERSION=$(node -v)
	NODE_VERSION=${NODE_VERSION#v}
	NODE_MAJOR=${NODE_VERSION%%.*}
else
	NODE_VERSION=""
	NODE_MAJOR=0
fi

if [ "$NODE_MAJOR" -lt "$NODE_MIN" ]; then
	if [ -z "$NODE_VERSION" ]; then
		say "harness needs Node $NODE_MIN or newer, and Node is not installed."
	else
		say "harness needs Node $NODE_MIN or newer. This machine has $NODE_VERSION."
	fi
	say ""
	if [ "$(uname -s)" = "Darwin" ]; then
		say "  Install it with:  brew install node"
	fi
	say "  Or download it from https://nodejs.org (take the LTS build)."
	exit 1
fi

command -v npm >/dev/null 2>&1 || fail "node is installed but npm is not; reinstall Node from https://nodejs.org"

# The last step is `npm link`, which writes into the global prefix — and a Node
# installed from the nodejs.org package puts that under /usr/local, which a
# normal account cannot write to. Checked here, not there: there is no `sudo`
# in this script, and finding out after the Pi build is the half-installed
# checkout the comment above refuses.
PREFIX=$(npm prefix -g 2>/dev/null || true)
PROBE="$PREFIX"
while [ -n "$PROBE" ] && [ "$PROBE" != "/" ] && [ ! -d "$PROBE" ]; do
	PROBE=$(dirname "$PROBE")
done
if [ -n "$PROBE" ] && [ ! -w "$PROBE" ]; then
	say "npm would link harness into $PREFIX, which this account cannot write to."
	say ""
	say "  Point npm at your home directory instead, then run this again:"
	say ""
	say "    npm config set prefix \"\$HOME/.npm-global\""
	say "    export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
	say ""
	say "  Add that PATH line to your shell profile so it survives a new terminal."
	exit 1
fi

say "git $(git --version | cut -d' ' -f3) · node $NODE_VERSION"

# --- the checkout -----------------------------------------------------------

if [ -d "$DIR/.git" ]; then
	step "Updating $DIR"
	git -C "$DIR" pull --ff-only
elif [ -e "$DIR" ]; then
	fail "$DIR exists and is not a git checkout. Move it aside, or set HARNESS_CLI_DIR."
else
	step "Cloning $REPO into $DIR"
	mkdir -p "$(dirname "$DIR")"
	git clone "$REPO" "$DIR"
fi

cd "$DIR"

# --- build ------------------------------------------------------------------
#
# Two installs and two builds, not the root `npm run build`: the root script
# also builds the console (`web/`), which needs environment this machine has no
# reason to hold and which nobody runs on their own laptop. The person needs
# the CLI and the runtime it spawns, so this builds `engine/*` — whose
# workspaces the root install covers — and the vendored Pi bundle, which has
# its own `node_modules` because `pi/` is not a workspace of the root.

step "Installing dependencies (engine)"
npm install

step "Building the CLI"
npm run build -w engine/compose -w engine/cli -w engine/definitions

step "Installing dependencies (the vendored Pi runtime)"
npm --prefix pi install

step "Building the Pi runtime — the long step"
npm --prefix pi run build:offline

step "Putting harness on your PATH"
npm link -w engine/cli

# --- what next --------------------------------------------------------------

step "Installed."
if ! command -v harness >/dev/null 2>&1; then
	say ""
	say "harness is linked into $(npm prefix -g)/bin, which is not on your PATH."
	say "Add it to your shell profile, then start a new terminal:"
	say ""
	say "  export PATH=\"$(npm prefix -g)/bin:\$PATH\""
fi
say ""
say "Three things, in order:"
say ""
say "  1. harness login    paste the access token from the console:"
say "                      Account → Command-line access → Create an access token"
say "  2. harness setup    registers the harness:// link type, so the console's"
say "                      buttons can open a session on this machine"
say "  3. open your first harness from the console — the card's button asks for"
say "     a folder and opens a terminal running the session in it"
say ""
