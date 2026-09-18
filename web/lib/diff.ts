/* A line diff for the asset viewer. Nothing here is Harness-specific: it takes
   two documents and returns the rows to render. */

export type DiffKind = "same" | "add" | "del";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the older document; absent on added lines. */
  before?: number;
  /** 1-based line number in the newer document; absent on removed lines. */
  after?: number;
}

/* The table below is one cell per pair of lines, and a file may be 256 KiB, so
   past this the diff degrades to "this block was replaced" rather than
   allocating gigabytes. Trimming the common head and tail first means only a
   genuinely rewritten file ever reaches the limit. */
const MAX_CELLS = 2_000_000;

/** Splits on newlines. A trailing newline ends the last line, it never adds one. */
export function toLines(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.length ? body.split("\n") : [];
}

export function diffLines(beforeText: string, afterText: string): DiffRow[] {
  const before = toLines(beforeText);
  const after = toLines(afterText);

  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < head; i++) {
    rows.push({ kind: "same", text: before[i], before: i + 1, after: i + 1 });
  }
  rows.push(
    ...changed(
      before.slice(head, before.length - tail),
      after.slice(head, after.length - tail),
      head,
    ),
  );
  for (let i = 0; i < tail; i++) {
    const index = before.length - tail + i;
    rows.push({
      kind: "same",
      text: before[index],
      before: index + 1,
      after: after.length - tail + i + 1,
    });
  }
  return rows;
}

/** The middle, once the matching head and tail are out of the way. */
function changed(before: string[], after: string[], offset: number): DiffRow[] {
  const rows: DiffRow[] = [];
  const height = before.length;
  const width = after.length + 1;

  if (!height || !after.length || (height + 1) * width > MAX_CELLS) {
    for (let i = 0; i < height; i++) {
      rows.push({ kind: "del", text: before[i], before: offset + i + 1 });
    }
    for (let j = 0; j < after.length; j++) {
      rows.push({ kind: "add", text: after[j], after: offset + j + 1 });
    }
    return rows;
  }

  /* Longest common subsequence, filled from the end so that walking it
     forwards keeps a run of deletions ahead of the additions that replaced
     them — which is how a diff reads. */
  const lcs = new Uint32Array((height + 1) * width);
  for (let i = height - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        before[i] === after[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < height && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: "same", text: before[i], before: offset + i + 1, after: offset + j + 1 });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      rows.push({ kind: "del", text: before[i], before: offset + i + 1 });
      i++;
    } else {
      rows.push({ kind: "add", text: after[j], after: offset + j + 1 });
      j++;
    }
  }
  for (; i < height; i++) rows.push({ kind: "del", text: before[i], before: offset + i + 1 });
  for (; j < after.length; j++) rows.push({ kind: "add", text: after[j], after: offset + j + 1 });
  return rows;
}

/** Base64 as the API sends it, decoded as UTF-8 rather than as Latin-1. */
export function decodeText(contentB64: string): string {
  const bytes = Uint8Array.from(atob(contentB64), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
