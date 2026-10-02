# Your first hour as an organisation admin

There is no wizard. You sign in to a shell with every screen already there,
and each screen's first-run notice is the next thing to do. Two of the
steps below are the ones that matter: after them, anyone on your
organisation can run a session. Everything after that is narrowing, not
setting up, so it is marked optional.

## Sign in

Open the console and sign in. From a terminal the same account works with
`harness login`. `harness whoami` says who you are, your role and which
organisation you are in.

## Turn on a runtime

Screen: **Providers**. Every runtime the platform knows — Pi, Claude Code —
is already a row here, and none of them is approved yet: the notice above
the table reads *No runtime is approved yet, so nobody can start a
session. Turn one on below.*

There is no picker. The row itself carries the switch: **Approve** a
runtime (or move it to beta, or decline it with a reason) directly in its
row. Approving Pi from a terminal is `harness providers approve pi`. Add
`--teams marketing,sales` to approve it for only some teams; without it,
every team gets it.

## Connect a model key

Still on **Providers**, the *Model providers* tab. The presets —
OpenRouter, Anthropic, OpenAI — are rows before any key exists, and a
row with no credential carries one verb: **Set up**. The notice above the
table reads *No key is connected yet, so a session has nowhere to send a
request. Set one up below.*

**Set up** asks for two things: paste the key, pick a default model. That
one action reaches every team and becomes the organisation's default —
there is nothing further to configure. From a terminal,
`harness keys add openrouter` does the same; it prompts for the key rather
than taking it as an argument, so it never lands in your shell history.

Once a runtime is on and a key is connected, `harness run pi` works for
anyone. What follows is optional.

## (Optional) Invite people and make teams

Screens: **People** and **Teams**. **Invite** adds someone to a team,
which is the grant itself — there is no separate permission to set
afterwards. **New sub-team** starts a team inside another; it begins
empty and inherits everything above it, so keeping something out of a
sub-team means placing that thing somewhere else. Neither has a terminal
equivalent yet; both are console-only.

## (Optional) Narrow who gets what

Screens: **Security groups** and **Boundaries**. A security group is a
named bundle of credentials a team is given; **New group** names one, and
**Narrow to a sub-team** hands part of a group a team already holds down
to one of its sub-teams, with only the entries you tick. A boundary is
something the assistant may never do, however it is running; **Add a
boundary** sets one for a team and everything below it — boundaries only
ever tighten on the way down. Both screens are console-only for now.

## Make the first team harness

Screen: **Harnesses**. **New harness** starts empty and inherits
everything the team already holds — nobody approves it, because it never
holds more than the team already has. From a terminal, naming a team is
what decides which branch it lands on:
`harness new "Weekly newsletter" --team marketing`.

Without `--team` (or `--org`, for every team), it lands on your own
branch and nobody else has it. The command answers exactly this — which
level did you just create this at — with one of three lines:

```
Created on your branch. Only you have it.  (`--team marketing` would make it Marketing's.)
Created on Marketing's branch. Everyone on Marketing inherits it.
Created on the organisation's branch. Every team inherits it.
```

then `harness switch` to pick it up.

## Check it

`harness setup` prints five lines against what your organisation actually
has: a runtime approved, a model provider with a key, a routing default
that reaches you, a security group granted, a harness you hold. Each is a
tick with the fact behind it, or a cross with the exact command that
closes it. It is the same five facts the console's own first-run notices
read — there is no second checklist to keep in sync with this one.
