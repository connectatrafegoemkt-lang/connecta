import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, CheckSquare, HandCoins, MessageCircle, Target, Trophy, UserPlus, XCircle } from "lucide-react";
import { getMonthlyReport, getPlatformContext } from "@/server/platform";
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">Resultados</h2>
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
          Comparações em relação a {monthLabel(shiftMonth(month, -1)).toLowerCase()}. “Contratos fechados” são leads que entraram numa etapa de ganho do funil no mês.
          Gerado pelo CONNECTA CRM.
        </footer>
      </article>
    </div>
  );
}
