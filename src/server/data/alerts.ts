import type { TenantContext } from "../context";
import { can } from "../context";
import { fromDbError } from "../errors";
import { listWhatsappNumbers } from "./whatsapp";

export interface AlertsPayload {
  numbers: { id: string; label: string; status: string; desired_state: string; last_error: string | null }[];
  lastInbound: { id: string; at: string; contact_id: string; contact: string; preview: string } | null;
}

/**
 * Avisos do CRM (consultados a cada poucos segundos por todas as telas):
 * situação dos números de WhatsApp e a última mensagem RECEBIDA que o
 * usuário pode ver (o RLS limita ao tenant e aos setores dele).
 */
export async function getAlerts(ctx: TenantContext): Promise<AlertsPayload> {
  if (!can(ctx, "whatsapp.ver")) return { numbers: [], lastInbound: null };
  const [nums, last] = await Promise.all([
    listWhatsappNumbers(ctx),
    ctx.db
      .select("interactions", "id, occurred_at, body, contact_id, contacts(name)")
      .eq("type", "whatsapp")
      .eq("direction", "entrada")
      .order("occurred_at", { ascending: false })
      .limit(1),
  ]);
  if (last.error) throw fromDbError(last.error);
  const row = (last.data as unknown as { id: string; occurred_at: string; body: string; contact_id: string; contacts: { name: string } | null }[] | null)?.[0];
  return {
    numbers: nums.map((n) => ({ id: n.id, label: n.label, status: n.status, desired_state: n.desired_state, last_error: n.last_error })),
    lastInbound: row
      ? { id: row.id, at: row.occurred_at, contact_id: row.contact_id, contact: row.contacts?.name ?? "Contato", preview: (row.body || "Nova mensagem").slice(0, 120) }
      : null,
  };
}
