import "server-only";
import { requireAdmin, type TenantContext } from "../context";
import { badRequest, HttpError } from "../errors";
import { supabaseAdmin } from "./supabase-admin";

/**
 * Convida um novo usuário para o tenant DA SESSÃO do admin.
 * Usa service_role apenas para criar o usuário no Auth; o tenant_id vem de
 * ctx (sessão), nunca da requisição.
 */
export async function inviteMember(
  ctx: TenantContext,
  input: { email: string; password: string; display_name: string; role: "admin" | "atendente" },
) {
  requireAdmin(ctx);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw badRequest("Não foi possível criar o usuário (e-mail já cadastrado?)");
  }
  const { error: mErr } = await admin.from("memberships").insert({
    tenant_id: ctx.tenantId,
    user_id: data.user.id,
    role: input.role,
    display_name: input.display_name,
  });
  if (mErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new HttpError(500, "Falha ao vincular usuário ao tenant");
  }
  return { user_id: data.user.id };
}
