import type { MetadataRoute } from "next";

const BASE_URL = "https://solana.traxr.pro";

const PUBLIC_ROUTES = [
  { path: "", priority: 1, changeFrequency: "daily" as const },
  { path: "/docs", priority: 0.82, changeFrequency: "monthly" as const },
  { path: "/methodology", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/architecture", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/api-preview", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/data-model", priority: 0.75, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.45, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.45, changeFrequency: "yearly" as const },
  { path: "/contact", priority: 0.55, changeFrequency: "yearly" as const },
  { path: "/integrate", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/lab/trajectory-3d", priority: 0.5, changeFrequency: "monthly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
