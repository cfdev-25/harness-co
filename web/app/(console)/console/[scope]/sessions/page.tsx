import { redirect } from "next/navigation";
import { parseScope, scopeHref } from "@/lib/scope";
import { query } from "./_query";

/**
 * Sessions is a tab of Logs (04 §14), and this was its address for two waves
 * — in the guides, in Account's button, on a person's page. The query string
 * is carried over: the filters and `?person=` are the state (02 rule 16).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = parseScope(await params);
  redirect(scopeHref(scope, "/logs/sessions") + query(await searchParams));
}
