import { redirect } from "next/navigation";
import { parseScope, scopeHref } from "@/lib/scope";

/** The scope root is not a screen: it forwards to Harnesses (00 §5). */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params;
  redirect(scopeHref(parseScope({ scope }), "/harnesses"));
}
