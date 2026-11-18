import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "worker/dist/**"]),

  // ISOLAMENTO: acesso a dados só pela camada src/server/.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/proxy.ts", "src/lib/supabase-browser.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@supabase/supabase-js", message: "Use a camada src/server/data (getTenantContext)." },
            { name: "@supabase/ssr", message: "Use a camada src/server/data (getTenantContext)." },
          ],
          patterns: [
            { group: ["@/server/admin/*"], message: "service_role só pode ser usado dentro de src/server." },
          ],
        },
      ],
    },
  },
  // service_role restrito a src/server/admin
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/admin/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "env", property: "supabaseServiceRoleKey", message: "service_role só em src/server/admin." },
      ],
    },
  },
]);

export default eslintConfig;
