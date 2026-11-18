import "server-only";
import OpenAI from "openai";
import { requirePerm, type TenantContext } from "../context";
import { badRequest, fromDbError, HttpError, notFound } from "../errors";
import { generateReply } from "@/shared/ai/agent";
import { aiSettingsSchema, settingsFromRow, type AiSettings } from "@/shared/ai/settings";
import type { HistoryItem } from "@/shared/ai/prompt";
import { recordTestUsage } from "../admin/ai-usage";

export async function getAiSettings(ctx: TenantContext): Promise<AiSettings> {
  const { data, error } = await ctx.db.select("ai_settings", "*").maybeSingle();
  if (error) throw fromDbError(error);
  return settingsFromRow(data as Record<string, unknown> | null);
}

export async function saveAiSettings(ctx: TenantContext, input: unknown): Promise<AiSettings> {
  requirePerm(ctx, "ia.configurar");
  const parsed = aiSettingsSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Configuração inválida");
  const exists = await ctx.db.select("ai_settings", "tenant_id").maybeSingle();
  if (exists.error) throw fromDbError(exists.error);
  const op = exists.data
    ? ctx.db.update("ai_settings", parsed.data)
    : ctx.db.insert("ai_settings", parsed.data);
  const { error } = await op;
  if (error) throw fromDbError(error);
  return parsed.data;
}

export async function aiUsageSummary(ctx: TenantContext) {
  requirePerm(ctx, "ia.configurar");
  const { data, error } = await ctx.db.rpc("ai_usage_summary");
  if (error) throw fromDbError(error);
  return data as { mensagens: number; testes: number; input_tokens: number; output_tokens: number };
}

export async function listPendingSuggestion(ctx: TenantContext, contactId: string) {
  const { data, error } = await ctx.db
    .select("ai_suggestions", "id, body, created_at")
    .eq("contact_id", contactId)
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data as unknown as { id: string; body: string; created_at: string } | null;
}

export async function setSuggestionStatus(ctx: TenantContext, id: string, status: "usada" | "descartada") {
  const { data, error } = await ctx.db.update("ai_suggestions", { status }).eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Sugestão não encontrada");
}

/** Pausa ou reativa a IA numa conversa (qualquer membro do tenant). */
export async function setContactAi(ctx: TenantContext, contactId: string, active: boolean) {
  const { data, error } = await ctx.db
    .update("contacts", { ai_paused_until: active ? null : "infinity" })
    .eq("id", contactId)
    .select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Contato não encontrado");
}

let client: OpenAI | null = null;
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "IA não configurada no servidor (OPENAI_API_KEY)");
  client ??= new OpenAI();
  return client;
}

/** Simula o atendimento com a configuração (salva ou em edição) — só admin. */
export async function testAiReply(ctx: TenantContext, settingsInput: unknown, history: HistoryItem[]) {
  requirePerm(ctx, "ia.configurar");
  const parsed = aiSettingsSchema.safeParse(settingsInput);
  if (!parsed.success) throw badRequest("Configuração inválida");
  const reply = await generateReply({
    client: openai(),
    settings: { ...parsed.data, mode: "automatico" },
    companyName: ctx.tenantName,
    history: history.slice(-20),
  });
  if (!reply) throw badRequest("Escreva uma mensagem de cliente para testar");
  await recordTestUsage(ctx, reply.usage).catch(() => undefined);
  return { reply: reply.reply, handoff: reply.handoff, reason: reply.reason };
}
