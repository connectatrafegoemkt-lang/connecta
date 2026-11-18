import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bearerFrom, createUserClient } from "./supabase/user-client";
import { forbidden, fromDbError, unauthorized } from "./errors";

/**
 * Painel da CONNECTA (administração da plataforma).
 *
 * Quem é administrador da plataforma é decidido NO BANCO
 * (`public.is_platform_admin()`, lendo `app.platform_admins` pelo auth.uid()
 * do JWT). Nada vindo do front é considerado.
 */
export interface PlatformContext {
  readonly kind: "platform";
  supabase: SupabaseClient;
}

export const getPlatformContext = cache(async (): Promise<PlatformContext> => {
  const supabase = await createUserClient(bearerFrom(await headers()));
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) throw unauthorized();
  if (data !== true) throw forbidden("Apenas a equipe CONNECTA");
  return { kind: "platform", supabase };
});

/** Para mostrar ou esconder o link do painel. Nunca lança erro. */
export async function isPlatformAdmin(): Promise<boolean> {
  try {
    await getPlatformContext();
    return true;
  } catch {
    return false;
  }
}

export interface ClientTenant {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  members: number;
  contacts: number;
  whatsapp_status: string | null;
  ai_mode: string | null;
  ai_messages_month: number;
  ai_tokens_month: number;
}

/** Só metadados dos clientes; a autorização é refeita dentro da função do banco. */
export async function listClientTenants(p: PlatformContext): Promise<ClientTenant[]> {
  const { data, error } = await p.supabase.rpc("platform_tenants_overview");
  if (error) throw fromDbError(error);
  return (data as ClientTenant[]).map((t) => ({ ...t, ai_tokens_month: Number(t.ai_tokens_month) }));
}

export { createClientTenant } from "./admin/platform-admin";
