import "server-only";
import type { TenantContext } from "../context";
import { fromDbError, notFound } from "../errors";

export interface Interaction {
  id: string;
  contact_id: string;
  type: "nota" | "ligacao" | "email" | "reuniao" | "whatsapp";
  direction: "entrada" | "saida" | "interna";
  body: string;
  status: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_by: string | null;
}

const COLS = "id, contact_id, type, direction, body, status, metadata, occurred_at, created_by";

export async function listInteractions(ctx: TenantContext, contactId: string, limit = 200) {
  const { data, error } = await ctx.db
    .select("interactions", COLS)
    .eq("contact_id", contactId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw fromDbError(error);
  return data as unknown as Interaction[];
}

export async function listRecentInteractions(ctx: TenantContext, limit = 10) {
  const { data, error } = await ctx.db
    .select("interactions", `${COLS}, contacts(name)`)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw fromDbError(error);
  return data as unknown as (Interaction & { contacts: { name: string } | null })[];
}

export async function createInteraction(
  ctx: TenantContext,
  input: { contact_id: string; type: Interaction["type"]; direction?: Interaction["direction"]; body: string; occurred_at?: string },
) {
  const { data, error } = await ctx.db.insert("interactions", input).select(COLS).single();
  if (error) throw fromDbError(error);
  return data as unknown as Interaction;
}

export async function deleteInteraction(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.delete("interactions").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Interação não encontrada");
}
