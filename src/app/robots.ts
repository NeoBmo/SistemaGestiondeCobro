import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "@/shared/validation/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", getPublicSiteUrl()).toString(),
  };
}
