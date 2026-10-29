import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output
    ".open-next/**",
    ".wrangler/**",
  ]),
  // Zapasy isolation: the supplies module and the rest of the app must not import each other.
  {
    files: ["src/features/supplies/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@/components/*", "@/shell/*", "@/features/admin/*"], message: "The supplies module is isolated." },
        { regex: "^@/lib/(?!supabase$)", message: "The supplies module may import only @/lib/supabase." },
      ] }],
    },
  },
  {
    files: ["src/components/**", "src/lib/**", "src/shell/**", "src/features/admin/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/features/supplies*"], message: "Only src/app/zapasy/page.tsx may import the supplies module." }] }],
    },
  },
]);

export default eslintConfig;
