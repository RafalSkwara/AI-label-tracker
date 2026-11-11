import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Cache Components stay off: workerd's setTimeout makes them hang (wrangler dev returned 500)
const nextConfig: NextConfig = {};

export default nextConfig;

// No remote bindings in `next dev`/`next build`: Workers AI is remote-only and would need a Cloudflare login
// (or CLOUDFLARE_API_TOKEN) just to build. Receipt reading therefore works only on the deployed Worker.
initOpenNextCloudflareForDev({ remoteBindings: false });
