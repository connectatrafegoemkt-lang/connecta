import "server-only";
import type { TenantContext } from "../context";
import { fromDbError, notFound } from "../errors";

export interface Tag {
  id: string;
  name: string;
  color: string;
  paid_traffic?: boolean;
  wa_label_id?: string | null;
}

export async function listTags(ctx: TenantContext): Promise<Tag[]> {
  const { data, error } = await ctx.db.select("tags", "id, name, color, paid_traffic, wa_label_id").order("name");
  if (error) throw fromDbError(error);
  return data as unknown as Tag[];
}

export async function createTag(ctx: TenantContext, input: { name: string; color?: string }) {
  const { data, error } = await ctx.db.insert("tags", input).select("id, name, color").single();
  if (error) throw fromDbError(error);
  return data as unknown as Tag;
}

export async function updateTag(ctx: TenantContext, id: string, input: { name?: string; color?: string }) {
  const { data, error } = await ctx.db.update("tags", input).eq("id", id).select("id, name, color");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Tag não encontrada");
  return data[0] as unknown as Tag;
}

export async function deleteTag(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.delete("tags").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Tag não encontrada");
}

/** Marca quais etiquetas contam como "tráfego pago" nos relatórios. */
export async function setPaidTrafficTags(ctx: TenantContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const off = ctx.db.update("tags", { paid_traffic: false }).eq("paid_traffic", true);
  const r1 = unique.length ? await off.not("id", "in", `(${unique.join(",")})`) : await off;
  if (r1.error) throw fromDbError(r1.error);
  if (unique.length) {
    const r2 = await ctx.db.update("tags", { paid_traffic: true }).in("id", unique);
    if (r2.error) throw fromDbError(r2.error);
  }
}
