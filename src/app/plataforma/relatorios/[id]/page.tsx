import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, CheckSquare, HandCoins, Megaphone, MessageCircle, Save, Target, TrendingUp, Trophy, UserPlus, Wallet, XCircle } from "lucide-react";
import { getMonthlyReport, getPlatformContext, trafficKpis } from "@/server/platform";
import { ActionForm } from "@/components/action-form";
import { setAdSpendAction } from "../../actions";
import { idSchema } from "@/server/validation";
import { LogoMark } from "@/components/logo";
import { currentMonth, monthLabel, parseMonth, shiftMonth } from "@/shared/months";
import { Delta, money, MonthPicker, num } from "../report-bits";
import { PrintButton } from "./print-button";

export const metadata = { title: "Relatório do cliente" };

/** Relatório mensal de UM cliente, pronto para imprimir/enviar (só números). */
export default async function RelatorioClientePage({ params, searchParams }: PageProps<"/plataforma/relatorios/[id]">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const p = await getPlatformContext();
  const month = parseMonth((await searchParams).mes);
  const [rows, prevRows] = await Promise.all([getMonthlyReport(p, month), getMonthlyReport(p, shiftMonth(month, -1))]);
  const r = rows.find((x) => x.id === id);
  if (!r) notFound();
  const b = prevRows.find((x) => x.id === id);
  const conv = r.leads_new ? Math.round((r.leads_won / r.leads_new) * 100) : null;
  const maxSource = Math.max(1, ...r.top_sources.map((s) => s.count));
  const k = trafficKpis(r);
  const kb = b ? trafficKpis(b) : null;
  const maxCampaign = Math.max(1, ...r.top_campaigns.map((c) => c.count));
  const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const traffic = [
    { icon: Wallet, label: "Investido em anúncios", value: money(k.spend), now: k.spend, before: kb?.spend },
    { icon: Megaphone, label: "Leads do tráfego pago", value: num(r.paid_leads_new), now: r.paid_leads_new, before: b?.paid_leads_new },
    { icon: Target, label: "Custo por lead", value: k.cpl === null ? "—" : money(k.cpl), now: k.cpl ?? 0, before: k.cpl === null ? undefined : (kb?.cpl ?? undefined), invert: true },
    { icon: Trophy, label: "Contratos do tráfego", value: num(r.paid_leads_won), now: r.paid_leads_won, before: b?.paid_leads_won },
    { icon: HandCoins, label: "Faturamento do tráfego", value: money(r.paid_won_value_cents), now: r.paid_won_value_cents, before: b?.paid_won_value_cents },
    { icon: TrendingUp, label: "Retorno sobre o investimento", value: k.roas === null ? "—" : `${k.roas.toFixed(1).replace(".", ",")}x`, now: 0, before: undefined },
  ];

  const kpis = [
    { icon: UserPlus, label: "Leads novos", value: num(r.leads_new), now: r.leads_new, before: b?.leads_new },
    { icon: Trophy, label: "Contratos fechados", value: num(r.leads_won), now: r.leads_won, before: b?.leads_won },
    { icon: HandCoins, label: "Valor fechado", value: money(r.won_value_cents), now: r.won_value_cents, before: b?.won_value_cents },
    { icon: Target, label: "Conversão do mês", value: conv === null ? "—" : `${conv}%`, now: 0, before: undefined },
    { icon: XCircle, label: "Leads perdidos", value: num(r.leads_lost), now: r.leads_lost, before: b?.leads_lost, invert: true },
    { icon: HandCoins, label: "Em negociação no funil (hoje)", value: money(r.open_value_cents), now: 0, before: undefined },
  ];
  const activity = [
    { icon: MessageCircle, label: "Mensagens recebidas no WhatsApp", value: r.wa_in, before: b?.wa_in },
    { icon: MessageCircle, label: "Mensagens enviadas no WhatsApp", value: r.wa_out, before: b?.wa_out },
    { icon: MessageCircle, label: "Conversas com movimento", value: r.wa_conversations, before: b?.wa_conversations },
    { icon: Bot, label: "Respostas automáticas da IA", value: r.ai_responses, before: b?.ai_responses },
    { icon: Bot, label: "Sugestões da IA", value: r.ai_suggestions, before: b?.ai_suggestions },
    { icon: CheckSquare, label: "Tarefas concluídas", value: r.tasks_done, before: b?.tasks_done },
    { icon: CheckSquare, label: "Ligações, reuniões e notas", value: r.interactions_other, before: b?.interactions_other },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/plataforma/relatorios?mes=${month}`} className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Todos os clientes</Link>
        <div className="flex items-center gap-2">
          <MonthPicker month={month} action={`/plataforma/relatorios/${id}`} />
          <PrintButton />
        </div>
      </div>

      <article className="card space-y-8 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">Relatório mensal</p>
            <h1 className="mt-1 text-2xl font-semibold">{r.name}</h1>
            <p className="text-sm text-muted">
              {monthLabel(month)}
              {month === currentMonth() ? " (parcial, mês em andamento)" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 text-right">
            <div className="leading-tight">
              <p className="text-sm font-semibold">CONNECTA</p>
              <p className="text-xs text-muted">Tráfego e marketing</p>
            </div>
            <LogoMark size={44} />
          </div>
        </header>

        <section>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent"><Megaphone className="h-4 w-4" /> Tráfego pago</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {traffic.map((t) => (
              <div key={t.label} className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 break-inside-avoid">
                <t.icon className="h-4 w-4 text-accent" />
                <p className="mt-2 text-2xl font-semibold tabular-nums">{t.value}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">{t.label} <Delta now={t.now} before={t.before} invert={t.invert} /></p>
              </div>
            ))}
          </div>
          {k.conversion !== null && (
            <p className="mt-3 text-sm text-muted">
              {k.conversion}% dos leads do tráfego viraram contrato
              {k.cac !== null ? <> · custo por contrato fechado: <strong className="text-fg">{money(k.cac)}</strong></> : null}.
            </p>
          )}
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div className="break-inside-avoid">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">Anúncios que trouxeram leads (WhatsApp)</h3>
              <ul className="mt-3 space-y-2">
                {r.top_campaigns.map((c) => (
                  <li key={c.campaign} className="text-sm">
                    <span className="flex justify-between gap-3"><span className="truncate">{c.campaign}</span><span className="tabular-nums text-muted">{num(c.count)}</span></span>
                    <span className="mt-1 block h-2 rounded-full bg-surface-2">
                      <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(c.count / maxCampaign) * 100}%` }} />
                    </span>
                  </li>
                ))}
                {r.top_campaigns.length === 0 && (
                  <li className="text-sm text-subtle">Nenhum lead chegou por anúncio de “Enviar mensagem” neste mês.</li>
                )}
              </ul>
            </div>
            <div className="break-inside-avoid">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">Investimento do mês</h3>
              <ul className="mt-3 divide-y divide-line text-sm">
                <li className="flex justify-between py-1.5"><span className="text-muted">Meta (Instagram/Facebook)</span><span className="tabular-nums">{money(r.spend_meta_cents)}</span></li>
                <li className="flex justify-between py-1.5"><span className="text-muted">Google Ads</span><span className="tabular-nums">{money(r.spend_google_cents)}</span></li>
                <li className="flex justify-between py-1.5"><span className="text-muted">Outros</span><span className="tabular-nums">{money(r.spend_other_cents)}</span></li>
              </ul>
              <details className="mt-3 print:hidden" open={k.spend === 0}>
                <summary className="btn-secondary btn-sm cursor-pointer list-none"><Wallet className="h-3.5 w-3.5" /> {k.spend === 0 ? "Informar investimento" : "Corrigir investimento"}</summary>
                <ActionForm action={setAdSpendAction} className="mt-3 grid grid-cols-3 gap-2" submitLabel="Salvar" submitIcon={<Save className="h-3.5 w-3.5" />} submitClassName="btn-primary btn-sm col-span-3 justify-self-end">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="mes" value={month} />
                  <label className="text-xs text-muted">Meta (R$)<input name="meta" inputMode="decimal" defaultValue={reais(r.spend_meta_cents)} className="input mt-1 py-1.5 text-sm" /></label>
                  <label className="text-xs text-muted">Google (R$)<input name="google" inputMode="decimal" defaultValue={reais(r.spend_google_cents)} className="input mt-1 py-1.5 text-sm" /></label>
                  <label className="text-xs text-muted">Outros (R$)<input name="outros" inputMode="decimal" defaultValue={reais(r.spend_other_cents)} className="input mt-1 py-1.5 text-sm" /></label>
                </ActionForm>
              </details>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">Resultados gerais (todos os leads)</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-line p-4 break-inside-avoid">
                <k.icon className="h-4 w-4 text-accent" />
                <p className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">{k.label} <Delta now={k.now} before={k.before} invert={k.invert} /></p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="break-inside-avoid">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">De onde vieram os leads</h2>
            <ul className="mt-3 space-y-2">
              {r.top_sources.map((s) => (
                <li key={s.source} className="text-sm">
                  <span className="flex justify-between"><span>{s.source}</span><span className="tabular-nums text-muted">{num(s.count)}</span></span>
                  <span className="mt-1 block h-2 rounded-full bg-surface-2">
                    <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                  </span>
                </li>
              ))}
              {r.top_sources.length === 0 && <li className="text-sm text-subtle">Nenhum lead novo neste mês.</li>}
            </ul>
          </div>
          <div className="break-inside-avoid">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">Atendimento</h2>
            <ul className="mt-3 divide-y divide-line text-sm">
              {activity.map((a) => (
                <li key={a.label} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2 text-muted"><a.icon className="h-4 w-4" /> {a.label}</span>
                  <span className="flex items-center gap-2 tabular-nums"><Delta now={a.value} before={a.before} /> <strong>{num(a.value)}</strong></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="border-t border-line pt-4 text-xs text-subtle">
          Comparações em relação a {monthLabel(shiftMonth(month, -1)).toLowerCase()}. Lead do tráfego pago = chegou por anúncio no WhatsApp ou tem etiqueta de tráfego pago.
          “Contratos” são leads que entraram numa etapa de ganho do funil no mês.
          Gerado pelo CONNECTA CRM.
        </footer>
      </article>
    </div>
  );
}
