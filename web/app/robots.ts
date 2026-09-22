import type { MetadataRoute } from "next";

/** The marketing pages are public; the console and its sign-in are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/login"] }],
  };
}
