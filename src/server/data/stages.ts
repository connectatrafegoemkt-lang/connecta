import "server-only";
import { requirePerm, type TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";

export interface Stage {
  id: string;
  name: string;
  position: number;
  color: string;
  is_won: boolean;
  is_lost: boolean;
}

const COLS = "id, name, position, color, is_won, is_lost";

export async function listStages(ctx: TenantContext): Promise<Stage[]> {
  const { data, error } = await ctx.db.select("pipeline_stages", COLS).order("position");
  if (error) throw fromDbError(error);
  return data as unknown as Stage[];
}

export async function createStage(ctx: TenantContext, input: Partial<Stage> & { name: string }) {
  requirePerm(ctx, "configuracoes.gerenciar");
  const stages = await listStages(ctx);
  const position = input.position ?? (stages.at(-1)?.position ?? -1) + 1;
  const { data, error } = await ctx.db
    .insert("pipeline_stages", { ...input, position })
    .select(COLS)
    .single();
  if (error) throw fromDbError(error);
  return data as unknown as Stage;
}

export async function updateStage(ctx: TenantContext, id: string, input: Partial<Stage>) {
  requirePerm(ctx, "configuracoes.gerenciar");
  const { data, error } = await ctx.db.update("pipeline_stages", input).eq("id", id).select(COLS);
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Etapa não encontrada");
  return data[0] as unknown as Stage;
}

export async function reorderStages(ctx: TenantContext, ids: string[]) {
  requirePerm(ctx, "configuracoes.gerenciar");
  for (const [position, id] of ids.entries()) {
    const { error } = await ctx.db.update("pipeline_stages", { position }).eq("id", id);
    if (error) throw fromDbError(error);
  }
}

export async function deleteStage(ctx: TenantContext, id: string) {
  requirePerm(ctx, "configuracoes.gerenciar");
  const used = await ctx.db.select("contacts", "id", { count: "exact", head: true }).eq("stage_id", id);
  if ((used.count ?? 0) > 0) throw badRequest("Mova os contatos desta etapa antes de excluí-la");
  const { data, error } = await ctx.db.delete("pipeline_stages").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Etapa não encontrada");
}
