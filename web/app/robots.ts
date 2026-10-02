import type { MetadataRoute } from "next";

/**
 * The marketing pages are public; the console and its sign-in are not.
 * The fixture-driven prototypes that used to be disallowed here — and the
 * three `/*-preview` routes with them — are deleted (00 §7, 06 K-M1/K-M3),
 * so only the private entrances remain.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/console", "/login"],
      },
    ],
  };
}
