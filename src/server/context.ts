import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bearerFrom, createUserClient } from "./supabase/user-client";
import { TenantDb } from "./data/tenant-db";
import { forbidden, unauthorized } from "./errors";

export type TenantRole = "admin" | "atendente";

export interface TenantContext {
  userId: string;
  tenantId: string;
  tenantName: string;
  role: TenantRole;
  displayName: string | null;
  db: TenantDb;
  /** Cliente do usuário (RLS). Use `db` sempre que possível. */
  supabase: SupabaseClient;
}

/**
 * Resolve o contexto do tenant A PARTIR DA SESSÃO (cookie ou Bearer).
 * O tenant vem do banco (`current_context()`, que lê auth.uid() do JWT
 * validado). Nenhum parâmetro do front é considerado.
 */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const h = await headers();
  const supabase = await createUserClient(bearerFrom(h));
  const { data, error } = await supabase.rpc("current_context");
  if (error) {
    // JWT inválido/expirado → PostgREST responde 401 (PGRST301/PGRST303)
    throw unauthorized();
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    // Autenticado, mas sem vínculo com nenhum tenant.
    throw forbidden("Usuário sem acesso a nenhum tenant");
  }
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role: row.role,
    displayName: row.display_name,
    db: new TenantDb(supabase, row.tenant_id),
    supabase,
  };
});

export function requireAdmin(ctx: TenantContext) {
  if (ctx.role !== "admin") throw forbidden("Apenas administradores");
}
