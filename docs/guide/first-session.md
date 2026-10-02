# Your first session

For someone who has never installed Pi or anything related, on a **personal
account**. Eight steps, none of them a wizard: the account page keeps the
same list with live state, and each step closes itself the moment you do it.

If you are the admin of an organization other people will join, read
[`first-hour-admin.md`](first-hour-admin.md) instead. If you are building on
the repository rather than using it, [`install.md`](install.md) is the
developer path — the same five commands, by hand, with the stack running.

## 1. Sign up

Open the site and choose **Personal**. Enter the access code you were given
(there is no public sign-up yet, and a wrong code says only that it is
wrong), then your email and a password.

That makes you an organization of one: you are your own admin, every
runtime is already approved, and nothing is waiting on anybody. You land on
**Harnesses**, which is empty.

## 2. Install the CLI

Screen: **Account**. The page opens with *Getting started* — four rows with
a tick or one thing to do. The first two are links, both to the same place:
**How this works** → *Set up*, five numbered cards you work through once per
machine. They are printed there and nowhere else, because the third one
carries your console's API address and a token, and a command in two places
is two commands the day one of them changes.

Card 1 is the one step the page cannot take for you: **open a terminal**. It
prints the keystroke for the machine it thinks you are on — on macOS ⌘ Space,
type Terminal, Enter — with a control beside it if the guess is wrong.

Card 2 is the install command, served from the site you are reading:

```
curl -fsSL https://theharnessmanager.com/install.sh | sh
```

> **The script needs a public repository.** The console serves
> `install.sh` itself, so that URL answers as soon as the site is deployed.
> The script then `git clone`s the repository, which must be **public** for
> that to work without a password. Until it is, clone the repository you
> have access to and run `scripts/install.sh` from it, or follow
> [`install.md`](install.md).

It needs two things on the machine and says exactly how to get either if it
is missing: `git` (on macOS, `xcode-select --install`) and Node 22 or newer
(`brew install node`, or <https://nodejs.org>). Then it clones the
repository to `~/.harness/cli`, installs and builds the CLI and the
vendored Pi runtime, and links `harness` onto your `PATH`. No `sudo`, and
nothing outside your home directory. Running it again updates in place.

It takes a few minutes the first time — most of it building Pi. When it is
done it prints the next three things, which are steps 3, 5 and 6 below.

`harness commands` prints the whole sheet once it is installed.

## 3. Sign in

Screen: **How this works** → *Set up*, card 3. The line is already written for
you except for the token: press **Generate a token** and it is pasted into
the line, which you then copy whole — `harness login` with this console's API
address and that token on it. It is the only time the token is shown, so copy
the line before you leave the page; generating another is a button press.

`harness whoami` says who you are and what you already hold. The *Sign in*
row on the account page ticks itself.

Card 4 of *Set up* is `harness setup`, which registers the `harness://` link
on this machine — step 6 below is what needs it. **Account** keeps a
*Command-line access* card for tokens you want to name yourself, one per
machine.

## 4. A model

A session needs a model, and there are two ways to have one. Pick either.

**Paste a key.** The *A model* row's **Set up** link goes to **Providers** →
*Model providers*. The presets — Anthropic, OpenAI, OpenRouter — arrive with
their upstream, header and wire format already filled in; **Set up** on one
asks for the key and the model. On a personal account that write also makes
that provider your default and hands it to you, so there is nothing else to
do afterwards. From a terminal the same step is `harness keys add openrouter`.

**Or sign in to Pi instead.** `harness auth pi` runs Pi's own login, outside
the sandbox, and signs you in to Claude or ChatGPT with the account you
already pay for. Sessions then run on that sign-in and are marked not
metered. One thing to know: a sign-in session talks to the provider
directly over TLS, so provider-side browsing cannot be stripped out of the
request the way it is for a keyed session — what the machine itself may
reach still holds either way.

Either one ticks the row. Doing both is fine: the key is what the harness
routes, the sign-in is what Pi falls back to.

## 5. Your first harness

Screen: **Harnesses**, **New harness**. On a personal account the dialog
asks two things beyond the name, description and drawing:

- **Web access** — a switch, on or off. Off means the session reaches the
  model provider and nothing else; on means it reaches the web. It is set
  for this harness alone and nothing at your organization changes.
- **Outside keys** — which of your keys this harness may use, with *None*
  first and chosen already. *None* is the right answer for a first harness.

One line under the switch says which model the session will run on — your
default, or *add a key or sign in to Pi first* with the link back to step 4.
It is read-only there; the model is not a per-harness choice.

Press the button and the card appears.

## 6. Open it

The card has a button per runtime that could actually start it — **Open in
Pi**. Pressing it hands your operating system a link
(`harness open harness://run?harness=<id>&provider=pi` is the same thing by
hand), which the CLI answers with a normal system dialog: an existing folder
or a new workspace, then which folder. It creates the folder if you asked
for one, opens a terminal in it, and starts the session.

For that to work the link type has to be registered on the machine, which is
what `harness setup` does — once, per user, no password. A web page cannot
tell whether it worked, so if nothing happens when you press the button, run
`harness setup` and press it again; [`install.md`](install.md) has the other
four reasons.

Typing it yourself is `harness switch` to pick the harness, then
`harness run pi`. The last thing you see before Pi's own interface is the
harness itself:

```
                     weekly-newsletter
       █▀▀▀██        yours
    █▀▀▀▀██▀█   █
    █▀▀▀▀████  ▄█    delivers  1 skill
      ▄▄████▀█▀██    model     anthropic · claude-opus-5
        █▀▀██▀█▀     reach     off
          ▀█▀█       in        /Users/you/newsletter
        ▀▀▀▀▀

                     Starting Pi…
```

The drawing is the harness's own. *delivers* counts what the session was
given; *reach* is how far it can connect — *off* is the switch you left off
in step 5; *in* is the folder you started in.

Some of what you were given is the **brief**: a short system prompt the
assistant is handed before your first message. Ask it *what were you told
before this conversation?* and it will say.

## 7. When you are done

Leaving the session (Ctrl-C, or Pi's own exit) runs the exit review. It is
the frame you started on, with what changed under it:

```
                     weekly-newsletter
       █▀▀▀██        yours
    █▀▀▀▀██▀█   █
    █▀▀▀▀████  ▄█    delivers  1 skill
      ▄▄████▀█▀██    model     anthropic · claude-opus-5
        █▀▀██▀█▀     reach     off
          ▀█▀█       in        /Users/you/newsletter
        ▀▀▀▀▀

                     skill/newsletter-voice  +2 −0
                     prompt/standup          made this session

                     Keep these as yours? [a]ll / [n]one / [p]ick
```

`+2 −0` is lines added and removed. *made this session* is a directory the
assistant created that has no identity yet; keeping it mints one.

`[a]ll` keeps every change on your own branch — on a personal account there
is nobody to review it. `[n]one` discards nothing and pushes nothing; the
files stay exactly as the session left them. `[p]ick` asks which, one at a
time.

The session appears on **Logs**, tab *Sessions*, within a few seconds, with
its preflight report and everything it reached.

## 8. The list is gone

Once all four rows are ticked, *Getting started* removes itself from
**Account**. Nothing replaced it: the screens were all there the whole time.

## If it refuses

- **No model.** *No model provider is approved.* — step 4; you are the admin,
  so there is nobody to ask.
- **A host was refused.** A session with **Web access** off reaches the model
  provider and nothing else, and the refusal names the rule that refused it.
  Turn the switch on for that harness, or add the host under **Boundaries** →
  *Reach*.
- **Nothing happened when you pressed the button.** `harness setup`.

`harness preflight` (alias `doctor`) checks all of this before you spend the
time starting a session, and `harness status` says what the next session
would be given.
