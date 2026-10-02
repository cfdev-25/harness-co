import { BoundariesScreen, boundariesContext } from "../_screen";

/** Boundaries → Files (04 §9, W6-D8): the paths a session may never read or
 *  write. Two blocks and nothing else — a path boundary is `enforced` by the
 *  jail's own geometry (engine 06 §7), so there is nothing here to explain
 *  about who holds it. */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  return <BoundariesScreen tab="files" ctx={await boundariesContext("files", params)} />;
}
