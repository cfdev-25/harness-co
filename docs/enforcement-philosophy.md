# Enforcement Philosophy

Why the Harness is a boundary and not a suggestion, what that boundary can and
cannot cover, and the discipline that keeps our claims true.

This document has no line numbers and no version numbers on purpose. It should
still be correct in two years. Mechanism lives in
[`enforcement-architecture.md`](enforcement-architecture.md); the current
state of the code lives in [`enforcement-gaps.md`](enforcement-gaps.md).

## 1. Threat model

**In scope: the agent is the adversary.** The model may emit any tool call, any
shell command, any URL — by error, by jailbreak, or because content it read
told it to. Our job is to make the out-of-policy action *impossible*, not
discouraged.

**Out of scope: the user is the adversary.** A user with administrator rights
owns the machine. They can run upstream `pi` directly, skip the harness, edit a
profile, patch a binary. No local mechanism changes this, and the control plane
cannot attest that a sandbox is running. That is the customer's
endpoint-management problem, and we say so.

The product claim is therefore worded exactly this way:

> The agent cannot exceed the boundary.

Not "the user cannot." The first is defensible. The second is not.

## 2. Unreachability, not obfuscation

Obfuscation means "hard to find." It is not a security property. Anything the
agent can eventually locate, it can eventually use.

The property we rely on is that **no route exists**. The agent does not fail to
get around the boundary because it is confused about where the boundary is. It
fails because there is nowhere for the packet to go. It is fine — expected —
for the agent to know exactly how enforcement works.

On Linux the agent lives in a network namespace whose only interface is
loopback. On macOS a Seatbelt profile denies all networking except two loopback
ports. In both cases `curl evil.com` does not get *denied*; it gets
`connect(): no route to host`.

**Corollary: never describe a control as secure because it is hidden.** If the
only reason an attack fails is that the agent has not found the lever, we have
not built a boundary.

## 3. The metaphor

The agent works in a room with no windows and no phone. There is one mail slot
in the wall.

It can write whatever it likes, including "deliver this to evil.com." That
changes nothing: the slot is the only way out.

On the other side sits a **clerk**:

| The clerk does | In system terms |
| --- | --- |
| Checks each envelope's address against the approved list; destroys the rest | destination allowlist from the resolved boundary |
| Accepts unstamped letters and adds company letterhead and postage | credential attached by the proxy; the agent never holds one |
| Keeps a record of every envelope that passed | the authoritative audit log |

What people miss:

- **The walls enforce, not the clerk.** The clerk is policy. If the clerk
  vanished the agent would have *no* mail — not unrestricted mail. That is what
  fail-closed means.
- **The clerk is outside the room.** Not hidden. On the far side of a wall.
- **The agent has no postage.** It cannot leak what it was never given.

And what the metaphor conceals: a clerk who stamps anything handed to it is a
**signing oracle**. Not holding the stamp is not the same as not being able to
use it. §6 and §7 exist because of this.

## 4. Four rules

1. **Enforcement lives outside the jail.** In-process code runs at the agent's
   privilege; another extension can undo it, `bash` can route around it. The
   extension layer is UX. The boundary must hold with no extension loaded.

2. **The unit of confinement is the whole agent process.** Not the bash tool.
   `bash` can spawn anything, and the agent's own HTTP client is a process like
   any other.

3. **Fail closed, and the failing-closed is ours.** The sandbox runtime we use
   degrades gracefully when helpers are missing; that is the correct behaviour
   for a developer tool and the wrong behaviour for us. Every degraded start is
   a failed start. No flag disables the sandbox. No callback turns a denial into
   a question.

4. **The agent holds nothing.** No token, no key, no inherited environment. Not
   "a scoped token" — nothing. Everything that must talk to the control plane
   is the supervisor's job, and the supervisor is outside the wall. The
   strongest credential in this system is the one that can ask for all the
   others, and the surest way to keep it from the agent is to have no version
   of it inside at all.

## 5. Structural versus semantic

Sort every proposed control into one of two piles. The pile decides what we may
promise.

**Structural** — about where traffic goes and what is attached to it. Reliable,
because the proxy observes it directly.

- allow or deny by destination
- constrain the *shape* of a request — method, path, headers
- attach a credential the agent does not possess
- log every request

**Semantic** — about what traffic *means*. Best effort, always.

- "linting requests for safety"
- judging whether an allowed destination is receiving something it should not

The proxy can say with certainty that a request is bound for `evil.com` and
stop it. It cannot say whether a request to an approved destination carries
something harmful. Confusing the two piles is how a product comes to claim a
boundary while shipping a suggestion.

## 6. The two hard problems

The network boundary solves neither. Any honest description of the product
names both.

### Prompt injection is the delivery mechanism

The realistic path to a malicious action is not a user misbehaving. It is
content the agent read. For us that includes the repository, tool output, and —
uniquely — **team memories and skills served from our own control plane**. A
careless or compromised teammate edits a memory and every agent downstream in
the org tree inherits the instruction. Asset linting checks references, not
prose, and prose is not checkable.

The mitigation is not detection. It is that **injection cannot escalate**. An
agent that holds nothing and has one exit gains the attacker nothing beyond
what the boundary already allows. That is the entire point of the boundary.

### Exfiltration goes through allowed destinations

Allowlisting stops `evil.com`. It does nothing about the harder case: every
allowed host is a two-way channel, and the model provider is an accepted,
unavoidable one — everything the agent reads goes there by construction.
`git push` to an attacker's repository on an allowed forge is the canonical
example.

The control is structural and it is the same control as scope reduction: a
per-connector allowlist of request *shapes*, constraining where writes may go
and not only what may be read. Read-only enforcement and exfiltration control
are one feature seen from two sides.

## 7. Scope reduction and its limits

Because the agent speaks plaintext to the proxy and the proxy opens the
upstream TLS session, the proxy is the HTTP endpoint. It sees method, path,
headers, body. Where intent lives in the request shape, enforcement is real:
refuse every non-`GET`, and read-only is genuine against most REST APIs.

It breaks where intent moves into the body — GraphQL, RPC-style endpoints,
batch calls carrying mixed operations — or where a provider serves both on one
host with one credential.

**We enforce scope exactly as well as we have modelled that specific API.**
Generic "read-only for any credential" is not a promise we can keep, and we do
not make it.

Where a provider will issue a narrower credential on request — a cloud role
with a session policy, an app installation token with a permissions subset, a
token exchange at an authorization server that supports one — prefer that to
filtering. The provider's own authorization then enforces the scope, and
nothing we do or fail to do can exceed it.

| Mechanism | Enforced by | Strength |
| --- | --- | --- |
| Provider-issued narrow credential | the provider's authorization | Cannot be exceeded by us or the agent |
| Request-shape allowlist, per connector | us | Real — as good as our model of that API |
| Request-body inspection | us | Workable, brittle, ongoing maintenance |
| Instructing the model to behave | nobody | Not a control |

## 8. Detection where prevention is unavailable

Where prevention is impossible, every request still crosses the proxy. We
retain attribution within seconds — which asset, which session, which user,
which org unit. "We cannot prevent this write, but you will know immediately
and the credential can be revoked" is a real control, and one most of the
market cannot offer because it never sees the traffic.

Prevention where the shape allows it. Provider downscoping where it exists.
Honest detection everywhere else.

## 9. Honest limits

1. Local enforcement binds the agent, not the user. High-assurance deployments
   need a remote gateway or server-side execution.
2. The sandbox runtime's own destination filter matches the hostname the client
   *claims*, not the name inside the TLS handshake, and it does not restrict
   ports. Domain fronting through an allowed CDN is a known bypass of hostname
   filtering. Our proxy must do better than the runtime's; until it does, the
   honest claim is "destination allowlist, fronting-vulnerable."
3. Filesystem reads are allowed by default in the runtime. The deny set is a
   standing obligation, not a default.
4. Writes outlive the session. A build script the agent wrote runs *outside*
   the sandbox the next time the user builds, with the user's full credentials.
   "The agent cannot exceed the boundary" is true per-session and false
   per-artifact. We do not claim protection against artifacts the user later
   executes.
5. A credential-attaching proxy on a shared loopback interface is a confused
   deputy unless it authenticates its callers. Not holding a key is not the
   same as not being able to use one.
6. Semantic controls are advisory. Never describe one as a boundary.
7. Anything reported from inside the jail is attested telemetry. The audit log
   is authoritative only at the proxy.
8. We provide no isolation between concurrent sessions of one OS user beyond
   the sandbox profile itself.
9. Windows has no implementation. It fails closed and says so.
10. Team tools are code published by teammates and run at the agent's
    privilege inside the jail. That is safe *because* it is inside. Any future
    tier that runs a tool outside the jail is running teammate-published code
    with the user's privilege, and is exactly as safe as the admin approval
    that gated it — no more.

## 10. Absent is not empty

Three states, and conflating the first two is how a boundary rollout becomes
an outage:

| State | Meaning | Enforcer |
| --- | --- | --- |
| **absent** (`null`) | nobody in the chain wrote a policy | no restriction |
| **empty** (`[]`) | a policy was written and permits nothing | deny everything |
| **populated** | a policy was written | allow exactly these |

`merge_boundaries` returns `null`, not `[]`, when no unit in the chain defined
a field. This is the same rule Kubernetes NetworkPolicy uses: no policy selects
you and you are unrestricted; the moment one does, only what it lists is
allowed. Default-deny applies to a *governed* resource, not to one nobody has
governed yet.

The alternative — treating absent as deny — means the day egress enforcement
ships, every org that never wrote a policy loses all network at once. That is
not a safe default; it is a synchronised outage.

Anything that displays a boundary must keep the distinction visible.
`harness doctor` prints `(not set — unrestricted)` against `none permitted`,
and marks each line `enforced` / `advisory` / `not enforced yet`, so nobody
reads a delivered policy as an applied one.

## 11. Review checklist

Before shipping anything that claims to constrain an agent:

- [ ] Does the jail contain any credential at all — including inherited shell
      variables?
- [ ] Does it create a second way out?
- [ ] Does it fail closed, with no flag, fallback, or degraded mode?
- [ ] Does it live outside the jail?
- [ ] Would it hold if the agent knew exactly how it worked?
- [ ] Would it hold with no extension loaded?
- [ ] Is it structural, or semantic dressed as structural?
- [ ] Can the control point be used as an oracle by something that lacks the
      credential?
- [ ] For scope reduction: have we modelled this API, or are we guessing?
- [ ] Is the claim worded "the agent cannot," never "the user cannot"?
