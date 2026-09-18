export const VERSION = "0.1.0";

const USAGE = `harness — run a coding agent under your team's policy

Usage
  harness [run] [-- <agent args>]        Start a session (default command)
  harness login --token <token>          Save your credentials
  harness switch [name]                  Choose the harness your sessions run in
  harness whoami                         Show who you are and where you sit
  harness pull                           Fetch your team's assets without a session
  harness status                         Compare your assets with your team's
  harness doctor [section]               Show what the server sent you
  harness push <path> --message <msg>    Publish an asset to your profile
  harness reset <kind>/<name>            Discard your changes to one asset
  harness adopt <path>                   Take a local directory under management
  harness resolve --json                 Print the resolved manifest
  harness man                            The long version
  harness --help                         This help
  harness --version                      Print the version

Getting started
  Open the web console, click "CLI token", and paste the two commands it gives
  you. You only do this once per machine — the CLI stays signed in.
`;

const MANUAL = `harness(1)

NAME
  harness — run a coding agent under your team's policy

DESCRIPTION
  Your team keeps its skills, memories, tools, and provider connections in one
  place. "harness run" fetches what you are entitled to, lays it out on disk,
  and starts the agent against it. Nothing is installed permanently and no
  secret is written into the session.

HARNESSES
  A harness is the job you sit down to do: a named list of the prompts,
  memories, skills and tools that job needs, with a description and a small
  drawing. Switching harnesses swaps what the assistant has in front of it.

    harness switch              pick from your list
    harness switch support      pick by name
    harness switch --none       load everything you have

  A harness holds only what was put in it, and the web console is where
  things are put in. With no harness selected you get everything you have,
  which is how sessions worked before harnesses existed.

  A harness holds things by name, so if you write your own version of one of
  them you keep yours, in the same harness, and nobody has to reassign it.

  Switching changes nothing on your machine. You keep every asset your team
  has given you whichever harness you are in, so "harness pull", "status",
  "push" and "reset" behave the same in all of them — only what a session
  loads changes. "harness doctor harness" shows where you are and how much
  is in it.

YOUR OWN BRANCH
  The copy on your machine is yours. Edit it freely — the next session will
  never overwrite a file you changed.

    harness status        what you have changed
    harness push <path>   publish your version to your own profile
    harness reset <k/n>   throw yours away, take the team's

  A pushed asset shadows the team's copy for you and nobody else. When it is
  good, an admin promotes it in the web console and everyone gets it at their
  next session. If your override is in effect and the team's version moves on,
  "harness run" tells you.

  Assets live in ~/.harness/assets and are tracked with git, so "git log" and
  "git diff" work on them:

    git --git-dir=~/.harness/assets.git --work-tree=~/.harness/assets log

CHECKING WHAT YOU RECEIVED
  "harness doctor" prints everything the server decided for you: who you are,
  the merged boundary, the model, every asset with its version, the state of
  your local copy, and the exact environment the agent is given. Use it to
  confirm a change made in the web console reached your machine.

    harness doctor                  everything
    harness doctor boundary         one section
    harness doctor boundary model   several
    harness doctor --json           the raw manifest

  Sections: identity, harness, boundary, model, assets, local, env.

  Secret values are never shown because they are never sent here. You will see
  a key's reference and the variable it arrives as, never the key itself.

CONFLICTS
  Two, and both are surfaced rather than guessed at.

    You changed an asset and the team changed it too. Your copy is kept.
    "harness push" keeps yours; "harness reset" takes theirs.

    Someone else pushed to the same asset before you. "harness push" shows
    both messages and asks. With no terminal attached it stops instead.

FILES
  ~/.config/harness/credentials.json   your login. Nothing else reads it.
  ~/.harness/harness.json              the harness you switched to
  ~/.harness/assets/                   your working copy of team assets
  ~/.harness/assets.git/               its history
  ~/.harness/sessions/<id>/            one session. Removed when it ends.

ENVIRONMENT
  HARNESS_HOME          override ~/.harness
  HARNESS_CREDENTIALS   override the credential path

SIGNING IN
  Once per machine. "harness login" stores a token and every later command
  reuses it. To sign out, or to start completely fresh:

    rm -rf ~/.config/harness        forget the login
    rm -rf ~/.harness               forget the local copy of team assets

  Nothing you pushed is lost either way; it lives on the server.

SEE ALSO
  The web console's Docs section explains the same ideas without a terminal.
`;

export function help(): number {
	console.log(USAGE);
	return 0;
}

export function manual(): number {
	console.log(MANUAL);
	return 0;
}
