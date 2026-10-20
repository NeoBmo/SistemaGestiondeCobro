import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "@/shared/validation/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL("/", getPublicSiteUrl()).toString() }];
}
