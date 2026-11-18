import type { InboundRepo } from "./repo";
import { isIndividualChat, jidToPhone, phoneCandidates } from "./phone";

/** Subconjunto do WAMessage do Baileys que usamos. */
export interface IncomingMessage {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    fromMe?: boolean | null;
  };
  pushName?: string | null;
  messageTimestamp?: number | { toNumber(): number } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message?: Record<string, any> | null;
}

/** Extrai um texto legível da mensagem (ou null se não for conteúdo). */
export function extractText(message: IncomingMessage["message"]): string | null {
  if (!message) return null;
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption ? `[imagem] ${m.imageMessage.caption}` : "[imagem]";
  if (m.videoMessage) return m.videoMessage.caption ? `[vídeo] ${m.videoMessage.caption}` : "[vídeo]";
  if (m.audioMessage) return "[áudio]";
  if (m.documentMessage) return `[documento] ${m.documentMessage.fileName ?? ""}`.trim();
  if (m.stickerMessage) return "[figurinha]";
  if (m.locationMessage) return "[localização]";
  if (m.contactMessage) return `[contato] ${m.contactMessage.displayName ?? ""}`.trim();
  if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  return null; // protocolMessage, reactionMessage, etc.
}

function timestamp(ts: IncomingMessage["messageTimestamp"]): string {
  const n = typeof ts === "number" ? ts : ts && typeof ts === "object" ? ts.toNumber() : 0;
  return n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

export type InboundResult = "stored" | "duplicate" | "ignored";

/**
 * Converte uma mensagem do WhatsApp em interação NO TENANT DO REPOSITÓRIO
 * (o tenant dono da sessão que recebeu a mensagem). Procura o contato pelo
 * telefone somente dentro desse tenant; se não existir, cria.
 */
export interface StoredInfo {
  contactId: string;
  fromMe: boolean;
}

export async function handleIncoming(
  repo: InboundRepo,
  msg: IncomingMessage,
  onStored?: (info: StoredInfo) => void,
): Promise<InboundResult> {
  const id = msg.key.id;
  const jid = msg.key.remoteJid;
  if (!id || !isIndividualChat(jid)) return "ignored";
  const body = extractText(msg.message);
  if (body === null) return "ignored";

  // Em contas com LID o telefone real vem em remoteJidAlt.
  const phone = jidToPhone(jid) ?? jidToPhone(msg.key.remoteJidAlt);
  if (!phone) return "ignored";

  const candidates = phoneCandidates(phone);
  let contact = await repo.findContactByPhones(candidates);
  if (!contact) {
    const name = (!msg.key.fromMe && msg.pushName?.trim()) || `+${phone}`;
    contact = await repo.createContact({ name: name.slice(0, 200), phone });
  }

  const row = await repo.insertInteraction({
    contact_id: contact.id,
    direction: msg.key.fromMe ? "saida" : "entrada",
    body: body.slice(0, 20000),
    external_id: id,
    occurred_at: timestamp(msg.messageTimestamp),
    status: msg.key.fromMe ? "enviado" : "recebido",
    metadata: { jid },
  });
  if (row) onStored?.({ contactId: contact.id, fromMe: Boolean(msg.key.fromMe) });
  return row ? "stored" : "duplicate";
}

/** Status numérico do Baileys (proto.WebMessageInfo.Status) → texto. */
export function ackToStatus(status: number | null | undefined): string | null {
  switch (status) {
    case 0:
      return "erro";
    case 1:
      return "pendente";
    case 2:
      return "enviado";
    case 3:
      return "entregue";
    case 4:
    case 5:
      return "lido";
    default:
      return null;
  }
}
