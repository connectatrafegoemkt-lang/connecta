import "server-only";
import { requireAdmin, type TenantContext } from "../context";
import { fromDbError, notFound } from "../errors";

export interface Member {
  id: string;
  user_id: string;
  role: "admin" | "atendente";
  display_name: string | null;
  created_at: string;
}

export async function listMembers(ctx: TenantContext): Promise<Member[]> {
  const { data, error } = await ctx.db
    .select("memberships", "id, user_id, role, display_name, created_at")
    .order("created_at");
  if (error) throw fromDbError(error);
  return data as unknown as Member[];
}

export async function updateMember(
  ctx: TenantContext,
  id: string,
  input: { role?: Member["role"]; display_name?: string },
) {
  requireAdmin(ctx);
  const { data, error } = await ctx.db.update("memberships", input).eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Membro não encontrado");
}

export async function removeMember(ctx: TenantContext, id: string) {
  requireAdmin(ctx);
  const { data, error } = await ctx.db.delete("memberships").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Membro não encontrado");
}

// Convite usa service_role internamente (somente para criar o usuário no Auth).
export { inviteMember } from "../admin/members-admin";
