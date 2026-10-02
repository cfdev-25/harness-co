/** The search params as they were asked, for a redirect that keeps them:
 *  the filters and `?person=` are the state (02 rule 16). */
export function query(search: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, one);
    }
  }
  const asked = params.toString();
  return asked ? `?${asked}` : "";
}
