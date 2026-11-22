import "server-only";
import type { PlatformContext } from "./platform";
import { badRequest, fromDbError, notFound } from "./errors";
import type { ImportRow } from "@/shared/prospects";
import { parseSheetUrl, sheetCsvUrl, sheetToLeads, type SheetLead } from "@/shared/sheets";
import type { ProspectInput, ProspectLogInput } from "./validation";

/**
 * Prospecção da CONNECTA. Tudo passa por funções do banco que exigem
 * administrador da plataforma (o cliente do usuário é usado, sem
 * service_role). Os dados não pertencem a nenhum cliente do CRM.
 */
export interface Prospect {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  niche: string | null;
  source: string | null;
  status: string;
  value_cents: number;
  notes: string | null;
  next_followup_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
  activities?: number;
}
export interface ProspectActivity {
  id: string;
  type: string;
  body: string;
  created_at: string;
}

function dbError(error: { code?: string; message?: string }) {
  if (error.code === "P0002") return notFound("Lead não encontrada");
  if (error.code === "23514" || error.code === "22023") return badRequest("Dados inválidos (confira telefone e campos)");
  return fromDbError(error);
}

export async function listProspects(p: PlatformContext): Promise<Prospect[]> {
  const { data, error } = await p.supabase.rpc("platform_prospects_list");
  if (error) throw dbError(error);
  return (data ?? []) as Prospect[];
}

export async function getProspect(p: PlatformContext, id: string): Promise<Prospect & { activities: ProspectActivity[] }> {
  const { data, error } = await p.supabase.rpc("platform_prospect_get", { p_id: id });
  if (error) throw dbError(error);
  return data as Prospect & { activities: ProspectActivity[] };
}

export async function saveProspect(p: PlatformContext, id: string | null, input: ProspectInput): Promise<string> {
  const { data, error } = await p.supabase.rpc("platform_prospect_save", { p_id: id, p_data: input });
  if (error) throw dbError(error);
  return data as string;
}

export async function logProspectContact(p: PlatformContext, id: string, input: ProspectLogInput) {
  const { error } = await p.supabase.rpc("platform_prospect_log", {
    p_id: id,
    p_type: input.type,
    p_body: input.body ?? "",
    p_next_followup: input.next_followup_at ?? null,
    p_status: input.status ?? null,
  });
  if (error) throw dbError(error);
}

export async function deleteProspect(p: PlatformContext, id: string) {
  const { error } = await p.supabase.rpc("platform_prospect_delete", { p_id: id });
  if (error) throw dbError(error);
}

export async function importProspects(p: PlatformContext, rows: ImportRow[]): Promise<number> {
  if (rows.length === 0) throw badRequest("Nenhuma linha válida para importar");
  if (rows.length > 500) throw badRequest("Importe no máximo 500 linhas por vez");
  const { data, error } = await p.supabase.rpc("platform_prospects_import", { p_rows: rows });
  if (error) throw dbError(error);
  return data as number;
}

// ---------------------------------------------------------------------------
// Google Sheets → Prospecção
// ---------------------------------------------------------------------------

export interface SheetSource {
  id: string;
  name: string;
  sheet_id: string;
  gid: string;
  source_label: string | null;
  last_sync_at: string | null;
  last_result: string | null;
  last_ok: boolean | null;
  imported: number;
}

export async function listSheetSources(p: PlatformContext): Promise<SheetSource[]> {
  const { data, error } = await p.supabase.rpc("platform_sheet_sources_list");
  if (error) throw dbError(error);
  return (data ?? []) as SheetSource[];
}

export async function addSheetSource(p: PlatformContext, input: { name: string; url: string; source?: string | null }) {
  const parsed = parseSheetUrl(input.url);
  if (!parsed) throw badRequest("Link inválido. Copie o link da planilha do Google Sheets (docs.google.com/spreadsheets/...).");
  const { data, error } = await p.supabase.rpc("platform_sheet_source_add", {
    p_name: input.name,
    p_sheet_id: parsed.sheetId,
    p_gid: parsed.gid,
    p_source_label: input.source ?? null,
  });
  if (error) {
    if (error.code === "23505") throw badRequest("Essa planilha (aba) já está conectada.");
    throw dbError(error);
  }
  return data as string;
}

export async function deleteSheetSource(p: PlatformContext, id: string) {
  const { error } = await p.supabase.rpc("platform_sheet_source_delete", { p_id: id });
  if (error) throw dbError(error);
}

const MAX_CSV_BYTES = 3 * 1024 * 1024;

/** Baixa a planilha como CSV (só docs.google.com, com tempo e tamanho limitados). */
async function fetchSheetCsv(sheetId: string, gid: string): Promise<string> {
  const res = await fetch(sheetCsvUrl(sheetId, gid), { redirect: "follow", signal: AbortSignal.timeout(12_000), cache: "no-store" });
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403 || res.status === 404 || type.includes("text/html")) {
    throw new Error('Não consegui abrir a planilha. No Google Sheets, clique em Compartilhar → "Qualquer pessoa com o link" → Leitor.');
  }
  if (!res.ok) throw new Error(`O Google respondeu com erro ${res.status}. Tente de novo em alguns minutos.`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_CSV_BYTES) throw new Error("Planilha grande demais (máximo 3 MB).");
  const text = await res.text();
  if (text.length > MAX_CSV_BYTES) throw new Error("Planilha grande demais (máximo 3 MB).");
  return text;
}

/** Lê a planilha e importa as linhas novas. Devolve quantas leads entraram. */
export async function syncSheetSource(p: PlatformContext, src: Pick<SheetSource, "id" | "sheet_id" | "gid">): Promise<{ added: number; error?: string }> {
  let error: string | undefined;
  let rows: SheetLead[] = [];
  try {
    const out = sheetToLeads(await fetchSheetCsv(src.sheet_id, src.gid));
    if (out.error) error = out.error;
    rows = out.leads.slice(0, 5000);
  } catch (e) {
    error = e instanceof Error && e.name !== "TimeoutError" ? e.message : "A planilha demorou demais para responder.";
  }
  const { data, error: dbErr } = await p.supabase.rpc("platform_sheet_sync", {
    p_id: src.id,
    p_rows: error ? [] : rows,
    p_error: error ?? null,
  });
  if (dbErr) throw dbError(dbErr);
  return { added: (data as number) ?? 0, error };
}

/** Sincroniza as planilhas que não foram lidas nos últimos `minutes` minutos. */
export async function syncDueSheets(p: PlatformContext, minutes = 5): Promise<number> {
  const sources = await listSheetSources(p);
  const limit = Date.now() - minutes * 60_000;
  const due = sources.filter((s) => !s.last_sync_at || new Date(s.last_sync_at).getTime() < limit);
  const results = await Promise.allSettled(due.map((s) => syncSheetSource(p, s)));
  return results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.added : 0), 0);
}
