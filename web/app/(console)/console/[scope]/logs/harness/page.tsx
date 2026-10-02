import { redirect } from "next/navigation";
import { parseScope, scopeHref } from "@/lib/scope";
import { CHANGES } from "@/lib/views/logs";

/**
 * The harness log is called **Changes** now (04 §14), and this was its
 * address for two waves. It is its own route rather than a branch inside
 * `[category]`: a static segment wins over the dynamic one, and it carries
 * no `loading.tsx`, so the redirect is the response rather than a hop the
 * browser makes after the shell has already streamed.
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  redirect(scopeHref(parseScope(await params), `/logs/${CHANGES}`));
}
