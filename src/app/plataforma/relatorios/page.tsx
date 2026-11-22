import Link from "next/link";
import { BarChart3, Download, FileText, HandCoins, Megaphone, Target, TrendingUp, Trophy, Wallet } from "lucide-react";
import { getMonthlyReport, getPlatformContext, trafficKpis } from "@/server/platform";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { currentMonth, monthLabel, parseMonth, shiftMonth } from "@/shared/months";
import { Delta, money, MonthPicker, num } from "./report-bits";

export const metadata = { title: "Relatórios mensais" };

export default async function RelatoriosPage({ searchParams }: PageProps<"/plataforma/relatorios">) {
  const p = await getPlatformContext();
  const month = parseMonth((await searchParams).mes);
  const [rows, prevRows] = await Promise.all([getMonthlyReport(p, month), getMonthlyReport(p, shiftMonth(month, -1))]);
  const prev = new Map(prevRows.map((r) => [r.id, r]));
  const partial = month === currentMonth();

  type K = "paid_leads_new" | "paid_leads_won" | "paid_won_value_cents" | "leads_new";
  const sum = (rs: typeof rows, k: K) => rs.reduce((a, r) => a + r[k], 0);
  const spendOf = (rs: typeof rows) => rs.reduce((a, r) => a + trafficKpis(r).spend, 0);
  const spend = spendOf(rows);
  const prevSpend = spendOf(prevRows);
  const leads = sum(rows, "paid_leads_new");
  const cpl = spend > 0 && leads > 0 ? Math.round(spend / leads) : null;
  const prevLeads = sum(prevRows, "paid_leads_new");
  const prevCpl = prevSpend > 0 && prevLeads > 0 ? Math.round(prevSpend / prevLeads) : undefined;
  const revenue = sum(rows, "paid_won_value_cents");
  const roas = spend > 0 ? revenue / spend : null;
  const cards = [
    { icon: Wallet, label: "Investido em anúncios", value: money(spend), now: spend, before: prevSpend, invert: false },
    { icon: Megaphone, label: "Leads do tráfego pago", value: num(leads), now: leads, before: prevLeads, invert: false },
    { icon: Target, label: "Custo por lead", value: cpl === null ? "—" : money(cpl), now: cpl ?? 0, before: cpl === null ? undefined : prevCpl, invert: true },
    { icon: Trophy, label: "Fechados do tráfego", value: num(sum(rows, "paid_leads_won")), now: sum(rows, "paid_leads_won"), before: sum(prevRows, "paid_leads_won"), invert: false },
    { icon: HandCoins, label: "Faturamento do tráfego", value: money(revenue), now: revenue, before: sum(prevRows, "paid_won_value_cents"), invert: false },
    { icon: TrendingUp, label: "Retorno (ROAS)", value: roas === null ? "—" : `${roas.toFixed(1).replace(".", ",")}x`, now: 0, before: undefined, invert: false },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        icon={BarChart3}
        title={`Relatório de ${monthLabel(month)}`}
        subtitle={
          partial
            ? "Mês em andamento: os números ainda vão mudar até o fim do mês."
            : "Fechamento do mês de cada cliente. Só números gerais; contatos e conversas continuam privados."
        }
        actions={
          <>
            <MonthPicker month={month} action="/plataforma/relatorios" />
            <a href={`/api/plataforma/relatorios?mes=${month}`} className="btn-secondary btn-sm"><Download className="h-4 w-4" /> Baixar planilha</a>
          </>
        }
      />

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-subtle"><Megaphone className="h-4 w-4 text-accent" /> Tráfego pago (todos os clientes)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {cards.map((c) => (
            <div key={c.label} className="card p-4">
              <c.icon className="h-5 w-5 text-accent" />
              <p className="mt-3 text-2xl font-semibold tabular-nums">{c.value}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">{c.label} <Delta now={c.now} before={c.before} invert={c.invert} /></p>
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="Nenhum cliente neste mês" hint="Os clientes aparecem aqui a partir do mês em que foram criados." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 text-right font-medium">Investido</th>
                  <th className="px-5 py-3 text-right font-medium">Leads do tráfego</th>
                  <th className="px-5 py-3 text-right font-medium">Custo por lead</th>
                  <th className="px-5 py-3 text-right font-medium">Fechados do tráfego</th>
                  <th className="px-5 py-3 text-right font-medium">Faturamento</th>
                  <th className="px-5 py-3 text-right font-medium">ROAS</th>
                  <th className="px-5 py-3 text-right font-medium">Todos os leads</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const b = prev.get(r.id);
                  const k = trafficKpis(r);
                  const kb = b ? trafficKpis(b) : null;
                  return (
                    <tr key={r.id} className="align-top hover:bg-surface-2/40">
                      <td className="px-5 py-3">
                        <span className="block font-medium">{r.name}</span>
                        <span className="block text-xs text-subtle">
                          {r.top_campaigns[0] ? `Top anúncio: ${r.top_campaigns[0].campaign}` : `${num(r.contacts_total)} contatos`}
                          {r.suspended ? " · suspenso" : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                        {k.spend ? money(k.spend) : <span className="text-warning">informar</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {num(r.paid_leads_new)}<br /><Delta now={r.paid_leads_new} before={b?.paid_leads_new} />
                        {r.ad_leads_new > 0 && <span className="block text-xs text-subtle">{num(r.ad_leads_new)} via anúncio no WhatsApp</span>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                        {k.cpl === null ? "—" : money(k.cpl)}<br />
                        {k.cpl !== null && kb?.cpl != null && <Delta now={k.cpl} before={kb.cpl} invert />}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(r.paid_leads_won)}<br /><Delta now={r.paid_leads_won} before={b?.paid_leads_won} /></td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{money(r.paid_won_value_cents)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">{k.roas === null ? "—" : `${k.roas.toFixed(1).replace(".", ",")}x`}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted">{num(r.leads_new)}<span className="block text-xs">{num(r.leads_won)} fechados</span></td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/plataforma/relatorios/${r.id}?mes=${month}`} className="btn-secondary btn-sm whitespace-nowrap">
                          <FileText className="h-3.5 w-3.5" /> Relatório
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-subtle">
        Lead do tráfego pago = chegou por anúncio no WhatsApp (detectado automaticamente) ou tem uma etiqueta marcada como “tráfego pago”.
        Custo por lead = investido ÷ leads do tráfego. ROAS = faturamento do tráfego ÷ investido. O investimento é informado no relatório de cada cliente.
      </p>
    </div>
  );
}
