import { type MatrixRow, dimensionLabel } from "@/lib/views/providers";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import { Chip } from "../../../../ui/chip";
import { SectionLabel } from "../../../../ui/section-label";

export interface MatrixProps {
  rows: MatrixRow[];
  empty: string;
}

/**
 * The old Routing matrix — rows teams / harnesses / runtimes, the two column
 * groups *Default for* and *Approved for*, and what each row resolves to
 * (PRD §9.2, 04 §10).
 *
 * W6-D5 made it a **read** view behind the *By team* toggle: it is the same
 * routing the rows above show, turned on its side for the admin who wants to
 * read it that way. The select that used to live in the *Default for* cell is
 * now the row's *Set default…* verb, so this file has no writes and no client
 * state — it is a server component again.
 */
export function RoutingMatrixTable({ rows, empty }: MatrixProps) {
  if (rows.length === 0) return <p className="px-1 py-10 text-md text-muted">{empty}</p>;

  return (
    <div className="grid gap-2">
      <p className="text-base text-muted">{PROVIDERS_TEXT.byTeamNote}</p>
      <table className="w-full border-collapse text-left text-base">
        <thead>
          <tr>
            {[
              PROVIDERS.columns.provider.heading,
              PROVIDERS_TEXT.defaultFor,
              PROVIDERS_TEXT.approvedFor,
              PROVIDERS_TEXT.resolved,
            ].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="border-b border-line px-4 py-2 text-2xs font-bold tracking-eyebrow text-muted uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.dimension}-${row.subject}`} className="border-b border-hairline last:border-b-0">
              <td className="px-4 py-3 align-top">
                <SectionLabel>{dimensionLabel(row.dimension)}</SectionLabel>
                {row.label}
              </td>
              <td className="px-4 py-3 align-top">{row.defaultFor || PROVIDERS_TEXT.none}</td>
              <td className="px-4 py-3 align-top">
                <span className="flex flex-wrap gap-1">
                  {row.approvedFor.map((provider) => (
                    <Chip key={provider}>{provider}</Chip>
                  ))}
                  {row.approvedFor.length === 0 && PROVIDERS_TEXT.none}
                </span>
              </td>
              <td className="px-4 py-3 align-top">{row.resolved || PROVIDERS_TEXT.none}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
