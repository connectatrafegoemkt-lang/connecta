import "server-only";
import { requirePerm, type TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";
import type { Permission, Profile } from "@/shared/permissions";

export interface Member {
  id: string;
  user_id: string;
  role: "admin" | "atendente";
  profile: Profile;
  permissions: Permission[];
  department_ids: string[];
  display_name: string | null;
  created_at: string;
}

type RawMember = Omit<Member, "department_ids">;

export async function listMembers(ctx: TenantContext): Promise<Member[]> {
  const [m, d] = await Promise.all([
    ctx.db.select("memberships", "id, user_id, role, profile, permissions, display_name, created_at").order("created_at"),
    ctx.db.select("member_departments", "user_id, department_id"),
  ]);
  if (m.error) throw fromDbError(m.error);
  if (d.error) throw fromDbError(d.error);
  const byUser = new Map<string, string[]>();
  for (const r of d.data as unknown as { user_id: string; department_id: string }[]) {
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.department_id]);
  }
  return (m.data as unknown as RawMember[]).map((r) => ({ ...r, department_ids: byUser.get(r.user_id) ?? [] }));
}

export async function assertOwnDepartments(ctx: TenantContext, ids: string[]) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const { count, error } = await ctx.db.select("departments", "id", { count: "exact", head: true }).in("id", unique);
  if (error) throw fromDbError(error);
  if (count !== unique.length) throw badRequest("Setor inválido");
}

/** Substitui os setores de um membro (RLS + trigger de guarda no banco). */
export async function setMemberDepartments(ctx: TenantContext, userId: string, ids: string[]) {
  requirePerm(ctx, "equipe.gerenciar");
  await assertOwnDepartments(ctx, ids);
  const del = await ctx.db.delete("member_departments").eq("user_id", userId);
  if (del.error) throw fromDbError(del.error);
  if (ids.length) {
    const ins = await ctx.db.insert(
      "member_departments",
      [...new Set(ids)].map((department_id) => ({ user_id: userId, department_id })),
    );
    if (ins.error) throw fromDbError(ins.error);
  }
}

export async function updateMember(
  ctx: TenantContext,
  id: string,
  input: { profile?: Profile; permissions?: Permission[]; department_ids?: string[]; display_name?: string },
) {
  requirePerm(ctx, "equipe.gerenciar");
  const { department_ids, ...fields } = input;
  const { data, error } = await ctx.db
    .update("memberships", fields)
    .eq("id", id)
    .select("user_id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Membro não encontrado");
  if (department_ids) {
    await setMemberDepartments(ctx, (data[0] as unknown as { user_id: string }).user_id, department_ids);
  }
}

export async function removeMember(ctx: TenantContext, id: string) {
  requirePerm(ctx, "equipe.gerenciar");
  const { data, error } = await ctx.db.delete("memberships").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Membro não encontrado");
}

// Convite usa service_role internamente (somente para criar o usuário no Auth).
export { inviteMember } from "../admin/members-admin";
