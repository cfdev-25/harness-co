# Guides

An install page and two walkthroughs for the two people who open Harness
for the first time:

- [`install.md`](install.md) — the developer path: from a checkout to
  `harness` on your PATH and the stack running; where the access token
  comes from.

- [`first-hour-admin.md`](first-hour-admin.md) — whoever just created the
  organization: turn on a runtime, connect a model key, and everything
  after that which is optional.
- [`first-session.md`](first-session.md) — someone who has never installed
  Pi or anything related, on a personal account: sign up, one install
  command (`scripts/install.sh`), sign in, a model, a first harness, the
  exit review. It is the account page's *Getting started* list written out
  (W7-D5, W7-D6).

Every command here is a row of the command sheet
(`docs/console/05-in-platform-docs.md` §6) and every screen name is a
sidebar entry (`web/app/(console)/shell/nav.ts`) — checked by
`web/test/unit/guides.test.ts` on every change.
