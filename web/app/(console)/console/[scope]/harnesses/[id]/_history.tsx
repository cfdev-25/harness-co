import { shortTime, type HarnessFileRow, type HarnessView } from "@/lib/views/harness";
import { EMPTY } from "@/content/empty";
import { HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { Chip } from "../../../../ui/chip";
import { Line } from "../../../../ui/line";
import { SectionLabel } from "../../../../ui/section-label";

/**
 * 04 §5's History view: one row per version, a plain sentence, the files it
 * touched beneath, and the short hash as a `Chip` with the whole hash as its
 * title. Whose history it is follows the compare control, because the rows
 * the server composed for that version are the rows shown. *Differences* is
 * removed from the control here (PRD §17.2), so it can never be the version.
 */
export function HistoryView({ rows }: { view?: HarnessView; rows: HarnessFileRow[] }) {
  const versions = new Map<string, { at: string; who: string; note: string; tree: string; files: string[] }>();
  for (const row of rows) {
    const editor = row.lastEditor;
    if (!editor) continue;
    const key = `${editor.at}-${editor.note}`;
    const entry = versions.get(key) ?? { at: editor.at, who: editor.name, note: editor.note, tree: row.tree, files: [] };
    entry.files.push(row.name);
    versions.set(key, entry);
  }
  const ordered = [...versions.values()].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="grid gap-2 pt-4">
      <SectionLabel>{WORDS.history.heading}</SectionLabel>
      {ordered.length === 0 ? (
        <p className="py-10 text-md text-muted">{EMPTY["harness.history"].sentence}</p>
      ) : (
        ordered.map((entry) => (
          <Line
            key={`${entry.at}-${entry.note}`}
            name={entry.note}
            note={`${entry.who} · ${shortTime(entry.at)} · ${WORDS.history.touched}: ${entry.files.join(", ")}`}
            aside={<Chip title={entry.tree}>{entry.tree.slice(0, 7)}</Chip>}
          />
        ))
      )}
    </div>
  );
}
