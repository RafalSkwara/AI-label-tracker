import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Cache Components stay off: workerd's setTimeout makes them hang (wrangler dev returned 500)
const nextConfig: NextConfig = {};

export default nextConfig;

initOpenNextCloudflareForDev();
