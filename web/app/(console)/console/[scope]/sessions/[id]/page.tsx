import { redirect } from "next/navigation";
import { parseScope, scopeHref } from "@/lib/scope";
import { query } from "../_query";

/** The session's old address; the page lives under Logs now (04 §14). */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scope: segment, id } = await params;
  const scope = parseScope({ scope: segment });
  redirect(scopeHref(scope, `/logs/sessions/${id}`) + query(await searchParams));
}
