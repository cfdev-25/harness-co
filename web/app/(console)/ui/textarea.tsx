import type { TextareaHTMLAttributes } from "react";
import { CONTROL, LABEL } from "./control";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, ...props }: TextareaProps) {
  return (
    <label className="grid gap-1">
      <span className={LABEL}>{label}</span>
      <textarea className={CONTROL} aria-invalid={error ? true : undefined} rows={4} {...props} />
      {(error || hint) && (
        <span className={error ? "text-xs text-warn" : "font-mono text-xs text-faint"}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
