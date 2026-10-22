import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR or data cache: the app renders client-side and reads Supabase directly.
// `npm run build` is the OpenNext build (what Workers Builds runs by default), so OpenNext must call next directly.
export default {
  ...defineCloudflareConfig({}),
  buildCommand: "npx next build",
};
