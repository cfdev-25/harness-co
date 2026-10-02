import type { SVGProps } from "react";

/** At most twelve inline paths; the console has no icon dependency (D63). */
export type IconName =
  | "search" | "menu" | "close" | "chevron" | "check" | "copy"
  | "external" | "plus" | "minus" | "git" | "warning" | "info";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

const PATHS: Record<IconName, string> = {
  search: "M11 11 15 15M12.5 7.5a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  menu: "M2.5 4.5h13M2.5 9h13M2.5 13.5h13",
  close: "m4 4 9 9M13 4l-9 9",
  chevron: "m5 6.5 4 4 4-4",
  check: "m3.5 9 3.5 3.5 6-7",
  copy: "M6 6h7.5v7.5H6zM3 10.5V3h7.5",
  external: "M9 3h4v4M13 3 7.5 8.5M12 10v3H4V5h3",
  plus: "M9 3.5v11M3.5 9h11",
  minus: "M3.5 9h11",
  git: "M9 5.5v7M6 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 0c0 3-6 1.5-6 4.5",
  warning: "M9 3 2 15h14L9 3Zm0 4.5V11m0 2.5v.01",
  info: "M9 8v5m0-8v.01M16 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
};

export function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
