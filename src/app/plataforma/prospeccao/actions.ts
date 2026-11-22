"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPlatformContext } from "@/server/platform";
import {
  addSheetSource,
  deleteProspect,
  deleteSheetSource,
  importProspects,
  listSheetSources,
  logProspectContact,
  saveProspect,
  syncSheetSource,
} from "@/server/prospects";
import { localToIso, parseOrThrow, pick, reaisToCents, toActionError, type ActionState } from "@/server/forms";
import { idSchema, prospectLogSchema, prospectSchema } from "@/server/validation";
import { parseProspectList } from "@/shared/prospects";

const FIELDS = ["name", "company", "phone", "email", "city", "niche", "source", "status", "notes"];

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
