import { SHELL } from "@/content/shell";
import { fill } from "./refusals";

/** What `PageHeader.readme` takes: the modal's heading and its paragraphs. */
export interface Readme {
  title: string;
  body: string[];
}

/**
 * A screen's readme (01 §7.5): its lede, then whatever further explanation
 * the screen's content module carries (`ScreenContent.about`).
 *
 * It lives here rather than in `ui/` because the heading is the shell's
 * sentence and a `ui/` component is given its strings (02 rule 2), and it is
 * one function rather than one per screen because the only thing that varies
 * is which paragraphs a screen has. A screen with nothing to say gets
 * `undefined` and renders its name as plain text: an empty modal behind a
 * button is worse than no button.
 */
export function readmeOf(
  name: string,
  lede?: string | null,
  about?: readonly string[],
): Readme | undefined {
  const body = [lede ?? "", ...(about ?? [])]
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  if (body.length === 0) return undefined;
  return { title: fill(SHELL.readme.title, { name }), body };
}

/** What `SubHeader.search` takes. */
export interface BarSearch {
  label: string;
  closeLabel: string;
  placeholder: string;
  param: string;
  value: string;
  base: string;
}

/**
 * The bar's search, for a screen with one text query (01 §7.5). The words
 * for the control itself are the shell's — every screen's search opens and
 * closes the same way — and the placeholder is the screen's, because what it
 * searches is the screen's own business.
 *
 * `base` is the screen's URL with every other search param already on it, so
 * writing `?q=` keeps the kind tab, the state filter and the cursor.
 */
export function searchIn(base: string, value: string, placeholder: string, param = "q"): BarSearch {
  return { label: SHELL.search.label, closeLabel: SHELL.search.close, placeholder, param, value, base };
}
