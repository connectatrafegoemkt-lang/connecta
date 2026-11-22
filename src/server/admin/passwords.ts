import "server-only";
import { createUserClient } from "../supabase/user-client";
import { forbidden, badRequest, fromDbError, HttpError, notFound, unauthorized } from "../errors";
import { requirePerm, type TenantContext } from "../context";
import type { PlatformContext } from "../platform";
import { supabaseAdmin } from "./supabase-admin";

/**
 * Senha provisória: quem cria (ou redefine) o acesso define uma senha; o
 * usuário entra com ela e é obrigado a trocar antes de usar o CRM.
 *
 * A marca fica em `app_metadata.must_change_password` (só o service_role
 * altera app_metadata; o próprio usuário NÃO consegue apagá-la pelo Auth).
 * O proxy lê a marca do JWT e manda para /trocar-senha.
 */
export const MUST_CHANGE = { must_change_password: true } as const;

export function needsPasswordChange(appMetadata: unknown): boolean {
  return !!appMetadata && typeof appMetadata === "object" && (appMetadata as Record<string, unknown>).must_change_password === true;
}

/** Define a senha provisória de um usuário e exige a troca no próximo acesso. */
async function setProvisionalPassword(userId: string, password: string) {
  const admin = supabaseAdmin();
  const { data: u, error: e1 } = await admin.auth.admin.getUserById(userId);
  if (e1 || !u.user) throw notFound("Usuário não encontrado");
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { ...(u.user.app_metadata ?? {}), ...MUST_CHANGE },
  });
  if (error) throw badRequest("Não foi possível redefinir a senha (senha fraca?)");
}

/**
 * Equipe: redefine a senha de alguém DA EMPRESA DA SESSÃO. O vínculo é lido
 * com o cliente do próprio usuário (RLS), então não alcança outro tenant.
 * Gerente não redefine senha de administrador (evita tomar a conta dele).
 */
export async function resetMemberPassword(ctx: TenantContext, membershipId: string, password: string) {
  requirePerm(ctx, "equipe.gerenciar");
  const { data, error } = await ctx.db.select("memberships", "user_id, profile").eq("id", membershipId).maybeSingle();
  if (error) throw fromDbError(error);
  const m = data as unknown as { user_id: string; profile: string } | null;
  if (!m) throw notFound("Pessoa não encontrada na sua equipe");
  if (m.user_id === ctx.userId) throw badRequest("Para trocar a sua própria senha, use “Trocar senha”.");
  if (m.profile === "admin" && ctx.role !== "admin") throw forbidden("Só um administrador redefine a senha de outro administrador");
  await setProvisionalPassword(m.user_id, password);
}

/**
 * Painel da CONNECTA: redefine a senha de um usuário de um cliente, a partir
 * do e-mail. Confere que o e-mail é de alguém daquele cliente.
 */
export async function resetClientUserPassword(_p: PlatformContext, tenantId: string, email: string, password: string) {
  if (_p?.kind !== "platform") throw forbidden("Apenas a equipe CONNECTA");
  const admin = supabaseAdmin();
  const { data: members, error } = await admin.from("memberships").select("user_id").eq("tenant_id", tenantId);
  if (error) throw new HttpError(500, "Falha ao ler a equipe do cliente");
  const wanted = email.trim().toLowerCase();
  for (const { user_id } of (members ?? []) as { user_id: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(user_id);
    if (u.user?.email?.toLowerCase() === wanted) {
      await setProvisionalPassword(user_id, password);
      return;
    }
  }
  throw notFound("Esse e-mail não é de ninguém deste cliente");
}

/**
 * O próprio usuário troca a senha (provisória ou não). A troca é feita com
 * a sessão dele; só depois a marca é removida (service_role, pelo id da
 * sessão) e a sessão é renovada para o JWT novo sair sem a marca.
 */
export async function changeOwnPassword(newPassword: string) {
  const sb = await createUserClient();
  const { data: auth, error: e0 } = await sb.auth.getUser();
  if (e0 || !auth.user) throw unauthorized();
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.code === "same_password") throw badRequest("A nova senha precisa ser diferente da senha provisória.");
    if (error.code === "weak_password") throw badRequest("Senha fraca. Use pelo menos 10 caracteres, misturando letras e números.");
    throw badRequest("Não foi possível trocar a senha. Tente novamente.");
  }
  if (needsPasswordChange(auth.user.app_metadata)) {
    const { error: e2 } = await supabaseAdmin().auth.admin.updateUserById(auth.user.id, {
      app_metadata: { ...auth.user.app_metadata, must_change_password: false },
    });
    if (e2) throw new HttpError(500, "Senha trocada, mas não foi possível liberar o acesso. Fale com a CONNECTA.");
  }
  await sb.auth.refreshSession();
}
