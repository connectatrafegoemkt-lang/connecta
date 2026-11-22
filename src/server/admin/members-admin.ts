import "server-only";
import { requirePerm, type TenantContext } from "../context";
import { badRequest, fromDbError } from "../errors";
import { assertOwnDepartments, setMemberDepartments } from "../data/members";
import type { Permission, Profile } from "@/shared/permissions";
import { supabaseAdmin } from "./supabase-admin";
import { MUST_CHANGE } from "./passwords";

/**
 * Cria um usuário na empresa DA SESSÃO de quem convida.
 * O service_role é usado só para criar o login no Auth. O vínculo (perfil,
 * permissões e setores) é gravado com o cliente do próprio usuário (ctx.db),
 * então as regras do banco valem: RLS por tenant, 'equipe.gerenciar' e a
 * trava contra escalada de privilégio (gerente não cria admin nem concede o
 * que não tem). Se o vínculo falhar, o login criado é apagado.
 */
export async function inviteMember(
  ctx: TenantContext,
  input: {
    email: string;
    password: string;
    display_name: string;
    profile: Profile;
    permissions?: Permission[];
    department_ids?: string[];
  },
) {
  requirePerm(ctx, "equipe.gerenciar");
  // Valida antes de criar o login: setores precisam ser do próprio tenant.
  await assertOwnDepartments(ctx, input.department_ids ?? []);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: MUST_CHANGE, // senha provisória: troca obrigatória no 1º acesso
  });
  if (error || !data.user) {
    throw badRequest("Não foi possível criar o usuário (e-mail já cadastrado?)");
  }
  const userId = data.user.id;
  try {
    const row: Record<string, unknown> = {
      user_id: userId,
      profile: input.profile,
      role: input.profile === "admin" ? "admin" : "atendente",
      display_name: input.display_name,
    };
    if (input.permissions) row.permissions = input.permissions;
    const { error: mErr } = await ctx.db.insert("memberships", row);
    if (mErr) throw fromDbError(mErr);
    if (input.department_ids?.length) await setMemberDepartments(ctx, userId, input.department_ids);
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);
    throw e;
  }
  return { user_id: userId };
}
