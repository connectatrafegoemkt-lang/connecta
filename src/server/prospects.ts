import "server-only";
import type { PlatformContext } from "./platform";
import { badRequest, fromDbError, notFound } from "./errors";
import type { ImportRow } from "@/shared/prospects";
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
