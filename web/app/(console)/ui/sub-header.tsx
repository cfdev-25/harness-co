"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { CONTROL } from "./control";
import { Icon } from "./icons";
import { LevelChip } from "./level-chip";
import { Readme } from "./readme";
import type { Level } from "@/lib/views/level";

/** One tab of the bar. Routes stay routes and queries stay queries: the row
 *  carries the href the screen already builds, and the bar only draws it. */
export interface SubHeaderTab {
  id: string;
  label: string;
  href: string;
  current: boolean;
  /** Two sets of tabs on one bar — the harness page's versions and its
   *  views (04 §5). Rows keep their order; sets are parted by a rule. */
  group?: string;
  /** How many rows are behind the tab, where the screen counts them. */
  count?: number;
}

/** The collapsed search. The field writes one search param and keeps every
 *  other one (02 rule 16), so `base` is the screen's own URL with its other
 *  params already on it. */
export interface SubHeaderSearch {
  label: string;
  closeLabel: string;
  placeholder: string;
  param: string;
  value: string;
  base: string;
}

export interface SubHeaderProps {
  /** The `<nav>`'s name; required wherever `tabs` is passed (02 rule 2). */
  tabsLabel?: string;
  tabs?: SubHeaderTab[];
  /** *3 harnesses* — muted, first of the right-hand group. */
  count?: ReactNode;
  /** The screen's readme, as the `(?)` mark (§7.5). */
  readme?: { title: string; body: string[] };
  /** `levelOf(scope, viewer)`. Every screen inside `[scope]` passes one. */
  level?: Level;
  search?: SubHeaderSearch;
  actions?: ReactNode;
}

// 01 §5's steps and 02 D25's ceiling: the bar's own one-line rule is the
// long list in this file, so it is named rather than inlined.
const BAR =
  "flex h-12 flex-nowrap items-center gap-4 border-b border-hairline px-6";
// `px-6` on the bar puts this strip's content box on the screen's gutter,
// so the first tab's word starts where the table below it starts.
const TABS = "flex min-w-0 flex-1 items-center gap-6 overflow-x-auto no-scrollbar";
const RIGHT = "flex shrink-0 items-center gap-3";
// The link is the hit area and carries no padding of its own; the rule is
// on the *label*, so it is exactly as wide as the word and centred under it
// — a count or an icon beside the word never drags it sideways (01 §7.5).
const TAB = "flex shrink-0 items-center gap-2 whitespace-nowrap no-underline";
const TAB_ON = `${TAB} font-semibold text-accent-text`;
const TAB_OFF = `${TAB} text-muted hover:text-fg`;
const RULE_ON = "border-b-2 border-accent pb-1";
const RULE_OFF = "border-b-2 border-transparent pb-1";

/**
 * The sub-header bar — the only header a screen has (01 §7.5). One line at
 * every width: the screen's tabs on the left, then flexible space, then, on
 * the right, the count, the readme mark, the level chip, the search and the
 * screen's verbs. Nothing wraps and nothing stacks; when the tabs do not fit
 * they scroll and the right-hand group stays where it is, because a header
 * that grows a second row moves the first row of the table under it.
 *
 * It is one component for every screen because a strip that each screen
 * draws for itself is a strip that drifts: the four `_tabs.tsx` files this
 * replaced had four spacings and three ideas of what *selected* looks like.
 */
export function SubHeader(props: SubHeaderProps) {
  const { tabsLabel, tabs, count, readme, level, search, actions } = props;
  const router = useRouter();
  const box = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(Boolean(search?.value));
  const [text, setText] = useState(search?.value ?? "");

  function write(next: string) {
    if (!search) return;
    setText(next);
    const [path, existing] = search.base.split("?");
    const params = new URLSearchParams(existing ?? "");
    if (next) params.set(search.param, next);
    else params.delete(search.param);
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path, { scroll: false });
  }

  // A field with something in it stays open: collapsing it would hide the
  // filter the rows on screen are under. Chromium clears an
  // `<input type="search">` on Escape of its own accord, so the key is taken
  // either way and only an empty field closes.
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (text !== "") return;
    setOpen(false);
    requestAnimationFrame(() => box.current?.querySelector("button")?.focus());
  }

  return (
    <div className={BAR}>
      {tabs && tabs.length > 0 ? (
        <nav aria-label={tabsLabel} className={TABS}>
          {tabs.map((tab, index) => (
            <span key={`${tab.group ?? ""}:${tab.id}`} className="flex shrink-0 items-center gap-6">
              {index > 0 && tab.group !== tabs[index - 1]?.group && (
                <span aria-hidden className="h-4 w-px bg-line" />
              )}
              <Link
                href={tab.href}
                aria-current={tab.current ? "page" : undefined}
                className={tab.current ? TAB_ON : TAB_OFF}
              >
                <span data-rule className={tab.current ? RULE_ON : RULE_OFF}>
                  {tab.label}
                </span>
                {tab.count !== undefined && (
                  <span className="font-mono text-xs text-faint">{tab.count}</span>
                )}
              </Link>
            </span>
          ))}
        </nav>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      <span className={RIGHT}>
        {count && <span className="font-mono text-xs text-faint">{count}</span>}
        {readme && <Readme title={readme.title} body={readme.body} />}
        {level && <LevelChip level={level} />}
        {search && (
          <span ref={box} className="flex items-center">
            {open && (
              <input
                autoFocus
                type="search"
                name={search.param}
                aria-label={search.label}
                placeholder={search.placeholder}
                value={text}
                onChange={(event) => write(event.target.value)}
                onKeyDown={onKeyDown}
                className={`${CONTROL} h-8 w-56 py-1`}
              />
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label={open ? search.closeLabel : search.label}
              onClick={() => {
                if (open) write("");
                setOpen(!open);
              }}
            >
              <Icon name={open ? "close" : "search"} />
            </Button>
          </span>
        )}
        {actions}
      </span>
    </div>
  );
}
