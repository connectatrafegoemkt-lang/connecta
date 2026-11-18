import Link from "next/link";
import { getTenantContext } from "@/server/context";
import { getDashboard } from "@/server/data/dashboard";
import { dueReminders } from "@/server/data/tasks";
import { listRecentInteractions } from "@/server/data/interactions";
import { brl, dateTime, interactionLabel } from "@/components/format";

export const metadata = { title: "Dashboard — CONNECTA CRM" };

export default async function DashboardPage() {
  const ctx = await getTenantContext();
  const [d, reminders, recent] = await Promise.all([
    getDashboard(ctx),
    dueReminders(ctx),
    listRecentInteractions(ctx, 8),
  ]);
  const maxStage = Math.max(1, ...d.by_stage.map((s) => s.count));

  const cards = [
    { label: "Contatos", value: d.contacts_total, hint: `+${d.contacts_last_30d} em 30 dias` },
    { label: "Em negociação", value: brl(d.pipeline_value_cents), hint: "etapas abertas" },
    { label: "Ganho", value: brl(d.won_value_cents), hint: "etapas de ganho" },
    { label: "Tarefas abertas", value: d.tasks_open, hint: `${d.tasks_overdue} atrasadas` },
    { label: "Interações (7 dias)", value: d.interactions_last_7d, hint: "todas as origens" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {reminders.length > 0 && (
        <div className="card border-l-4 border-amber-400">
          <h2 className="font-semibold text-amber-700">Lembretes ({reminders.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {reminders.map((t) => (
              <li key={t.id}>
                <Link href="/tarefas" className="hover:underline">
                  {t.title}
                </Link>
                {t.contacts?.name && <span className="text-slate-500"> · {t.contacts.name}</span>}
                <span className="text-slate-400"> · {dateTime(t.remind_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</p>
            <p className="mt-1 text-xs text-slate-400">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Contatos por etapa</h2>
          <ul className="mt-4 space-y-3">
            {d.by_stage.map((s) => (
              <li key={s.id}>
                <div className="flex justify-between text-sm">
                  <span>{s.name}</span>
                  <span className="tabular-nums text-slate-500">{s.count}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(s.count / maxStage) * 100}%`, backgroundColor: s.color }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 className="font-semibold">Últimas interações</h2>
          {recent.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Nenhuma interação ainda.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {recent.map((i) => (
                <li key={i.id} className="py-2 text-sm">
                  <Link href={`/contatos/${i.contact_id}`} className="font-medium hover:underline">
                    {i.contacts?.name ?? "Contato"}
                  </Link>
                  <span className="text-slate-400"> · {interactionLabel[i.type]} · {dateTime(i.occurred_at)}</span>
                  <p className="line-clamp-1 text-slate-600">{i.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
