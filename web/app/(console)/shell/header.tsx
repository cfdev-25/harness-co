import Link from "next/link";
import { scopeHref } from "@/lib/scope";
import type { Scope, Viewer } from "@/lib/views/types";
import { BrandMark } from "../ui/brand-mark";
import { AccountMenu } from "./account-menu";
import { Drawer } from "./drawer";
import { ScopeSwitcher } from "./scope-switcher";
import { Section } from "./section";
import { SearchButton } from "./search";

export interface HeaderProps {
  scope: Scope;
  viewer: Viewer;
}

const BRAND = "flex shrink-0 items-center gap-2 font-semibold text-fg no-underline";

/**
 * One line: *Harness › Assets* on the left, then the level switcher, the
 * palette and the account menu on the right (01 §4.3).
 *
 * The brand and the screen's name are one breadcrumb because they are one
 * thought — where you are in the product — and the controls are a second
 * group because they are all things you do. Nothing wraps: the breadcrumb's
 * section truncates and the right-hand group keeps its width.
 */
export function Header({ scope, viewer }: HeaderProps) {
  return (
    <header className="z-10 flex flex-nowrap items-center gap-3 border-b border-line bg-surface px-4">
      <Drawer scope={scope} viewer={viewer} />
      <span className="flex min-w-0 items-center gap-2">
        <Link href={scopeHref({ kind: "me" }, "/harnesses")} className={BRAND}>
          <BrandMark small />
          <span className="text-md font-bold">Harness</span>
        </Link>
        <Section />
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {/* A personal account is one level (07 §2): there is nothing to switch to. */}
        {viewer.edition !== "personal" && <ScopeSwitcher scope={scope} viewer={viewer} />}
        <SearchButton scope={scope} />
        <AccountMenu viewer={viewer} />
      </span>
    </header>
  );
}
