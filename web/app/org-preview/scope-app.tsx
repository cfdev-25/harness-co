"use client";

/* The team and user surfaces. Both are the same application with different
   verbs: a team admin accepts and promotes, a member proposes and resolves
   their own copy. Neither invents a second look — the chrome matches the org
   console, because it is one model seen from three distances. */

import { useEffect, useMemo, useState } from "react";
import { Badge, BrandMark, Button, Chip, Disclosure, Dot, EmptyState, Eyebrow, Mono } from "../ui";
import { HarnessFile, STATE_TONE, STATE_WORD, TREES, tree } from "./files";

type Role = "team" | "user";

const NAV: { heading: string; items: { id: string; label: string }[] }[] = [
  { heading: "Build", items: [{ id: "harnesses", label: "Harnesses" }] },
  {
    heading: "Review",
    items: [
      { id: "changes", label: "Changes" },
      { id: "conflicts", label: "Conflicts" },
    ],
  },
  {
    heading: "Standing",
    items: [
      { id: "given", label: "What we hold" },
      { id: "people", label: "People" },
    ],
  },
];

const allFiles = () => TREES.flatMap((t) => t.files.map((f) => ({ harness: t, file: f })));

export function ScopeApp({ role }: { role: Role }) {
  const [route, setRoute] = useState<string[]>(["harnesses"]);

  useEffect(() => {
    const apply = () => {
      const raw = window.location.hash.replace(/^#/, "");
      setRoute(raw ? raw.split("/").map(decodeURIComponent) : ["harnesses"]);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const go = (...parts: string[]) => {
    window.location.hash = parts.map(encodeURIComponent).join("/");
    setRoute(parts);
  };

  const counts = useMemo(
    () => ({
      harnesses: TREES.length,
      changes: allFiles().filter(({ file }) => file.diff).length,
      conflicts: allFiles().filter(({ file }) => file.state === "conflict").length,
      given: 4,
      people: role === "team" ? 7 : 1,
    }),
    [role],
  );

  const who =
    role === "team"
      ? { eyebrow: "Team", title: "Marketing", sub: "Rae Lindqvist · team admin" }
      : { eyebrow: "You", title: "Jo Adeyemi", sub: "Marketing interns · member" };

  return (
    <div className="grid min-h-screen grid-cols-1 bg-canvas md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="border-line bg-sunken px-4 py-5 md:border-r">
        <div className="flex items-center gap-2.5 px-2">
          <BrandMark small />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{who.title}</span>
            <span className="block truncate font-mono text-[10px] tracking-[0.06em] text-faint uppercase">
              {who.eyebrow}
            </span>
          </span>
        </div>
        <p className="mt-2 px-2 text-[11px] text-faint">{who.sub}</p>

        <nav className="mt-6 grid gap-5">
          {NAV.map((group) => (
            <div key={group.heading}>
              <p className="px-2 text-[10px] font-bold tracking-[0.11em] text-faint uppercase">
                {group.heading}
              </p>
              <ul className="mt-1.5 grid list-none gap-0.5 p-0">
                {group.items.map((item) => {
                  const active = route[0] === item.id;
                  return (
                    <li key={item.id}>
                      <Button
                        variant="bare"
                        size="none"
                        full
                        className={`items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
                          active
                            ? "bg-accent-soft text-accent"
                            : "text-muted hover:bg-surface hover:text-fg"
                        }`}
                        onClick={() => go(item.id)}
                      >
                        <span className="truncate">{item.label}</span>
                        <span className="font-mono text-[10px] text-faint">
                          {counts[item.id as keyof typeof counts]}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <p className="mt-8 px-2 text-[11px] leading-relaxed text-faint">
          Prototype. Everything here is made up.
        </p>
      </aside>

      <main className="min-w-0 px-5 py-6 md:px-8">
        <Screen role={role} route={route} go={go} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Screen({
  role,
  route,
  go,
}: {
  role: Role;
  route: string[];
  go: (...parts: string[]) => void;
}) {
  const [view, a, b] = route;

  if (view === "harnesses" && a && b) return <FileView role={role} id={a} path={b} go={go} />;
  if (view === "harnesses" && a) return <HarnessView role={role} id={a} go={go} />;
  if (view === "harnesses") return <HarnessList role={role} go={go} />;
  if (view === "changes") return <Changes role={role} go={go} />;
  if (view === "conflicts") return <Conflicts role={role} go={go} />;
  if (view === "given") return <Given role={role} />;
  return <People role={role} />;
}

function Head({ title, lede, trail }: { title: string; lede: string; trail?: React.ReactNode }) {
  return (
    <header className="mb-5">
      {trail}
      <h1 className="mt-1 font-serif text-[26px] leading-tight">{title}</h1>
      <p className="mt-1.5 max-w-[64ch] text-[13px] leading-relaxed text-muted">{lede}</p>
    </header>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-line bg-surface p-4">{children}</div>;
}

function Line({
  name,
  note,
  tags,
  aside,
  onOpen,
}: {
  name: React.ReactNode;
  note?: React.ReactNode;
  tags?: { label: string; tone?: "ok" | "hold" | "warn" | "accent" | "neutral" }[];
  aside?: React.ReactNode;
  onOpen?: () => void;
}) {
  return (
    <div className="grid gap-1 border-b border-hairline py-3 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {onOpen ? (
          <Button
            variant="bare"
            size="none"
            className="text-left text-[14px] font-semibold hover:text-accent"
            onClick={onOpen}
          >
            {name}
          </Button>
        ) : (
          <span className="text-[14px] font-semibold">{name}</span>
        )}
        {tags?.map((tag) => (
          <Badge key={tag.label} tone={tag.tone ?? "neutral"}>
            {tag.label}
          </Badge>
        ))}
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {note && <p className="text-[13px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/* Harnesses -------------------------------------------------------------- */

function HarnessList({ role, go }: { role: Role; go: (...p: string[]) => void }) {
  return (
    <>
      <Head
        title="Harnesses"
        lede={
          role === "team"
            ? "What Marketing has built. Open one to see the files inside it, what changed, and what is waiting on you."
            : "The harnesses you can run. You can read every file in them; changing one means pushing your own version for an admin to accept."
        }
      />
      <Card>
        {TREES.map((t) => {
          const conflicts = t.files.filter((f) => f.state === "conflict").length;
          const changed = t.files.filter((f) => f.diff).length;
          return (
            <Line
              key={t.id}
              name={t.name}
              note={`${t.blurb} · ${t.files.length} files`}
              onOpen={() => go("harnesses", t.id)}
              tags={[
                t.preflight === "passing"
                  ? { label: "preflight passing", tone: "ok" as const }
                  : { label: "preflight failing", tone: "warn" as const },
                ...(conflicts ? [{ label: `${conflicts} conflict`, tone: "warn" as const }] : []),
                ...(changed ? [{ label: `${changed} changed`, tone: "hold" as const }] : []),
              ]}
              aside={<Mono>{t.team}</Mono>}
            />
          );
        })}
      </Card>
    </>
  );
}

function HarnessView({
  role,
  id,
  go,
}: {
  role: Role;
  id: string;
  go: (...p: string[]) => void;
}) {
  const t = tree(id);
  if (!t) return <EmptyState>No such harness.</EmptyState>;
  const groups = [...new Set(t.files.map((f) => f.kind))];
  return (
    <>
      <Head
        trail={
          <Button
            variant="bare"
            size="none"
            className="text-[13px] text-muted hover:text-fg"
            onClick={() => go("harnesses")}
          >
            ← Harnesses
          </Button>
        }
        title={t.name}
        lede={`${t.blurb} Every file it loads, and where each one comes from. Organisation files are the same in every harness; team files are Marketing's; yours are only yours until somebody accepts them.`}
      />
      <div className="grid gap-4">
        {groups.map((kind) => (
          <Card key={kind}>
            <h2 className="text-[10px] font-bold tracking-[0.11em] text-muted uppercase">
              {kind}
            </h2>
            <div className="mt-3">
              {t.files
                .filter((f) => f.kind === kind)
                .map((f) => (
                  <Line
                    key={f.path}
                    name={<Chip>{f.path}</Chip>}
                    note={f.note}
                    onOpen={() => go("harnesses", t.id, f.path)}
                    tags={[
                      { label: f.owner, tone: f.owner === "you" ? "accent" : "neutral" },
                      ...(f.state === "clean"
                        ? []
                        : [{ label: STATE_WORD[f.state], tone: STATE_TONE[f.state] }]),
                    ]}
                  />
                ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/* One file, and whatever disagreement it is in ---------------------------- */

function Pre({ children, tone }: { children: string; tone?: "ok" | "warn" }) {
  const edge =
    tone === "ok" ? "border-ok/30" : tone === "warn" ? "border-warn/30" : "border-line";
  return (
    <pre
      className={`overflow-auto rounded-md border ${edge} bg-sunken px-3.5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre text-fg`}
    >
      {children}
    </pre>
  );
}

function FileView({
  role,
  id,
  path,
  go,
}: {
  role: Role;
  id: string;
  path: string;
  go: (...p: string[]) => void;
}) {
  const t = tree(id);
  const f = t?.files.find((one) => one.path === path);
  if (!t || !f) return <EmptyState>No such file.</EmptyState>;

  return (
    <>
      <Head
        trail={
          <Button
            variant="bare"
            size="none"
            className="text-[13px] text-muted hover:text-fg"
            onClick={() => go("harnesses", t.id)}
          >
            ← {t.name}
          </Button>
        }
        title={f.path}
        lede={f.note ?? "Unchanged since the team last delivered it."}
      />

      <div className="grid gap-4">
        {f.conflict && <ConflictCard file={f} role={role} />}

        {f.diff && !f.conflict && (
          <Card>
            <h2 className="text-[10px] font-bold tracking-[0.11em] text-muted uppercase">
              What changed
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed">{f.diff.summary}</p>
            <p className="mt-1 font-mono text-[11px] text-faint">
              {f.diff.who} · {f.diff.when}
            </p>
            <div className="mt-3">
              <Disclosure summary={<span className="font-mono text-[11px]">View as git</span>}>
                <div className="mt-2">
                  <Pre>{f.diff.hunk}</Pre>
                </div>
              </Disclosure>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {role === "team" && f.state !== "yours" && (
                <>
                  <Button variant="primary" size="sm">
                    Accept for Marketing
                  </Button>
                  <Button size="sm">Decline</Button>
                </>
              )}
              {role === "user" && f.state === "modified" && (
                <>
                  <Button variant="primary" size="sm">
                    Push mine for review
                  </Button>
                  <Button size="sm">Take the team&apos;s</Button>
                </>
              )}
            </div>
          </Card>
        )}

        <Card>
          <h2 className="text-[10px] font-bold tracking-[0.11em] text-muted uppercase">
            The file
          </h2>
          <div className="mt-3">
            <Pre>{f.body}</Pre>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            Owned by the {f.owner}.{" "}
            {f.owner === "organisation"
              ? "Always loaded, and nothing below the organisation can change it."
              : role === "user"
                ? "You can edit your copy locally; pushing it asks a Marketing admin to accept it."
                : "Yours to change."}
          </p>
        </Card>
      </div>
    </>
  );
}

function ConflictCard({ file, role }: { file: HarnessFile; role: Role }) {
  const c = file.conflict!;
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft p-4">
      <h2 className="text-[10px] font-bold tracking-[0.11em] text-warn uppercase">
        Both sides changed this
      </h2>
      <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed">
        You edited it, and {c.whoTheirs} edited it {c.whenTheirs}. Nothing was overwritten and
        nothing is lost — your copy is still what runs for you until you pick one.
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="grid gap-1.5">
          <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-accent uppercase">
            <Dot tone="accent" /> Yours
          </span>
          <Pre tone="ok">{c.yours}</Pre>
        </div>
        <div className="grid gap-1.5">
          <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
            <Dot tone="neutral" /> {c.whoTheirs}&apos;s
          </span>
          <Pre>{c.theirs}</Pre>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm">
          Keep mine{role === "user" ? " and push it" : ""}
        </Button>
        <Button size="sm">Take theirs</Button>
        <Button size="sm">Edit and merge by hand</Button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        There is no third state. The platform never merges text on your behalf, because a merge
        it got wrong would be indistinguishable from one you meant.
      </p>
    </div>
  );
}

/* Review ----------------------------------------------------------------- */

function Changes({ role, go }: { role: Role; go: (...p: string[]) => void }) {
  const rows = allFiles().filter(({ file }) => file.diff);
  return (
    <>
      <Head
        title="Changes"
        lede={
          role === "team"
            ? "Everything proposed or promoted across Marketing's harnesses. Accepting one publishes it to the team; everyone gets it at their next session."
            : "What you have changed, and what is arriving from your team. Nothing here blocks you — your copy runs until you say otherwise."
        }
      />
      <Card>
        {rows.length === 0 && <EmptyState>Nothing has changed.</EmptyState>}
        {rows.map(({ harness, file }) => (
          <Line
            key={harness.id + file.path}
            name={file.diff!.summary}
            note={`${harness.name} · ${file.path}`}
            onOpen={() => go("harnesses", harness.id, file.path)}
            tags={[
              { label: STATE_WORD[file.state], tone: STATE_TONE[file.state] },
              { label: file.diff!.who === "You" ? "yours" : "theirs", tone: "neutral" },
            ]}
            aside={<Mono>{file.diff!.when}</Mono>}
          />
        ))}
      </Card>
    </>
  );
}

function Conflicts({ role, go }: { role: Role; go: (...p: string[]) => void }) {
  const rows = allFiles().filter(({ file }) => file.state === "conflict");
  return (
    <>
      <Head
        title="Conflicts"
        lede="Files where you and your team both moved. They sit here until somebody chooses; nothing is overwritten while they wait, and the session still runs on your copy."
      />
      <Card>
        {rows.length === 0 && <EmptyState>Nothing is in conflict.</EmptyState>}
        {rows.map(({ harness, file }) => (
          <Line
            key={harness.id + file.path}
            name={file.path}
            note={`${harness.name} · ${file.conflict!.whoTheirs} changed it ${file.conflict!.whenTheirs}`}
            onOpen={() => go("harnesses", harness.id, file.path)}
            tags={[{ label: "needs a decision", tone: "warn" }]}
            aside={
              <Button size="sm" variant="ghost" onClick={() => go("harnesses", harness.id, file.path)}>
                Settle it
              </Button>
            }
          />
        ))}
      </Card>
    </>
  );
}

/* Standing --------------------------------------------------------------- */

function Given({ role }: { role: Role }) {
  return (
    <>
      <Head
        title="What we hold"
        lede={
          role === "team"
            ? "Given to Marketing by an organisation admin. You may narrow one to a sub-team; you cannot add an entry the team does not hold, or change which sources it accepts."
            : "What Marketing interns was given, which is what your sessions resolve from. None of it is yours to change — the list is here so you know what you have."
        }
      />
      <div className="grid gap-4">
        <Card>
          <h2 className="text-[10px] font-bold tracking-[0.11em] text-muted uppercase">
            Security groups
          </h2>
          <div className="mt-3">
            <Line
              name="Marketing"
              note="crm → crm-api-key · email → marketing/sendgrid"
              tags={[{ label: "vault or local" }]}
              aside={role === "team" ? <Button size="sm" variant="ghost">Narrow to a sub-team</Button> : undefined}
            />
            <Line
              name="Marketing interns"
              note={role === "team" ? "crm only. You created this by narrowing the group above." : "crm only. This is the one your sessions use."}
              tags={[{ label: role === "team" ? "narrowed by you" : "yours", tone: "accent" }]}
            />
            <Line
              name="Outside endpoints"
              note="Search and fetch, minus the boundaries."
              tags={[{ label: "allowed", tone: "accent" }]}
            />
          </div>
        </Card>
        <Card>
          <h2 className="text-[10px] font-bold tracking-[0.11em] text-muted uppercase">
            Boundaries
          </h2>
          <div className="mt-3">
            <Line
              name="competitor-crm.com"
              note="Added by Marketing · applies here and below"
              tags={[{ label: "enforced", tone: "ok" }]}
              aside={role === "team" ? <Button size="sm" variant="ghost">Remove</Button> : undefined}
            />
            <Line
              name="Outbound mail APIs"
              note="Marketing interns, only for Campaign drafts"
              tags={[{ label: "enforced", tone: "ok" }]}
            />
            <Line
              name="6 organisation boundaries"
              note="Paste sites, anonymising networks, api.openai.com, destructive commands, writes outside the work tree, privilege escalation."
              tags={[{ label: "not yours to lift" }]}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

function People({ role }: { role: Role }) {
  if (role === "user") {
    return (
      <>
        <Head
          title="You"
          lede="Your membership is your access. Everything your sessions resolve comes from the teams you are in."
        />
        <Card>
          <Line name="Jo Adeyemi" note="jo@acme.co · member · active today" />
          <Line
            name="Marketing interns"
            note="Inside Marketing. 3 people. Holds the narrower group — crm, and not the mailing key."
            tags={[{ label: "your team", tone: "accent" }]}
          />
        </Card>
      </>
    );
  }
  return (
    <>
      <Head
        title="People"
        lede="Marketing and everything inside it. Adding someone to a team is the grant; removing them takes it back in one step."
      />
      <Card>
        <Line name="Rae Lindqvist" note="rae@acme.co · team admin · active today" tags={[{ label: "you", tone: "accent" }]} />
        <Line name="Jo Adeyemi" note="jo@acme.co · member · Marketing interns" />
        <Line name="Marketing interns" note="3 people · narrower group · cannot reach the mailing key" tags={[{ label: "sub-team" }]} />
      </Card>
    </>
  );
}
