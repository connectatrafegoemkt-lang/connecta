"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPlatformContext } from "@/server/platform";
import { getTenantContext } from "@/server/context";
import { HttpError } from "@/server/errors";
import { findOrCreateContactByPhone } from "@/server/data/contacts";
import { queueWhatsappMessage } from "@/server/data/whatsapp";
import { queueMediaMessage, queueTextMessage, resolveSchedule } from "@/server/data/whatsapp-media";
import {
  addSheetSource,
  deleteProspect,
  deleteSheetSource,
  importProspects,
  listSheetSources,
  getProspect,
  logProspectContact,
  saveProspect,
  syncSheetSource,
} from "@/server/prospects";
import { localToIso, parseOrThrow, pick, reaisToCents, toActionError, type ActionState } from "@/server/forms";
import { idSchema, prospectLogSchema, prospectSchema } from "@/server/validation";
import { parseProspectList } from "@/shared/prospects";

const FIELDS = ["name", "company", "phone", "email", "city", "niche", "area", "instagram", "source", "status", "notes"];

/** Próximo follow-up: atalhos (amanhã, 3 dias...) às 9h de Brasília, ou data escolhida. */
function followup(fd: FormData): string | null {
  const preset = String(fd.get("quando") ?? "");
  const days = { amanha: 1, "3dias": 3, semana: 7, "2semanas": 14, mes: 30 }[preset];
  if (days) {
    const d = new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return new Date(`${d}T09:00:00-03:00`).toISOString();
  }
  if (preset === "data") return localToIso(fd.get("followup_at"));
  return null; // "sem" = sem próximo follow-up
}

function prospectInput(fd: FormData) {
  const raw: Record<string, unknown> = pick(fd, FIELDS);
  const cents = reaisToCents(fd.get("value"));
  if (cents !== undefined) raw.value_cents = cents;
  if (fd.has("quando")) raw.next_followup_at = followup(fd);
  if (raw.status === "") delete raw.status;
  return parseOrThrow(prospectSchema, raw);
}

export async function createProspectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    await saveProspect(p, null, prospectInput(fd));
    revalidatePath("/plataforma/prospeccao");
    return { ok: true, message: "Lead cadastrada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProspectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const input = prospectInput(fd);
    if (!fd.has("quando")) input.next_followup_at = localToIso(fd.get("followup_at"));
    await saveProspect(p, id, input);
    revalidatePath("/plataforma/prospeccao");
    revalidatePath(`/plataforma/prospeccao/${id}`);
    return { ok: true, message: "Dados salvos." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function logContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const input = parseOrThrow(prospectLogSchema, { ...pick(fd, ["type", "body", "status"]), next_followup_at: followup(fd) });
    await logProspectContact(p, id, input);
    revalidatePath("/plataforma/prospeccao");
    revalidatePath(`/plataforma/prospeccao/${id}`);
    return { ok: true, message: "Contato registrado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteProspectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    await deleteProspect(p, parseOrThrow(idSchema, fd.get("id")));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/plataforma/prospeccao");
  redirect("/plataforma/prospeccao");
}

export async function importProspectsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const text = String(fd.get("lista") ?? "").slice(0, 200_000);
    const source = String(fd.get("source") ?? "").trim().slice(0, 120) || "Lista importada";
    const { rows, errors } = parseProspectList(text, source);
    const n = await importProspects(p, rows);
    revalidatePath("/plataforma/prospeccao");
    return {
      ok: true,
      message: `${n} lead(s) importada(s).` + (errors.length ? ` Atenção: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}` : ""),
    };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- Google Sheets

export async function addSheetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const url = String(fd.get("url") ?? "").trim().slice(0, 1000);
    const name = String(fd.get("name") ?? "").trim().slice(0, 120) || "Planilha de leads";
    const source = String(fd.get("source") ?? "").trim().slice(0, 120) || null;
    const id = await addSheetSource(p, { name, url, source });
    const src = (await listSheetSources(p)).find((s) => s.id === id);
    if (!src) return { ok: false, error: "Planilha não encontrada" };
    const r = await syncSheetSource(p, src);
    revalidatePath("/plataforma/prospeccao");
    if (r.error) return { ok: false, error: `Planilha conectada, mas: ${r.error}` };
    return { ok: true, message: `Planilha conectada. ${r.added} lead(s) importada(s).` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function syncSheetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const src = (await listSheetSources(p)).find((s) => s.id === id);
    if (!src) return { ok: false, error: "Planilha não encontrada" };
    const r = await syncSheetSource(p, src);
    revalidatePath("/plataforma/prospeccao");
    return r.error ? { ok: false, error: r.error } : { ok: true, message: r.added ? `${r.added} lead(s) nova(s).` : "Nenhuma lead nova." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteSheetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    await deleteSheetSource(p, parseOrThrow(idSchema, fd.get("id")));
    revalidatePath("/plataforma/prospeccao");
    return { ok: true, message: "Planilha desconectada (as leads já importadas continuam)." };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- WhatsApp

/**
 * A conversa com a lead acontece pelo WhatsApp da PRÓPRIA empresa de quem
 * está logado (a CONNECTA no CRM): o contato é criado/achado nesse tenant,
 * com RLS e a permissão whatsapp.enviar de sempre.
 */
async function ownContactFor(prospectId: string) {
  const p = await getPlatformContext();
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    throw new HttpError(400, "Seu usuário precisa estar ligado à empresa CONNECTA no CRM para usar o WhatsApp.");
  }
  const x = await getProspect(p, prospectId);
  if (!x.phone) throw new HttpError(400, "Essa lead não tem WhatsApp cadastrado.");
  const contactId = await findOrCreateContactByPhone(ctx, {
    name: x.company && !x.name.includes(x.company) ? `${x.name} (${x.company})` : x.name,
    phone: x.phone,
    company: x.company,
    source: "Prospecção CONNECTA",
  });
  return { p, ctx, x, contactId };
}

const brTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function sendProspectWhatsappAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = parseOrThrow(idSchema, fd.get("id"));
    const body = String(fd.get("body") ?? "").trim();
    if (!body) return { ok: false, error: "Escreva a mensagem." };
    if (body.length > 4096) return { ok: false, error: "Mensagem longa demais (máximo 4096 caracteres)." };
    const modo = fd.get("modo");
    const picked = modo === "agendar" ? localToIso(fd.get("scheduled_at")) : null;
    if (modo === "agendar" && !picked) return { ok: false, error: "Escolha a data e a hora do agendamento." };
    const { p, ctx, x, contactId } = await ownContactFor(id);
    const scheduled = await resolveSchedule(ctx, { scheduledAt: picked, interval: modo === "sequencia" ? fd.get("intervalo") : null });
    if (scheduled) await queueTextMessage(ctx, contactId, body, scheduled);
    else await queueWhatsappMessage(ctx, contactId, body);
    await logProspectContact(p, id, {
      type: scheduled ? "nota" : "whatsapp",
      body: scheduled ? `Mensagem de WhatsApp agendada para ${brTime(scheduled)}:\n${body}` : body,
      next_followup_at: x.next_followup_at,
    });
    revalidatePath("/plataforma/prospeccao");
    revalidatePath(`/plataforma/prospeccao/${id}`);
    revalidatePath("/whatsapp");
    return { ok: true, message: scheduled ? `Mensagem agendada para ${brTime(scheduled)}.` : "Mensagem enviada para a fila do WhatsApp." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Áudio gravado na janela de WhatsApp da Prospecção: envia agora ou agenda. */
export async function sendProspectAudioAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = parseOrThrow(idSchema, fd.get("id"));
    const file = fd.get("audio");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Grave o áudio antes de enviar." };
    if (!file.type.startsWith("audio/")) return { ok: false, error: "Arquivo de áudio inválido." };
    const modo = fd.get("modo");
    const picked = modo === "agendar" ? localToIso(fd.get("scheduled_at")) : null;
    if (modo === "agendar" && !picked) return { ok: false, error: "Escolha a data e a hora do agendamento." };
    const { p, ctx, x, contactId } = await ownContactFor(id);
    const scheduled = await resolveSchedule(ctx, { scheduledAt: picked, interval: modo === "sequencia" ? fd.get("intervalo") : null });
    await queueMediaMessage(ctx, { contactId, file, caption: "", scheduledAt: scheduled, asVoice: true });
    await logProspectContact(p, id, {
      type: scheduled ? "nota" : "whatsapp",
      body: scheduled ? `Áudio de WhatsApp agendado para ${brTime(scheduled)}.` : "[áudio enviado pelo WhatsApp]",
      next_followup_at: x.next_followup_at,
    });
    revalidatePath("/plataforma/prospeccao");
    revalidatePath(`/plataforma/prospeccao/${id}`);
    revalidatePath("/whatsapp");
    return { ok: true, message: scheduled ? `Áudio agendado para ${brTime(scheduled)}.` : "Áudio enviado para a fila do WhatsApp." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Abre a conversa completa (áudio, arquivos, histórico) na tela de WhatsApp do CRM. */
export async function openProspectChatAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let contactId: string;
  try {
    contactId = (await ownContactFor(parseOrThrow(idSchema, fd.get("id")))).contactId;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/whatsapp?contato=${contactId}`);
}
