/**
 * Etiquetas do WhatsApp Business ↔ etiquetas (tags) do CRM.
 *
 *  WhatsApp → CRM: eventos `labels.edit` (criar/renomear/excluir etiqueta)
 *  e `labels.association` (etiqueta aplicada/removida de uma conversa).
 *  CRM → WhatsApp: fila `whatsapp_label_queue`, preenchida por triggers
 *  quando uma PESSOA muda etiquetas no CRM (mudanças feitas pelo worker não
 *  entram na fila, então não há eco/loop).
 *
 * Etiquetas só existem em contas do WhatsApp Business.
 */

/** As 20 cores de etiqueta do WhatsApp Business (índice 0–19), aproximadas. */
export const WA_LABEL_COLORS = [
  "#ff9485", "#64c4ff", "#ffd429", "#dfaef0", "#99b6c1", "#55ccb3", "#ff9dff", "#d3a91d", "#6d7cce", "#d7e752",
  "#00d0e2", "#ffc5c7", "#93ceac", "#f74848", "#00a0f2", "#83e422", "#ffaf04", "#b5ebff", "#9ba6ff", "#9368cf",
] as const;

function rgb(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "64748b";
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function waColorToHex(index: number | null | undefined): string {
  const i = typeof index === "number" && index >= 0 ? index % WA_LABEL_COLORS.length : 0;
  return WA_LABEL_COLORS[i]!;
}

/** Cor do CRM → cor mais próxima entre as 20 do WhatsApp. */
export function hexToWaColor(hex: string): number {
  const [r, g, b] = rgb(hex);
  let best = 0;
  let bestD = Infinity;
  WA_LABEL_COLORS.forEach((c, i) => {
    const [r2, g2, b2] = rgb(c);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Próximo id livre para uma etiqueta criada pelo CRM no WhatsApp. */
export function nextLabelId(existing: (string | null | undefined)[]): string {
  const nums = existing.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  return String(Math.max(100, ...nums) + 1);
}

export interface LabelQueueItem {
  id: string;
  kind: "chat_add" | "chat_remove" | "label_upsert" | "label_delete";
  contact_id: string | null;
  tag_id: string | null;
  wa_label_id: string | null;
  attempts: number;
}

export interface LabelRepo {
  upsertTagFromWhatsapp(label: { id: string; name: string; color: string }): Promise<void>;
  deleteTagByWaLabel(waLabelId: string): Promise<void>;
  setContactLabel(phone: string, waLabelId: string, on: boolean): Promise<void>;
  claimLabelQueue(limit?: number): Promise<LabelQueueItem[]>;
  finishLabelQueue(id: string, ok: boolean, error?: string): Promise<void>;
  getTag(tagId: string): Promise<{ id: string; name: string; color: string; wa_label_id: string | null } | null>;
  listWaLabelIds(): Promise<string[]>;
  setTagWaLabel(tagId: string, waLabelId: string): Promise<void>;
  getContactPhone(contactId: string): Promise<string | null>;
}

export interface LabelSocket {
  addLabel(jid: string, label: { id: string; name?: string; color?: number; deleted?: boolean }): Promise<void>;
  addChatLabel(jid: string, labelId: string): Promise<void>;
  removeChatLabel(jid: string, labelId: string): Promise<void>;
}

/** WhatsApp → CRM: etiqueta criada/editada/excluída no celular. */
export async function onLabelEdit(repo: LabelRepo, label: { id: string; name: string; color: number; deleted: boolean }) {
  if (!label?.id) return;
  if (label.deleted) return repo.deleteTagByWaLabel(String(label.id));
  const name = (label.name ?? "").trim().slice(0, 50);
  if (!name) return;
  await repo.upsertTagFromWhatsapp({ id: String(label.id), name, color: waColorToHex(label.color) });
}

/** CRM → WhatsApp: processa a fila de mudanças feitas por pessoas no CRM. */
export async function processLabelQueue(repo: LabelRepo, sock: LabelSocket, ownJid: string, limit = 20): Promise<number> {
  const items = await repo.claimLabelQueue(limit);
  for (const it of items) {
    try {
      await applyQueueItem(repo, sock, ownJid, it);
      await repo.finishLabelQueue(it.id, true);
    } catch (e) {
      await repo.finishLabelQueue(it.id, false, e instanceof Error ? e.message.slice(0, 300) : "erro");
    }
  }
  return items.length;
}

async function ensureWaLabel(repo: LabelRepo, sock: LabelSocket, ownJid: string, tagId: string): Promise<string | null> {
  const tag = await repo.getTag(tagId);
  if (!tag) return null;
  if (tag.wa_label_id) return tag.wa_label_id;
  const id = nextLabelId(await repo.listWaLabelIds());
  await sock.addLabel(ownJid, { id, name: tag.name, color: hexToWaColor(tag.color), deleted: false });
  await repo.setTagWaLabel(tag.id, id);
  return id;
}

async function applyQueueItem(repo: LabelRepo, sock: LabelSocket, ownJid: string, it: LabelQueueItem) {
  switch (it.kind) {
    case "label_upsert": {
      if (!it.tag_id) return;
      const tag = await repo.getTag(it.tag_id);
      if (!tag) return;
      if (!tag.wa_label_id) {
        await ensureWaLabel(repo, sock, ownJid, tag.id);
        return;
      }
      await sock.addLabel(ownJid, { id: tag.wa_label_id, name: tag.name, color: hexToWaColor(tag.color), deleted: false });
      return;
    }
    case "label_delete":
      if (it.wa_label_id) await sock.addLabel(ownJid, { id: it.wa_label_id, deleted: true });
      return;
    case "chat_add": {
      if (!it.tag_id || !it.contact_id) return;
      const phone = await repo.getContactPhone(it.contact_id);
      if (!phone) return;
      const labelId = await ensureWaLabel(repo, sock, ownJid, it.tag_id);
      if (labelId) await sock.addChatLabel(`${phone}@s.whatsapp.net`, labelId);
      return;
    }
    case "chat_remove": {
      if (!it.contact_id || !it.wa_label_id) return;
      const phone = await repo.getContactPhone(it.contact_id);
      if (phone) await sock.removeChatLabel(`${phone}@s.whatsapp.net`, it.wa_label_id);
      return;
    }
  }
}
