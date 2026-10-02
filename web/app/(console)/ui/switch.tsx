import type { InputHTMLAttributes } from "react";
import { LABEL } from "./control";

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "checked"> {
  label: string;
  checked: boolean;
  /** The one line beside it: what *on* and *off* mean for this setting. */
  hint?: string;
}

/**
 * A two-state setting, drawn as a track and a knob (01 §11).
 *
 * It is a checkbox with `role="switch"`, not a `<button>`: a switch is a form
 * control that submits with the form around it, and the native input gives it
 * the label association, the focus ring and the space bar for free. `role` is
 * the only thing that changes, because *on or off now* and *ticked for later*
 * are two different promises to a screen reader.
 *
 * It is not `Checkbox`: that one is a list item the person ticks — the store's
 * rows, the narrowing modal's aliases — and reads as one line of text. This is
 * a setting, so it carries `control.ts`'s label above the row the way `Field`
 * and `Select` do.
 *
 * **The input *is* the track** (`switch-track` in `globals.css`). The first
 * version hid it with `sr-only` and drew a track beside it; the track then sat
 * over the 1px input and swallowed every click (Playwright: *intercepts
 * pointer events*). A control nobody can press is not a styling detail, so the
 * track is the input's own box and the knob is its `::before` — nothing
 * overlaps it and the native click is the only one there is.
 */
export function Switch({ label, checked, hint, ...props }: SwitchProps) {
  return (
    <label className="grid gap-1">
      <span className={LABEL}>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          className="switch-track"
          {...props}
        />
        {hint && <span className="text-base text-muted">{hint}</span>}
      </span>
    </label>
  );
}
