import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bearerFrom, createUserClient } from "./supabase/user-client";
import { badRequest, forbidden, fromDbError, notFound, unauthorized } from "./errors";

/**
 * Painel da CONNECTA (administração da plataforma).
 *
 * Quem é administrador da plataforma é decidido NO BANCO
 * (`public.is_platform_admin()`, lendo `app.platform_admins` pelo auth.uid()
 * do JWT). Nada vindo do front é considerado.
 */
export interface PlatformContext {
  readonly kind: "platform";
  supabase: SupabaseClient;
}

export const getPlatformContext = cache(async (): Promise<PlatformContext> => {
  const supabase = await createUserClient(bearerFrom(await headers()));
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) throw unauthorized();
  if (data !== true) throw forbidden("Apenas a equipe CONNECTA");
  return { kind: "platform", supabase };
});

/** Para mostrar ou esconder o link do painel. Nunca lança erro. */
export async function isPlatformAdmin(): Promise<boolean> {
  try {
    await getPlatformContext();
    return true;
  } catch {
    return false;
  }
}

export interface ClientTenant {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  members: number;
  contacts: number;
  whatsapp_status: string | null;
  ai_mode: string | null;
  ai_messages_month: number;
  ai_tokens_month: number;
  suspended_at: string | null;
  suspended_reason: string | null;
}

/** Só metadados dos clientes; a autorização é refeita dentro da função do banco. */
export async function listClientTenants(p: PlatformContext): Promise<ClientTenant[]> {
  const { data, error } = await p.supabase.rpc("platform_tenants_overview");
  if (error) throw fromDbError(error);
  return (data as ClientTenant[]).map((t) => ({ ...t, ai_tokens_month: Number(t.ai_tokens_month) }));
}

/**
 * Suspende ou reativa um cliente. O id do cliente vem do painel (é a equipe
 * CONNECTA escolhendo QUAL cliente); a autorização é feita no banco por
 * platform_set_tenant_suspended (exige administrador da plataforma e impede
 * suspender a própria empresa).
 */
export async function setClientSuspended(p: PlatformContext, tenantId: string, suspend: boolean, reason?: string | null) {
  const { error } = await p.supabase.rpc("platform_set_tenant_suspended", {
    p_tenant: tenantId,
    p_suspend: suspend,
    p_reason: reason ?? null,
  });
  if (error) {
    if (error.code === "P0002") throw notFound("Cliente não encontrado");
    if (error.code === "42501" && /própria/.test(error.message)) throw badRequest("Você não pode suspender a empresa da sua própria conta.");
    throw fromDbError(error);
  }
}

export { createClientTenant, deleteClientTenant } from "./admin/platform-admin";

export interface MonthlyReportRow {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
  members: number;
  contacts_total: number;
  leads_new: number;
  leads_won: number;
  won_value_cents: number;
  leads_lost: number;
  open_value_cents: number;
  wa_in: number;
  wa_out: number;
  wa_conversations: number;
  ai_responses: number;
  ai_suggestions: number;
  ai_tokens: number;
  tasks_created: number;
  tasks_done: number;
  interactions_other: number;
  top_sources: { source: string; count: number }[];
  paid_leads_new: number;
  ad_leads_new: number;
  paid_leads_won: number;
  paid_won_value_cents: number;
  spend_meta_cents: number;
  spend_google_cents: number;
  spend_other_cents: number;
  top_campaigns: { campaign: string; count: number }[];
}

/** Indicadores de tráfego pago derivados (investimento, CPL, retorno). */
export function trafficKpis(r: MonthlyReportRow) {
  const spend = r.spend_meta_cents + r.spend_google_cents + r.spend_other_cents;
  return {
    spend,
    cpl: spend > 0 && r.paid_leads_new > 0 ? Math.round(spend / r.paid_leads_new) : null,
    cac: spend > 0 && r.paid_leads_won > 0 ? Math.round(spend / r.paid_leads_won) : null,
    roas: spend > 0 ? r.paid_won_value_cents / spend : null,
    conversion: r.paid_leads_new > 0 ? Math.round((r.paid_leads_won / r.paid_leads_new) * 100) : null,
  };
}

/** Investimento em anúncios do cliente no mês (informado pela CONNECTA). */
export async function setAdSpend(p: PlatformContext, tenantId: string, month: string, cents: { meta: number; google: number; other: number }) {
  const { error } = await p.supabase.rpc("platform_set_ad_spend", {
    p_tenant: tenantId,
    p_month: `${month}-01`,
    p_meta: cents.meta,
    p_google: cents.google,
    p_other: cents.other,
  });
  if (error) {
    if (error.code === "P0002") throw notFound("Cliente não encontrado");
    throw fromDbError(error);
  }
}

/**
 * Relatório mensal (só números por cliente). `month` = "AAAA-MM" já
 * validado; a autorização é refeita no banco (platform_monthly_report).
 */
export async function getMonthlyReport(p: PlatformContext, month: string): Promise<MonthlyReportRow[]> {
  const { data, error } = await p.supabase.rpc("platform_monthly_report", { p_month: `${month}-01` });
  if (error) throw fromDbError(error);
  return (data as MonthlyReportRow[]).map((r) => ({
    ...r,
    won_value_cents: Number(r.won_value_cents),
    open_value_cents: Number(r.open_value_cents),
    ai_tokens: Number(r.ai_tokens),
    top_sources: Array.isArray(r.top_sources) ? r.top_sources : [],
    paid_won_value_cents: Number(r.paid_won_value_cents ?? 0),
    spend_meta_cents: Number(r.spend_meta_cents ?? 0),
    spend_google_cents: Number(r.spend_google_cents ?? 0),
    spend_other_cents: Number(r.spend_other_cents ?? 0),
    top_campaigns: Array.isArray(r.top_campaigns) ? r.top_campaigns : [],
  }));
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // evita fórmulas no Excel (=, +, -, @) e escapa aspas
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV (separador ";", padrão do Excel em português). */
export function monthlyReportCsv(rows: MonthlyReportRow[]): string {
  const head = [
    "Cliente", "Identificador", "Suspenso",
    "Investimento total (R$)", "Investimento Meta (R$)", "Investimento Google (R$)", "Outros (R$)", "Leads do tráfego pago",
    "Leads de anúncio no WhatsApp", "Custo por lead (R$)", "Fechados do tráfego", "Faturamento do tráfego (R$)", "Retorno (ROAS)",
    "Principais anúncios", "Usuários", "Contatos (total)", "Leads novos", "Fechados", "Valor fechado (R$)",
    "Perdidos", "Em aberto no funil (R$)", "WhatsApp recebidas", "WhatsApp enviadas", "Conversas", "Respostas da IA",
    "Sugestões da IA", "Tokens da IA", "Tarefas criadas", "Tarefas concluídas", "Outras interações", "Principais origens",
  ];
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const lines = rows.map((r) => {
    const k = trafficKpis(r);
    return [
      r.name, r.slug, r.suspended ? "sim" : "não",
      money(k.spend), money(r.spend_meta_cents), money(r.spend_google_cents), money(r.spend_other_cents), r.paid_leads_new,
      r.ad_leads_new, k.cpl === null ? "" : money(k.cpl), r.paid_leads_won, money(r.paid_won_value_cents),
      k.roas === null ? "" : k.roas.toFixed(2).replace(".", ","), r.top_campaigns.map((c) => `${c.campaign} (${c.count})`).join(", "), r.members, r.contacts_total, r.leads_new, r.leads_won, money(r.won_value_cents),
      r.leads_lost, money(r.open_value_cents), r.wa_in, r.wa_out, r.wa_conversations, r.ai_responses, r.ai_suggestions, r.ai_tokens,
      r.tasks_created, r.tasks_done, r.interactions_other, r.top_sources.map((s) => `${s.source} (${s.count})`).join(", "),
    ].map(csvCell).join(";");
  });
  return "﻿" + [head.join(";"), ...lines].join("\r\n");
}
