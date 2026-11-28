import "server-only";
import { can, requirePerm, type TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";
import { signedUrlsFor } from "./whatsapp-media";
import { displayName } from "@/shared/contact-name";

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

export interface WhatsappNumber extends WhatsappSession {
  id: string;
  label: string;
  is_primary: boolean;
}

const NUMBER_COLS = "id, label, is_primary, status, desired_state, phone, last_error, connected_at, updated_at";

/** Números de WhatsApp do tenant da sessão (principal primeiro). */
export async function listWhatsappNumbers(ctx: TenantContext): Promise<WhatsappNumber[]> {
  const { data, error } = await ctx.db
    .select("whatsapp_sessions", NUMBER_COLS)
    .order("is_primary", { ascending: false })
    .order("created_at");
  if (error) throw fromDbError(error);
  return (data as unknown as WhatsappNumber[]) ?? [];
}

/** Situação "geral": um número conectado (o principal, se estiver) ou o principal. */
export async function getWhatsappSession(ctx: TenantContext): Promise<WhatsappSession> {
  const nums = await listWhatsappNumbers(ctx);
  return nums.find((n) => n.status === "conectado") ?? nums[0] ?? EMPTY;
}

/** QR atual de cada número — somente quem conecta (o RLS também garante isso). */
export async function getWhatsappQrs(ctx: TenantContext): Promise<Record<string, string | null>> {
  if (!can(ctx, "whatsapp.conectar")) return {};
  const { data, error } = await ctx.db.select("whatsapp_qr", "session_id, qr");
  if (error) throw fromDbError(error);
  return Object.fromEntries(((data ?? []) as unknown as { session_id: string; qr: string | null }[]).map((r) => [r.session_id, r.qr]));
}

/** QR do número principal (compatibilidade com a API antiga). */
export async function getWhatsappQr(ctx: TenantContext): Promise<string | null> {
  const nums = await listWhatsappNumbers(ctx);
  const primary = nums.find((n) => n.is_primary);
  if (!primary) return null;
  return (await getWhatsappQrs(ctx))[primary.id] ?? null;
}

/** Limite de números do cliente (definido pela CONNECTA). */
export async function getWhatsappLimit(ctx: TenantContext): Promise<number> {
  const { data } = await ctx.supabase.from("tenants").select("whatsapp_limit").eq("id", ctx.tenantId).maybeSingle();
  return (data as { whatsapp_limit?: number } | null)?.whatsapp_limit ?? 1;
}

export async function requestWhatsapp(ctx: TenantContext, action: "conectar" | "desconectar" | "reiniciar", sessionId?: string | null) {
  requirePerm(ctx, "whatsapp.conectar");
  const { error } = await ctx.db.rpc("whatsapp_request", { p_action: action, p_session: sessionId ?? null });
  if (error) {
    if (error.code === "P0002") throw notFound("Número não encontrado");
    throw fromDbError(error);
  }
}

export async function addWhatsappNumber(ctx: TenantContext, label: string) {
  requirePerm(ctx, "whatsapp.conectar");
  const { data, error } = await ctx.db.rpc("whatsapp_add_number", { p_label: label });
  if (error) {
    if (error.code === "23514") throw badRequest("Limite de números de WhatsApp atingido. Fale com a CONNECTA para aumentar.");
    throw fromDbError(error);
  }
  return data as string;
}

export async function renameWhatsappNumber(ctx: TenantContext, sessionId: string, label: string) {
  requirePerm(ctx, "whatsapp.conectar");
  const { error } = await ctx.db.rpc("whatsapp_rename_number", { p_session: sessionId, p_label: label });
  if (error) {
    if (error.code === "P0002") throw notFound("Número não encontrado");
    throw fromDbError(error);
  }
}

export async function removeWhatsappNumber(ctx: TenantContext, sessionId: string) {
  requirePerm(ctx, "whatsapp.conectar");
  const { error } = await ctx.db.rpc("whatsapp_remove_number", { p_session: sessionId });
  if (error) {
    if (error.code === "P0002") throw notFound("Número não encontrado");
    if (error.code === "23514") throw badRequest("O número principal não pode ser removido, só desconectado.");
    throw fromDbError(error);
  }
}

/**
 * Escolhe por qual número enviar: o informado (precisa ser do tenant), senão
 * o último número que conversou com o contato, senão o principal / qualquer
 * um conectado. Para envio imediato o número precisa estar conectado.
 */
export async function pickSendingNumber(
  ctx: TenantContext,
  contactId: string,
  sessionId: string | null | undefined,
  immediate: boolean,
): Promise<string | null> {
  const nums = await listWhatsappNumbers(ctx);
  if (sessionId) {
    const n = nums.find((x) => x.id === sessionId);
    if (!n) throw badRequest("Número de WhatsApp inválido");
    if (immediate && n.status !== "conectado") throw badRequest(`O número "${n.label}" não está conectado`);
    return n.id;
  }
  const { data } = await ctx.db
    .select("interactions", "session_id")
    .eq("contact_id", contactId)
    .eq("type", "whatsapp")
    .not("session_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1);
  const last = (data as unknown as { session_id: string }[] | null)?.[0]?.session_id;
  const connected = nums.filter((n) => n.status === "conectado");
  const pick =
    connected.find((n) => n.id === last) ??
    connected.find((n) => n.is_primary) ??
    connected[0] ??
    (immediate ? undefined : (nums.find((n) => n.id === last) ?? nums[0]));
  if (!pick) {
    if (immediate) throw badRequest("WhatsApp não está conectado");
    return null;
  }
  return pick.id;
}

/** Coloca a mensagem na fila do tenant; o worker do tenant envia. */
export async function queueWhatsappMessage(ctx: TenantContext, contactId: string, body: string, sessionId?: string | null) {
  const contact = await ctx.db.select("contacts", "id, phone").eq("id", contactId).maybeSingle();
  if (contact.error) throw fromDbError(contact.error);
  if (!contact.data) throw notFound("Contato não encontrado");
  if (!(contact.data as unknown as { phone: string | null }).phone) throw badRequest("Contato sem telefone");
  const session_id = await pickSendingNumber(ctx, contactId, sessionId, true);
  const { data, error } = await ctx.db
    .insert("whatsapp_outbox", { contact_id: contactId, body, session_id })
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
  last_status: string | null;
  avatar_url: string | null;
  about: string | null;
  session_id: string | null;
}

/** Contatos com mensagens de WhatsApp, mais recentes primeiro. */
export async function listConversations(
  ctx: TenantContext,
  opts: { limit?: number; tagId?: string; sessionId?: string } = {},
): Promise<Conversation[]> {
  const limit = opts.limit ?? 50;
  let q = ctx.db
    .select(
      "interactions",
      "contact_id, body, direction, status, occurred_at, session_id, contacts(name, phone, whatsapp_name, avatar_path, whatsapp_about, contact_tags(tags(id, name, color)))",
    )
    .eq("type", "whatsapp");
  if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(500);
  if (error) throw fromDbError(error);
  const seen = new Map<string, Conversation>();
  for (const r of data as unknown as {
    contact_id: string;
    body: string;
    direction: string;
    status: string | null;
    occurred_at: string;
    session_id: string | null;
    contacts: {
      name: string;
      phone: string | null;
      whatsapp_name: string | null;
      avatar_path: string | null;
      whatsapp_about: string | null;
      contact_tags?: { tags: { id: string; name: string; color: string } | null }[];
    } | null;
  }[]) {
    if (seen.has(r.contact_id)) continue;
    const tags = (r.contacts?.contact_tags ?? []).flatMap((ct) => (ct.tags ? [ct.tags] : []));
    if (opts.tagId && !tags.some((t) => t.id === opts.tagId)) continue;
    seen.set(r.contact_id, {
      contact_id: r.contact_id,
      name: r.contacts ? displayName(r.contacts) : "Contato",
      phone: r.contacts?.phone ?? null,
      tags,
      last_at: r.occurred_at,
      last_body: r.body,
      last_direction: r.direction,
      last_status: r.status,
      avatar_url: r.contacts?.avatar_path ?? null, // trocado pelo link assinado abaixo
      about: r.contacts?.whatsapp_about ?? null,
      session_id: r.session_id,
    });
    if (seen.size >= limit) break;
  }
  const list = [...seen.values()];
  const urls = await signedUrlsFor(ctx, list.flatMap((c) => (c.avatar_url ? [c.avatar_url] : [])));
  return list.map((c) => ({ ...c, avatar_url: c.avatar_url ? urls.get(c.avatar_url) ?? null : null }));
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
