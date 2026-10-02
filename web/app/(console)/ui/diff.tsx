import type { DiffHunk } from "@/lib/views/types";

export interface DiffProps {
  hunks: DiffHunk[];
}

const LINE: Record<string, string> = {
  add: "bg-ok-soft text-ok",
  del: "bg-warn-soft text-warn",
  ctx: "text-muted",
};

const MARK: Record<string, string> = { add: "+", del: "−", ctx: " " };

/** The one diff renderer; the server owns what changed (D66). */
export function Diff({ hunks }: DiffProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-sunken font-mono text-xs">
      {hunks.map((hunk) => (
        <div key={hunk.header}>
          <p className="border-y border-hairline bg-surface px-3 py-1 text-faint first:border-t-0">
            {hunk.header}
          </p>
          {hunk.lines.map((line, index) => (
            <p key={index} className={`flex gap-3 px-3 whitespace-pre ${LINE[line.kind]}`}>
              <span className="select-none">{MARK[line.kind]}</span>
              <span>{line.text}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
