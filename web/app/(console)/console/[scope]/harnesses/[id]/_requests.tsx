"use client";

import { useRouter } from "next/navigation";
import { shortTime } from "@/lib/views/harness";
import { outcomeNote, rowNote, type RequestState, type RequestView } from "@/lib/views/requests";
import { EMPTY } from "@/content/empty";
import { REQUESTS_WORDS as WORDS } from "@/content/screens/requests";
import { Line } from "../../../../ui/line";
import { Segmented } from "../../../../ui/segmented";

/**
 * 04 §7's panel: an Open / Closed filter over `?state`, then one `Line` per
 * request. There is **no state badge** (PRD §17.3); a closed row carries its
 * outcome word in the same line.
 */
export function RequestsPanel({
  requests,
  state,
  base,
}: {
  requests: RequestView[];
  state: RequestState;
  base: string;
}) {
  const router = useRouter();
  const empty = state === "open" ? EMPTY["harness.requests"] : EMPTY["requests.closed"];

  return (
    <div className="grid gap-4 pt-4">
      <Segmented
        label={WORDS.filterLabel}
        options={[
          { id: "open", label: WORDS.states.open },
          { id: "closed", label: WORDS.states.closed },
        ]}
        value={state}
        onChange={(id) => router.push(`${base}?view=requests&state=${id}`, { scroll: false })}
      />
      {requests.length === 0 ? (
        <p className="py-10 text-md text-muted">{empty.sentence}</p>
      ) : (
        <div data-requests>
          {requests.map((request) => {
            const outcome = outcomeNote(request, WORDS.outcomes);
            const note = rowNote(request, { files: WORDS.files, file: WORDS.file, roleAsk: WORDS.roleAsk });
            return (
              <Line
                key={request.id}
                name={request.title}
                note={outcome ? `${note} · ${outcome}` : note}
                href={`${base}/requests/${request.id}`}
                aside={<span className="font-mono text-xs text-faint">{shortTime(request.at)}</span>}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
