import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR or data cache: the app renders client-side and reads Supabase directly
export default defineCloudflareConfig({});
