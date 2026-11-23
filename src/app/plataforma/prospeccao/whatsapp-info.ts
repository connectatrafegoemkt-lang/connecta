import "server-only";
import { getTenantContext } from "@/server/context";
import { getWhatsappSession } from "@/server/data/whatsapp";
import { listQuickReplies, listScheduledMessages, type ScheduledMessage } from "@/server/data/whatsapp-media";
import type { QuickReplyOpt } from "./whatsapp-dialog";

/**
 * WhatsApp da empresa de quem está logado (a CONNECTA no CRM): situação da
 * conexão e mensagens rápidas, para enviar às leads da prospecção.
 * connected = null quando o usuário não está ligado a nenhuma empresa.
 */
export async function ownWhatsappInfo(): Promise<{ connected: boolean | null; quickReplies: QuickReplyOpt[]; scheduled: ScheduledMessage[] }> {
  try {
    const ctx = await getTenantContext();
    const [session, qr, scheduled] = await Promise.all([
      getWhatsappSession(ctx),
      listQuickReplies(ctx).catch(() => []),
      listScheduledMessages(ctx).catch(() => []),
    ]);
    return {
      connected: session.status === "conectado",
      quickReplies: qr.map((q) => ({ shortcut: q.shortcut, title: q.title, body: q.body })),
      scheduled,
    };
  } catch {
    return { connected: null, quickReplies: [], scheduled: [] };
  }
}
