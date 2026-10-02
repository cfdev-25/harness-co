import { expect, test } from "@playwright/experimental-ct-react";
import { PeopleVerbs } from "@/app/(console)/console/[scope]/people/_invite";
import { PersonTable } from "@/app/(console)/console/[scope]/people/_table";
import { PersonVerbs } from "@/app/(console)/console/[scope]/people/[id]/_verbs";
import { PEOPLE, PEOPLE_TEXT } from "@/content/screens/people";
import { records } from "./writes";

const TEAM = "acme.marketing";

test("invite_posts_team_and_email", async ({ mount, page }) => {
  const sent = await records(page);
  const verbs = await mount(<PeopleVerbs team={TEAM} members={[]} teams={[]} />);

  await verbs.getByRole("button", { name: "Invite" }).click();
  await verbs.getByLabel(PEOPLE_TEXT.inviteEmail).fill("jo@acme.example");
  await verbs.getByRole("button", { name: PEOPLE_TEXT.inviteSubmit }).click();

  // `POST /v1/org-units/{uuid}/invites` takes a UUID the console never holds;
  // `POST /v1/invites` resolves an id *or* a dotted path (`unit_by_id_or_path`).
  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/invites", body: { team: TEAM, email: "jo@acme.example" } },
  ]);
});

test("subteam_posts_parent_path", async ({ mount, page }) => {
  const sent = await records(page);
  const verbs = await mount(<PeopleVerbs team={TEAM} members={[]} teams={[]} />);

  await verbs.getByRole("button", { name: PEOPLE_TEXT.subTeamTitle }).click();
  await verbs.getByLabel(PEOPLE_TEXT.subTeamName).fill("Interns");
  await verbs.getByRole("button", { name: PEOPLE_TEXT.subTeamSubmit }).click();

  // `TeamIn.parent_id` is typed `UUID`; `parent` is the field built for a path.
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/org-units",
      body: { kind: "team", parent: TEAM, name: "Interns" },
    },
  ]);
});

test("appoint_admin_puts", async ({ mount, page }) => {
  const sent = await records(page);
  const verbs = await mount(
    <PersonVerbs
      personId="6f1c0b6e-0000-4000-8000-000000000001"
      name="Jo Adeyemi"
      teamPath="acme.marketing.interns"
      unitPath="acme.marketing.interns.jo"
      admin={false}
      orgAdmin
      visibility={{ boundaries: true, logs: true }}
      preview={{ loses: [], rotate: [] }}
    />,
  );

  await verbs.getByRole("button", { name: PEOPLE.verbs.appointAdmin.label }).click();

  // The route keys on an org unit, and the team is the person's *direct* one
  // — `PersonRow.team`, not the widest ancestor the chain happens to sort first.
  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/org-units/acme.marketing.interns/admins/6f1c0b6e-0000-4000-8000-000000000001",
      body: { level: "admin" },
    },
  ]);
});

test("invite_at_org_scope_requires_team_and_sends_it", async ({ mount, page }) => {
  const sent = await records(page);
  // At `/console/org/people` the scope is the organisation, so `team` is the
  // org path and `POST /v1/invites` refuses `invite_target_not_team`. The
  // field is the page's teams, and it is only there at this scope.
  const verbs = await mount(
    <PeopleVerbs
      team="acme"
      members={[]}
      teams={[
        { path: "acme.marketing", name: "marketing" },
        { path: "acme.research", name: "research" },
      ]}
    />,
  );

  await verbs.getByRole("button", { name: "Invite" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("combobox", { name: PEOPLE_TEXT.inviteTeam }).selectOption("acme.research");
  await modal.getByLabel(PEOPLE_TEXT.inviteEmail).fill("jo@acme.example");
  await modal.getByRole("button", { name: PEOPLE_TEXT.inviteSubmit }).click();

  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/invites", body: { team: "acme.research", email: "jo@acme.example" } },
  ]);
});

test("cancel_invite_deletes", async ({ mount, page }) => {
  const sent = await records(page);
  // Through the table, because the verb is the row's: an invited row carries
  // `invite` and no id, and it is the only handle withdrawing it names.
  await mount(
    <PersonTable
      rows={[
        {
          id: "", invite: "1f0d9a2c-0000-4000-8000-000000000009", name: "",
          email: "jo@acme.example", team: TEAM, unit: TEAM,
          teams: { unit: "teams", items: [] }, role: { scale: "role", value: "member" },
          state: "invited",
        },
        {
          id: "6f1c0b6e-0000-4000-8000-000000000001", name: "Ada Lovelace",
          email: "ada@acme.example", team: TEAM, unit: `${TEAM}.ada`,
          teams: { unit: "teams", items: [] }, role: { scale: "role", value: "member" },
          state: "active",
        },
      ]}
      query=""
      empty="Nobody here yet."
      hrefFor="/console/org/people"
      mayCancel
    />,
  );

  // Only the invited row has the verb; the active row is a link and nothing more.
  const cancel = page.getByRole("button", { name: PEOPLE.verbs.cancelInvite.label });
  await expect(cancel).toHaveCount(1);
  await cancel.click();
  // 02 rule 22: the confirmation names who never joins, not *Are you sure?*
  await expect(page.locator("[data-confirm-takes]")).toContainText("jo@acme.example");
  await page.getByRole("button", { name: PEOPLE.verbs.cancelInvite.label }).last().click();

  await expect.poll(() => sent).toEqual([
    { method: "DELETE", path: "/v1/invites/1f0d9a2c-0000-4000-8000-000000000009", body: undefined },
  ]);
});

test("person_visibility_reads_the_persons_own", async ({ mount, page }) => {
  const sent = await records(page);
  // 03 §4.8: the switch sets *this person's* two, so the body it builds is
  // the person's own pair with one flipped — never the viewer's defaults.
  const verbs = await mount(
    <PersonVerbs
      personId="6f1c0b6e-0000-4000-8000-000000000001"
      name="Jo Adeyemi"
      teamPath="acme.marketing"
      unitPath="acme.marketing.jo"
      admin={false}
      orgAdmin
      visibility={{ boundaries: false, logs: true }}
      preview={{ loses: [], rotate: [] }}
    />,
  );

  await expect(verbs.getByLabel(PEOPLE_TEXT.visibilityBoundaries)).not.toBeChecked();
  // The box is controlled by the prop and the page refetches (02 rule 20), so
  // the click is the verb; its state only moves when the server has answered.
  await verbs.getByLabel(PEOPLE_TEXT.visibilityLogs).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "PATCH",
      path: "/v1/org-units/acme.marketing.jo/visibility",
      body: { boundaries: false, logs: false },
    },
  ]);
});
