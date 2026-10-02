import Link from "next/link";
import type { ReactNode } from "react";
import type { ScaleTag as Tag } from "@/lib/views/types";
import { ScaleTag } from "./scale-tag";

export interface LineProps {
  name: string;
  note?: string;
  tags?: Tag[];
  aside?: ReactNode;
  href?: string;
}

/** The list row for everything that is not a table (01 §7.6). */
export function Line({ name, note, tags, aside, href }: LineProps) {
  const body = (
    <>
      <span className="grid min-w-0 gap-1">
        <span className="truncate font-semibold text-fg">{name}</span>
        {note && <span className="truncate text-sm text-muted">{note}</span>}
      </span>
      {tags && tags.length > 0 && (
        <span className="flex items-center gap-2">
          {tags.map((tag) => (
            <ScaleTag key={`${tag.scale}-${tag.value}`} scale={tag.scale} value={tag.value} size="sm" />
          ))}
        </span>
      )}
      {aside && <span className="ml-auto flex items-center gap-2">{aside}</span>}
    </>
  );
  const classes = "flex items-center gap-4 border-b border-hairline px-1 py-3 text-base last:border-b-0";
  return href ? (
    <Link href={href} className={`${classes} no-underline hover:bg-sunken`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
