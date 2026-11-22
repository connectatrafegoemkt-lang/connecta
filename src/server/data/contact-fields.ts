import "server-only";
import { requirePerm, type TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";
import { fieldKeyFrom, type ContactFieldDef } from "@/shared/custom-fields";
import type { FieldType } from "@/shared/niches";

const COLS = "id, key, label, type, options, position";

/** Campos extras da ficha do lead do tenant da sessão. */
export async function listContactFields(ctx: TenantContext): Promise<ContactFieldDef[]> {
  const { data, error } = await ctx.db.select("contact_fields", COLS).order("position").order("created_at");
  if (error) throw fromDbError(error);
  return (data as unknown as (ContactFieldDef & { options: unknown })[]).map((f) => ({
    ...f,
    options: Array.isArray(f.options) ? (f.options as unknown[]).filter((o): o is string => typeof o === "string") : [],
  }));
}

export async function createContactField(
  ctx: TenantContext,
  input: { label: string; type: FieldType; options?: string[] },
): Promise<ContactFieldDef> {
  requirePerm(ctx, "configuracoes.gerenciar");
  const options = [...new Set(input.options ?? [])];
  if (input.type === "opcoes" && options.length === 0) throw badRequest("Informe as opções da lista (separadas por vírgula)");
  const existing = await listContactFields(ctx);
  const used = new Set(existing.map((f) => f.key));
  const base = fieldKeyFrom(input.label);
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  const position = existing.reduce((m, f) => Math.max(m, f.position ?? 0), -1) + 1;
  const { data, error } = await ctx.db
    .insert("contact_fields", { key, label: input.label, type: input.type, options: input.type === "opcoes" ? options : [], position })
    .select(COLS)
    .single();
  if (error) throw fromDbError(error);
  return data as unknown as ContactFieldDef;
}

export async function deleteContactField(ctx: TenantContext, id: string) {
  requirePerm(ctx, "configuracoes.gerenciar");
  const { data, error } = await ctx.db.delete("contact_fields").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Campo não encontrado");
}
