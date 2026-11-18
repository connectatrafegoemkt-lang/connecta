import "server-only";
import type { TenantContext } from "../context";
import { supabaseAdmin } from "./supabase-admin";

/** Registra consumo da IA (tela de teste) no tenant DA SESSÃO. Usuários não gravam ai_usage direto. */
export async function recordTestUsage(
  ctx: TenantContext,
  u: { model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number },
) {
  await supabaseAdmin()
    .from("ai_usage")
    .insert({ tenant_id: ctx.tenantId, contact_id: null, kind: "teste", ...u });
}
