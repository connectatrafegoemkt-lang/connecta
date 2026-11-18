import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildSystemPrompt, toMessages, type HistoryItem } from "./prompt";
import type { AiSettings } from "./settings";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

const replySchema = z.object({
  resposta: z.string().max(4000),
  transferir_para_humano: z.boolean(),
  motivo: z.string().max(500),
});

const REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    resposta: { type: "string", description: "Mensagem a enviar ao cliente no WhatsApp" },
    transferir_para_humano: { type: "boolean" },
    motivo: { type: "string", description: "Motivo curto, uso interno" },
  },
  required: ["resposta", "transferir_para_humano", "motivo"],
  additionalProperties: false,
} as const;

export interface AiReply {
  reply: string;
  handoff: boolean;
  reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; model: string };
}

/**
 * Gera a próxima resposta do atendente. Chamada única ao Claude, com saída
 * estruturada. Se o modelo recusar, não houver histórico válido ou a saída
 * vier inválida, devolve handoff para um humano (nunca envia texto vazio).
 */
export async function generateReply(opts: {
  client: Anthropic;
  settings: AiSettings;
  companyName: string;
  history: HistoryItem[];
}): Promise<AiReply | null> {
  const messages = toMessages(opts.history.slice(-30));
  if (messages.length === 0) return null;

  const response = await opts.client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: buildSystemPrompt(opts.settings, opts.companyName), cache_control: { type: "ephemeral" } },
    ],
    messages,
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLY_JSON_SCHEMA } },
  });

  const usage = {
    input_tokens: response.usage.input_tokens ?? 0,
    output_tokens: response.usage.output_tokens ?? 0,
    cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
    model: response.model,
  };
  const handoff = (reason: string): AiReply => ({ reply: opts.settings.handoff_message, handoff: true, reason, usage });

  if (response.stop_reason === "refusal") return handoff("O modelo recusou responder");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: z.infer<typeof replySchema>;
  try {
    parsed = replySchema.parse(JSON.parse(text));
  } catch {
    return handoff("Resposta da IA em formato inválido");
  }
  if (parsed.transferir_para_humano) {
    const reply = parsed.resposta.trim() || opts.settings.handoff_message;
    return { reply, handoff: true, reason: parsed.motivo, usage };
  }
  if (!parsed.resposta.trim()) return handoff("Resposta vazia");
  return { reply: parsed.resposta.trim(), handoff: false, reason: parsed.motivo, usage };
}
