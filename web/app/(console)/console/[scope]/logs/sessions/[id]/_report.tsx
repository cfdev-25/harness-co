import { providerId } from "@/lib/views/session";
import type { PreflightReport } from "@/lib/views/session";
import { reachLine } from "@/lib/views/reach";
import type { Viewer } from "@/lib/views/types";
import { SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";
import { BlockerCard } from "../../../../../ui/blocker-card";
import { Card } from "../../../../../ui/card";
import { KeyValue } from "../../../../../ui/key-value";
import { Notice } from "../../../../../ui/notice";
import { ScaleTag } from "../../../../../ui/scale-tag";
import { SectionLabel } from "../../../../../ui/section-label";

/**
 * P15, D7: the report is shown **whole** — the tag, then every blocker with
 * its message, remedy and link, then the drift rows, then the choices. A
 * session whose CLI predates D7 carries `null` and the card says so rather
 * than showing nothing (04 §13).
 */
export function PreflightCard({ report, viewer }: { report: PreflightReport | null; viewer: Viewer }) {
  if (!report) {
    return (
      <Card title={WORDS.cards.preflight}>
        <Notice tone="hold">{WORDS.report.none}</Notice>
      </Card>
    );
  }
  const choices = report.choices ?? {};
  return (
    <Card
      title={WORDS.cards.preflight}
      actions={<ScaleTag scale="preflight" value={report.passing ? "passing" : "failing"} />}
    >
      <div data-preflight-report className="grid gap-4">
        {report.blockers.length > 0 && (
          <section className="grid gap-2">
            <SectionLabel>{WORDS.report.blockers}</SectionLabel>
            {report.blockers.map((blocker) => (
              <BlockerCard
                key={blocker.code}
                blocker={blocker}
                showCode
                linkLabel={blocker.link ? WORDS.report.openLink : undefined}
              />
            ))}
          </section>
        )}
        {report.drift.length > 0 && (
          <section className="grid gap-2">
            <SectionLabel>{WORDS.report.drift}</SectionLabel>
            {report.drift.map((row) => (
              <p key={row.file} className="font-mono text-xs text-muted">
                {row.file} · {WORDS.report.driftExpected} {String(row.expected)} ·{" "}
                {WORDS.report.driftActual} {String(row.actual)}
              </p>
            ))}
          </section>
        )}
        <section className="grid gap-2">
          <SectionLabel>{WORDS.report.choices}</SectionLabel>
          <KeyValue
            items={[
              { k: WORDS.report.provider, v: choices.provider?.id ?? "—" },
              { k: WORDS.report.harness, v: choices.harness?.name ?? "—" },
              {
                k: WORDS.report.model,
                v: choices.model ? `${providerId(choices.model.provider)} ${choices.model.model}` : WORDS.notMetered,
              },
              {
                k: WORDS.report.grants,
                v: (choices.grants ?? []).map((grant) => grant.group ?? grant.id).join(", ") || "—",
              },
              {
                // D131: how far this session could reach, and who decided —
                // off the plan, not off a grant (W5-D1b retired that one).
                k: WORDS.report.reach,
                v: reachLine(report.plan?.reach, viewer),
              },
            ]}
          />
        </section>
      </div>
    </Card>
  );
}
