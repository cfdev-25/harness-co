import Link from "next/link";
import type { HarnessFileRow } from "@/lib/views/harness";
import { FILE_WORDS as WORDS } from "@/content/screens/file";
import { SectionLabel } from "../../../../../../ui/section-label";

/** 04 §6: the harness's file list beside the file, so files are one click
 *  apart. The same rows the repository table draws, compact. */
export function Siblings({
  rows,
  base,
  query,
  current,
}: {
  rows: HarnessFileRow[];
  base: string;
  query: string;
  current: string;
}) {
  return (
    <nav aria-label={WORDS.siblings} className="grid content-start gap-1 border-r border-hairline px-4 py-5">
      <SectionLabel>{WORDS.siblings}</SectionLabel>
      {rows.map((row) => (
        <Link
          key={row.assetId}
          href={`${base}/files/${row.assetId}?${query}`}
          aria-current={row.assetId === current ? "page" : undefined}
          className="truncate rounded-md px-2 py-1 text-base no-underline hover:bg-sunken aria-[current]:bg-accent-soft"
        >
          {row.kind}/{row.name}
        </Link>
      ))}
    </nav>
  );
}
