import "server-only";
import { requireAdmin, type TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";
import { signedUrlsFor } from "./whatsapp-media";

export interface WhatsappSession {
  status: "desconectado" | "aguardando_qr" | "conectando" | "conectado" | "erro";
  desired_state: "conectado" | "desconectado";
  phone: string | null;
  last_error: string | null;
  connected_at: string | null;
  updated_at: string | null;
}

const EMPTY: WhatsappSession = {
  status: "desconectado",
  desired_state: "desconectado",
  phone: null,
  last_error: null,
  connected_at: null,
  updated_at: null,
};

export async function getWhatsappSession(ctx: TenantContext): Promise<WhatsappSession> {
  const { data, error } = await ctx.db
    .select("whatsapp_sessions", "status, desired_state, phone, last_error, connected_at, updated_at")
    .maybeSingle();
  if (error) throw fromDbError(error);
  return (data as unknown as WhatsappSession) ?? EMPTY;
}

/** QR atual — somente admin (o RLS também garante isso). */
export async function getWhatsappQr(ctx: TenantContext): Promise<string | null> {
  if (ctx.role !== "admin") return null;
  const { data, error } = await ctx.db.select("whatsapp_qr", "qr").maybeSingle();
  if (error) throw fromDbError(error);
  return (data as { qr: string | null } | null)?.qr ?? null;
}

export async function requestWhatsapp(ctx: TenantContext, action: "conectar" | "desconectar") {
  requireAdmin(ctx);
  const { error } = await ctx.db.rpc("whatsapp_request", { p_action: action });
  if (error) throw fromDbError(error);
}

/** Coloca a mensagem na fila do tenant; o worker do tenant envia. */
export async function queueWhatsappMessage(ctx: TenantContext, contactId: string, body: string) {
  const contact = await ctx.db.select("contacts", "id, phone").eq("id", contactId).maybeSingle();
  if (contact.error) throw fromDbError(contact.error);
  if (!contact.data) throw notFound("Contato não encontrado");
  if (!(contact.data as unknown as { phone: string | null }).phone) throw badRequest("Contato sem telefone");
  const session = await getWhatsappSession(ctx);
  if (session.status !== "conectado") throw badRequest("WhatsApp não está conectado");
  const { data, error } = await ctx.db
    .insert("whatsapp_outbox", { contact_id: contactId, body })
    .select("id, status, created_at")
    .single();
  if (error) throw fromDbError(error);
  return data as unknown as { id: string; status: string; created_at: string };
}

export interface Conversation {
  contact_id: string;
  name: string;
  phone: string | null;
  tags: { id: string; name: string; color: string }[];
  last_at: string;
  last_body: string;
  last_direction: string;
}

/** Contatos com mensagens de WhatsApp, mais recentes primeiro. */
export async function listConversations(ctx: TenantContext, opts: { limit?: number; tagId?: string } = {}): Promise<Conversation[]> {
  const limit = opts.limit ?? 50;
  const { data, error } = await ctx.db
    .select("interactions", "contact_id, body, direction, occurred_at, contacts(name, phone, contact_tags(tags(id, name, color)))")
    .eq("type", "whatsapp")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw fromDbError(error);
  const seen = new Map<string, Conversation>();
  for (const r of data as unknown as {
    contact_id: string;
    body: string;
    direction: string;
    occurred_at: string;
    contacts: { name: string; phone: string | null; contact_tags?: { tags: { id: string; name: string; color: string } | null }[] } | null;
  }[]) {
    if (seen.has(r.contact_id)) continue;
    const tags = (r.contacts?.contact_tags ?? []).flatMap((ct) => (ct.tags ? [ct.tags] : []));
    if (opts.tagId && !tags.some((t) => t.id === opts.tagId)) continue;
    seen.set(r.contact_id, {
      contact_id: r.contact_id,
      name: r.contacts?.name ?? "Contato",
      phone: r.contacts?.phone ?? null,
      tags,
      last_at: r.occurred_at,
      last_body: r.body,
      last_direction: r.direction,
    });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

export interface ThreadMessage {
  id: string;
  direction: "entrada" | "saida";
  body: string;
  status: string | null;
  occurred_at: string;
  metadata?: { ai?: boolean; media?: { kind: string; path: string; mime: string | null; filename: string | null } } | null;
  media_url?: string | null;
}

export async function listThread(ctx: TenantContext, contactId: string): Promise<ThreadMessage[]> {
  const { data, error } = await ctx.db
    .select("interactions", "id, direction, body, status, occurred_at, metadata")
    .eq("contact_id", contactId)
    .eq("type", "whatsapp")
    .order("occurred_at", { ascending: true })
    .limit(500);
  if (error) throw fromDbError(error);
  const rows = data as unknown as ThreadMessage[];
  const urls = await signedUrlsFor(ctx, rows.flatMap((r) => (r.metadata?.media?.path ? [r.metadata.media.path] : [])));
  return rows.map((r) => ({ ...r, media_url: r.metadata?.media?.path ? urls.get(r.metadata.media.path) ?? null : null }));
}

export async function listPendingOutbox(ctx: TenantContext, contactId: string) {
  const { data, error } = await ctx.db
    .select("whatsapp_outbox", "id, body, status, error, created_at, scheduled_at, media_kind, media_filename")
    .eq("contact_id", contactId)
    .in("status", ["pendente", "enviando", "erro"])
    .order("scheduled_at", { ascending: true, nullsFirst: true })
    .order("created_at");
  if (error) throw fromDbError(error);
  return data as unknown as {
    id: string;
    body: string;
    status: string;
    error: string | null;
    created_at: string;
    scheduled_at: string | null;
    media_kind: string | null;
    media_filename: string | null;
  }[];
}
