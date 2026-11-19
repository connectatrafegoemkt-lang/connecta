/**
 * Mensagens que ficaram presas em "enviando" porque o worker foi reiniciado
 * no meio do envio (ex.: durante um deploy). Nunca reenviamos às cegas (o
 * cliente receberia em dobro): se a mensagem já aparece na conversa como
 * enviada, marcamos como enviada; senão, como erro com aviso claro.
 */
export interface StuckOutboxItem {
  id: string;
  contact_id: string;
  body: string;
  created_at: string;
}

export interface OutboxRecoveryRepo {
  listStuckOutbox(olderThanIso: string): Promise<StuckOutboxItem[]>;
  findSentInteraction(contactId: string, body: string, sinceIso: string): Promise<{ id: string } | null>;
  finishOutbox(id: string, status: "enviado" | "erro", extra?: { error?: string; interaction_id?: string }): Promise<void>;
}

export const INTERRUPTED_MESSAGE =
  "Envio interrompido (o sistema reiniciou). Confira no celular se a mensagem chegou e reenvie se precisar.";

export async function recoverStuckOutbox(repo: OutboxRecoveryRepo, now = Date.now(), staleMs = 60_000) {
  const stuck = await repo.listStuckOutbox(new Date(now - staleMs).toISOString());
  let sent = 0;
  let failed = 0;
  for (const item of stuck) {
    // pequena folga: a interação pode ter sido gravada um instante antes da linha da fila
    const since = new Date(new Date(item.created_at).getTime() - 5_000).toISOString();
    const match = item.body ? await repo.findSentInteraction(item.contact_id, item.body, since) : null;
    if (match) {
      await repo.finishOutbox(item.id, "enviado", { interaction_id: match.id });
      sent++;
    } else {
      await repo.finishOutbox(item.id, "erro", { error: INTERRUPTED_MESSAGE });
      failed++;
    }
  }
  return { sent, failed };
}
