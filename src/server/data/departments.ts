import "server-only";
import { requirePerm, type TenantContext } from "../context";
import { fromDbError, notFound } from "../errors";

export interface Department {
  id: string;
  name: string;
  color: string;
}

export async function listDepartments(ctx: TenantContext): Promise<Department[]> {
  const { data, error } = await ctx.db.select("departments", "id, name, color").order("name");
  if (error) throw fromDbError(error);
  return data as unknown as Department[];
}

export async function createDepartment(ctx: TenantContext, input: { name: string; color?: string }) {
  requirePerm(ctx, "equipe.gerenciar");
  const { data, error } = await ctx.db.insert("departments", input).select("id, name, color").single();
  if (error) throw fromDbError(error);
  return data as unknown as Department;
}

export async function updateDepartment(ctx: TenantContext, id: string, input: { name?: string; color?: string }) {
  requirePerm(ctx, "equipe.gerenciar");
  const { data, error } = await ctx.db.update("departments", input).eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Setor não encontrado");
}

/** Contatos do setor ficam "sem setor" (o banco cuida disso num trigger). */
export async function deleteDepartment(ctx: TenantContext, id: string) {
  requirePerm(ctx, "equipe.gerenciar");
  const { data, error } = await ctx.db.delete("departments").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Setor não encontrado");
}
