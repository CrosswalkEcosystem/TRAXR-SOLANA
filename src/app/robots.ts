import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: "https://solana.traxr.pro/sitemap.xml",
    host: "https://solana.traxr.pro",
  };
}
