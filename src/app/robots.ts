import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || "http://localhost:3000";
  if ((await getSettings()).siteVisibility === "private") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/help", disallow: ["/admin", "/api", "/login"] },
    sitemap: `${origin}/sitemap.xml`,
  };
}
