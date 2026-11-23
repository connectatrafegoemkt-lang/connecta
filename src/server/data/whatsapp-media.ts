import "server-only";
import type { TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";
import { extFromMime, safeName } from "@/shared/media-names";
import { pickSendingNumber } from "./whatsapp";

export type MediaKind = "audio" | "image" | "video" | "document";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
]);

/** Classifica o arquivo enviado; recusa tipos não permitidos. */
export function classifyUpload(mime: string, wantAudio = false): MediaKind {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.startsWith("audio/")) return "audio";
  if (wantAudio) throw badRequest("Áudio inválido");
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(base)) return "image";
  if (["video/mp4", "video/3gpp", "video/quicktime"].includes(base)) return "video";
  if (DOC_MIMES.has(base)) return "document";
  throw badRequest("Tipo de arquivo não permitido");
}

async function ensureContactWithPhone(ctx: TenantContext, contactId: string) {
  const c = await ctx.db.select("contacts", "id, phone").eq("id", contactId).maybeSingle();
  if (c.error) throw fromDbError(c.error);
  if (!c.data) throw notFound("Contato não encontrado");
  if (!(c.data as unknown as { phone: string | null }).phone) throw badRequest("Contato sem telefone");
}

/** Valida o agendamento e escolhe o número que vai enviar. */
async function ensureCanSend(ctx: TenantContext, contactId: string, scheduledAt: string | null, sessionId?: string | null) {
  if (scheduledAt) {
    const when = new Date(scheduledAt).getTime();
    if (!Number.isFinite(when) || when < Date.now() - 60_000) throw badRequest("Data de agendamento no passado");
    if (when > Date.now() + 366 * 86_400_000) throw badRequest("Agendamento muito distante");
  }
  return pickSendingNumber(ctx, contactId, sessionId, !scheduledAt);
}

/** Envia (ou agenda) uma mensagem com arquivo. O arquivo vai para a pasta do tenant da sessão. */
export async function queueMediaMessage(
  ctx: TenantContext,
  input: { contactId: string; file: File; caption: string; scheduledAt: string | null; asVoice: boolean; sessionId?: string | null },
) {
  if (input.file.size === 0) throw badRequest("Arquivo vazio");
  if (input.file.size > MAX_UPLOAD_BYTES) throw badRequest("Arquivo maior que 20 MB");
  if (input.caption.length > 4096) throw badRequest("Legenda muito longa");
  const mime = input.file.type || "application/octet-stream";
  const kind = classifyUpload(mime, input.asVoice);
  await ensureContactWithPhone(ctx, input.contactId);
  const session_id = await ensureCanSend(ctx, input.contactId, input.scheduledAt, input.sessionId);

  const original = input.file.name && input.file.name !== "blob" ? input.file.name : `audio.${extFromMime(mime)}`;
  const path = ctx.db.storagePath("whatsapp", input.contactId, `${Date.now()}-${safeName(original)}`);
  const up = await ctx.db.storage.upload(path, input.file, { contentType: mime.split(";")[0], upsert: false });
  if (up.error) throw badRequest("Falha ao enviar o arquivo");

  const { data, error } = await ctx.db
    .insert("whatsapp_outbox", {
      contact_id: input.contactId,
      body: input.caption,
      media_kind: kind,
      media_path: path,
      media_mime: mime,
      media_filename: kind === "document" ? safeName(original) : null,
      scheduled_at: input.scheduledAt,
      session_id,
    })
    .select("id, status, scheduled_at")
    .single();
  if (error) {
    await ctx.db.storage.remove([path]);
    throw fromDbError(error);
  }
  return data as unknown as { id: string; status: string; scheduled_at: string | null };
}

/** Texto imediato ou agendado. */
export async function queueTextMessage(
  ctx: TenantContext,
  contactId: string,
  body: string,
  scheduledAt: string | null,
  sessionId?: string | null,
) {
  await ensureContactWithPhone(ctx, contactId);
  const session_id = await ensureCanSend(ctx, contactId, scheduledAt, sessionId);
  const { data, error } = await ctx.db
    .insert("whatsapp_outbox", { contact_id: contactId, body, scheduled_at: scheduledAt, session_id })
    .select("id, status, scheduled_at")
    .single();
  if (error) throw fromDbError(error);
  return data as unknown as { id: string; status: string; scheduled_at: string | null };
}

export async function cancelScheduled(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.delete("whatsapp_outbox").eq("id", id).select("id, media_path");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Agendamento não encontrado ou já enviado");
  const path = (data[0] as unknown as { media_path: string | null }).media_path;
  if (path) await ctx.db.storage.remove([path]);
}

/** Links temporários (1h) para exibir mídias; o RLS do storage só libera a pasta do tenant. */
export async function signedUrlsFor(ctx: TenantContext, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p) => p.startsWith(`${ctx.tenantId}/`)))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await ctx.db.storage.createSignedUrls(unique, 3600);
  for (const r of data ?? []) if (r.signedUrl && r.path) out.set(r.path, r.signedUrl);
  return out;
}

// ------------------------------------------------------- mensagens rápidas
export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

export async function listQuickReplies(ctx: TenantContext): Promise<QuickReply[]> {
  const { data, error } = await ctx.db.select("quick_replies", "id, shortcut, title, body").order("shortcut");
  if (error) throw fromDbError(error);
  return data as unknown as QuickReply[];
}

export async function createQuickReply(ctx: TenantContext, input: { shortcut: string; title: string; body: string }) {
  const { error } = await ctx.db.insert("quick_replies", input);
  if (error) throw fromDbError(error);
}

export async function deleteQuickReply(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.delete("quick_replies").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Mensagem rápida não encontrada");
}

// ------------------------------------------------------- mensagens agendadas
export interface ScheduledMessage {
  id: string;
  body: string;
  scheduled_at: string;
  media_kind: string | null;
  media_filename: string | null;
  session_id: string | null;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
}

/** Mensagens agendadas (ainda não enviadas) do tenant da sessão, da mais próxima à mais distante. */
export async function listScheduledMessages(ctx: TenantContext, limit = 200): Promise<ScheduledMessage[]> {
  const { data, error } = await ctx.db
    .select("whatsapp_outbox", "id, body, scheduled_at, media_kind, media_filename, session_id, contact_id, contacts(name, phone)")
    .eq("status", "pendente")
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw fromDbError(error);
  return (data as unknown as (Omit<ScheduledMessage, "contact_name" | "contact_phone"> & { contacts: { name: string; phone: string | null } | null })[]).map(
    ({ contacts, ...r }) => ({ ...r, contact_name: contacts?.name ?? "Contato", contact_phone: contacts?.phone ?? null }),
  );
}

export async function countScheduledMessages(ctx: TenantContext): Promise<number> {
  const { count, error } = await ctx.db
    .select("whatsapp_outbox", "id", { count: "exact", head: true })
    .eq("status", "pendente")
    .not("scheduled_at", "is", null);
  if (error) return 0;
  return count ?? 0;
}
