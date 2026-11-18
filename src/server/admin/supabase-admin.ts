import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Cliente service_role — BYPASSA RLS.
 * Regras: só pode ser importado dentro de src/server/admin/ e todo uso
 * precisa receber um tenantId vindo de getTenantContext() (sessão), nunca
 * do front. O ESLint bloqueia importações fora desta pasta.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  cached ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
