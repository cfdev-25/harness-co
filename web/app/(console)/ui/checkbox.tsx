import type { InputHTMLAttributes } from "react";

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Checkbox({ label, hint, ...props }: CheckboxProps) {
  return (
    <label className="flex items-start gap-2 text-base text-fg">
      <input type="checkbox" className="mt-1 size-4 accent-accent" {...props} />
      <span className="grid gap-1">
        <span>{label}</span>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}
