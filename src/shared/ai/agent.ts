import type OpenAI from "openai";
import { z } from "zod";
import { buildSystemPrompt, toMessages, type HistoryItem } from "./prompt";
import type { AiSettings } from "./settings";

/** Modelo da OpenAI usado pelo atendente (configurável por AI_MODEL). */
export const AI_MODEL = process.env.AI_MODEL || "gpt-5.5";

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
};

export interface AiReply {
  reply: string;
  handoff: boolean;
  reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number; model: string };
}

/** Cliente mínimo usado aqui (facilita testes com cliente simulado). */
export type ChatClient = Pick<OpenAI, "chat">;

/**
 * Gera a próxima resposta do atendente (OpenAI Chat Completions, saída
 * estruturada). Se o modelo recusar, cortar a resposta, não houver
 * histórico válido ou a saída vier inválida, devolve transferência para
 * um humano — nunca envia texto estranho ao cliente.
 */
export async function generateReply(opts: {
  client: ChatClient;
  settings: AiSettings;
  companyName: string;
  history: HistoryItem[];
}): Promise<AiReply | null> {
  const messages = toMessages(opts.history.slice(-30));
  if (messages.length === 0) return null;

  const completion = await opts.client.chat.completions.create({
    model: AI_MODEL,
    messages: [{ role: "system", content: buildSystemPrompt(opts.settings, opts.companyName) }, ...messages],
    response_format: {
      type: "json_schema",
      json_schema: { name: "resposta_atendimento", strict: true, schema: REPLY_JSON_SCHEMA },
    },
  });

  const usage = {
    input_tokens: completion.usage?.prompt_tokens ?? 0,
    output_tokens: completion.usage?.completion_tokens ?? 0,
    cache_read_tokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    model: completion.model ?? AI_MODEL,
  };
  const handoff = (reason: string): AiReply => ({ reply: opts.settings.handoff_message, handoff: true, reason, usage });

  const choice = completion.choices?.[0];
  if (!choice) return handoff("Sem resposta do modelo");
  if (choice.message?.refusal) return handoff("O modelo recusou responder");
  if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") {
    return handoff("Resposta interrompida pelo modelo");
  }
  let parsed: z.infer<typeof replySchema>;
  try {
    parsed = replySchema.parse(JSON.parse(choice.message?.content ?? ""));
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
