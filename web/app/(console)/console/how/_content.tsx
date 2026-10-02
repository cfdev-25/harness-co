"use client";

import { useState } from "react";
import Link from "next/link";
import { SCALES, SCALE_IDS } from "@/lib/views/scales";
import { WORDS } from "@/lib/views/words";
import { COMMAND_SHEET } from "@/content/commands.generated";
import { HOW_TEXT } from "@/content/screens/how";
import { CommandSheet } from "../../ui/command-sheet";
import { Field } from "../../ui/field";
import { Mono } from "../../ui/mono";
import { ScaleTag } from "../../ui/scale-tag";
import { SectionLabel } from "../../ui/section-label";

/**
 * *How this works* — 05 §9. A filter box, then one section per scale in
 * registry order with `id` = the `ScaleId` so every `ScaleRegistry.href`
 * anchor resolves, then the words, then the sheet. No prose between sections
 * and no commentary on screens: this page explains the vocabulary, not the
 * console (P8, 05 D54).
 */
export function HowContent() {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const scales = SCALE_IDS.filter(
    (id) =>
      needle === "" ||
      `${id} ${SCALES[id].label}`.toLowerCase().includes(needle) ||
      SCALES[id].values.some((value) =>
        `${value.value} ${value.meaning}`.toLowerCase().includes(needle),
      ),
  );
  const words = Object.entries(WORDS).filter(
    ([word, entry]) => needle === "" || `${word} ${entry.short}`.toLowerCase().includes(needle),
  );

  return (
    <div className="grid gap-8 px-6 pb-12">
      <div className="max-w-sm">
        <Field
          label={HOW_TEXT.filterLabel}
          placeholder={HOW_TEXT.filterPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {scales.length === 0 && words.length === 0 && (
        <p className="text-md text-muted">{HOW_TEXT.noMatch}</p>
      )}

      {scales.map((id) => (
        <section key={id} id={id} className="grid gap-3">
          <h2 className="text-lg font-semibold">{SCALES[id].label}</h2>
          {SCALES[id].values.map((value) => (
            <p key={value.value} className="flex items-baseline gap-3 text-base text-muted">
              <ScaleTag scale={id} value={value.value} />
              <span>{value.meaning}</span>
            </p>
          ))}
        </section>
      ))}

      {words.length > 0 && (
        <section id="words" className="grid gap-4">
          <SectionLabel>{HOW_TEXT.wordsHeading}</SectionLabel>
          {words.map(([word, entry]) => (
            <div key={word} id={`word-${word.replace(/\s+/g, "-")}`} className="grid gap-1">
              <p className="text-base font-semibold">{word}</p>
              <p className="text-base text-muted">{entry.short}</p>
              <p className="text-sm text-faint">{entry.more}</p>
              <Mono>{entry.prd}</Mono>
            </div>
          ))}
        </section>
      )}

      {needle === "" && (
        <section id="commands" className="grid gap-5">
          <SectionLabel>{HOW_TEXT.commandsHeading}</SectionLabel>
          {/* The same sheet the dialog prints, in the page (P14, 05 §9). */}
          <CommandSheet
            inline
            open={false}
            onClose={() => {}}
            title={HOW_TEXT.commandsHeading}
            groups={COMMAND_SHEET.map((group) => ({ group: group.group, rows: [...group.rows] }))}
            copyLabel={HOW_TEXT.copy}
            copiedLabel={HOW_TEXT.copied}
          />
        </section>
      )}
    </div>
  );
}

/** The `Screen` aside: one entry per scale and one per word (05 §9). */
export function HowIndex() {
  return (
    <nav aria-label="How this works" className="grid gap-1 px-4 py-6 text-base">
      {SCALE_IDS.map((id) => (
        <Link key={id} href={`#${id}`} className="truncate text-muted hover:text-fg">
          {SCALES[id].label}
        </Link>
      ))}
      <span className="pt-3">
        <SectionLabel>{HOW_TEXT.wordsHeading}</SectionLabel>
      </span>
      {Object.keys(WORDS).map((word) => (
        <Link
          key={word}
          href={`#word-${word.replace(/\s+/g, "-")}`}
          className="truncate text-muted hover:text-fg"
        >
          {word}
        </Link>
      ))}
    </nav>
  );
}
