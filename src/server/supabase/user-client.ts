import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";

/**
 * Cliente Supabase com a identidade do USUÁRIO (RLS sempre aplicado).
 * - Com `Authorization: Bearer <jwt>` (clientes de API): usa o token.
 * - Caso contrário: usa a sessão dos cookies (navegador).
 * Nunca usa service_role.
 */
export async function createUserClient(bearer?: string | null): Promise<SupabaseClient> {
  if (bearer) {
    return createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
  }
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Em Server Components cookies são somente leitura; o proxy renova a sessão.
        }
      },
    },
  });
}

export function bearerFrom(headers: Headers): string | null {
  const h = headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}
