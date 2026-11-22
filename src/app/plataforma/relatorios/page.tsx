import Link from "next/link";
import { BarChart3, Bot, Download, FileText, HandCoins, MessageCircle, Trophy, UserPlus } from "lucide-react";
import { getMonthlyReport, getPlatformContext } from "@/server/platform";
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

  const sum = (rs: typeof rows, k: "leads_new" | "leads_won" | "won_value_cents" | "wa_in" | "wa_out" | "ai_responses") =>
    rs.reduce((a, r) => a + r[k], 0);
  const cards = [
    { icon: UserPlus, label: "Leads novos", value: num(sum(rows, "leads_new")), now: sum(rows, "leads_new"), before: sum(prevRows, "leads_new") },
    { icon: Trophy, label: "Fechados", value: num(sum(rows, "leads_won")), now: sum(rows, "leads_won"), before: sum(prevRows, "leads_won") },
    { icon: HandCoins, label: "Valor fechado", value: money(sum(rows, "won_value_cents")), now: sum(rows, "won_value_cents"), before: sum(prevRows, "won_value_cents") },
    { icon: MessageCircle, label: "Mensagens no WhatsApp", value: num(sum(rows, "wa_in") + sum(rows, "wa_out")), now: sum(rows, "wa_in") + sum(rows, "wa_out"), before: sum(prevRows, "wa_in") + sum(prevRows, "wa_out") },
    { icon: Bot, label: "Respostas da IA", value: num(sum(rows, "ai_responses")), now: sum(rows, "ai_responses"), before: sum(prevRows, "ai_responses") },
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <c.icon className="h-5 w-5 text-accent" />
            <p className="mt-3 text-2xl font-semibold tabular-nums">{c.value}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">{c.label} <Delta now={c.now} before={c.before} /></p>
          </div>
        ))}
      </div>

      <section className="card overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="Nenhum cliente neste mês" hint="Os clientes aparecem aqui a partir do mês em que foram criados." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 text-right font-medium">Leads novos</th>
                  <th className="px-5 py-3 text-right font-medium">Fechados</th>
                  <th className="px-5 py-3 text-right font-medium">Valor fechado</th>
                  <th className="px-5 py-3 text-right font-medium">Conversão</th>
                  <th className="px-5 py-3 text-right font-medium">WhatsApp</th>
                  <th className="px-5 py-3 text-right font-medium">IA</th>
                  <th className="px-5 py-3 font-medium">Principal origem</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const b = prev.get(r.id);
                  const conv = r.leads_new ? Math.round((r.leads_won / r.leads_new) * 100) : null;
                  const top = r.top_sources[0];
                  return (
                    <tr key={r.id} className="align-top hover:bg-surface-2/40">
                      <td className="px-5 py-3">
                        <span className="block font-medium">{r.name}</span>
                        <span className="block text-xs text-subtle">{num(r.members)} usuário(s) · {num(r.contacts_total)} contatos{r.suspended ? " · suspenso" : ""}</span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(r.leads_new)}<br /><Delta now={r.leads_new} before={b?.leads_new} /></td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(r.leads_won)}<br /><Delta now={r.leads_won} before={b?.leads_won} /></td>
                      <td className="px-5 py-3 text-right tabular-nums">{money(r.won_value_cents)}<br /><Delta now={r.won_value_cents} before={b?.won_value_cents} /></td>
                      <td className="px-5 py-3 text-right tabular-nums">{conv === null ? "—" : `${conv}%`}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted">
                        {num(r.wa_in)} receb. · {num(r.wa_out)} env.
                        <span className="block text-xs">{num(r.wa_conversations)} conversa(s)</span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted">{num(r.ai_responses)}</td>
                      <td className="px-5 py-3 text-muted">{top ? `${top.source} (${num(top.count)})` : "—"}</td>
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
        “Fechados” e “Perdidos” contam os leads que entraram numa etapa de ganho ou perda no mês. “Conversão” = fechados ÷ leads novos do mês.
      </p>
    </div>
  );
}
