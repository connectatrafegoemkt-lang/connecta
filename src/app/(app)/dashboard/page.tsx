import Link from "next/link";
import {
  Activity,
  AlarmClock,
  ArrowRight,
  Bell,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getTenantContext } from "@/server/context";
import { getDashboard } from "@/server/data/dashboard";
import { dueReminders } from "@/server/data/tasks";
import { listRecentInteractions } from "@/server/data/interactions";
import { brl, dateTime, interactionLabel } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Dashboard" };

function Stat({ icon: Icon, label, value, hint, tone = "brand" }: { icon: LucideIcon; label: string; value: React.ReactNode; hint: React.ReactNode; tone?: "brand" | "warning" }) {
  return (
    <div className="card card-hover relative overflow-hidden">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-500/10 blur-2xl" />
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tone === "warning" ? "border-warning/30 bg-warning/10 text-warning" : "border-brand-500/30 bg-brand-500/10 text-brand-600"}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-subtle">{hint}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await getTenantContext();
  const [d, reminders, recent] = await Promise.all([getDashboard(ctx), dueReminders(ctx), listRecentInteractions(ctx, 8)]);
  const maxStage = Math.max(1, ...d.by_stage.map((s) => s.count));
  const totalInStages = d.by_stage.reduce((a, s) => a + s.count, 0);
  const firstName = ctx.displayName?.split(" ")[0];

  return (
    <div className="space-y-8">
      <PageHeader
        icon={LayoutDashboard}
        title={firstName ? `Olá, ${firstName}` : "Dashboard"}
        subtitle={`Visão geral de ${ctx.tenantName}`}
        actions={
          <Link href="/contatos" className="btn-primary">
            <Users className="h-4 w-4" /> Ver contatos
          </Link>
        }
      />

      {reminders.length > 0 && (
        <div className="card border-warning/30 bg-gradient-to-r from-warning/10 to-transparent">
          <h2 className="section-title text-warning">
            <Bell className="h-4 w-4" /> {reminders.length} lembrete{reminders.length > 1 ? "s" : ""} para agora
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {reminders.map((t) => (
              <li key={t.id} className="min-w-0">
                <Link href="/tarefas" className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm transition hover:border-warning/40">
                  <AlarmClock className="h-4 w-4 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1 truncate">
                    {t.title}
                    {t.contacts?.name && <span className="text-muted"> · {t.contacts.name}</span>}
                  </span>
                  {t.remind_at && <span className="hidden shrink-0 text-xs text-subtle sm:inline">{dateTime(t.remind_at)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat icon={Users} label="Contatos" value={d.contacts_total} hint={`+${d.contacts_last_30d} nos últimos 30 dias`} />
        <Stat icon={Wallet} label="Em negociação" value={brl(d.pipeline_value_cents)} hint="Soma das etapas abertas" />
        <Stat icon={Trophy} label="Ganho" value={brl(d.won_value_cents)} hint="Etapas marcadas como ganho" />
        <Stat icon={ListTodo} label="Tarefas abertas" value={d.tasks_open} hint={d.tasks_overdue > 0 ? `${d.tasks_overdue} atrasada(s)` : "Nenhuma atrasada"} tone={d.tasks_overdue > 0 ? "warning" : "brand"} />
        <Stat icon={Activity} label="Interações" value={d.interactions_last_7d} hint="Últimos 7 dias" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Contatos por etapa</h2>
            <Link href="/funil" className="link inline-flex items-center gap-1 text-xs">
              Abrir funil <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {d.by_stage.length === 0 ? (
            <EmptyState icon={Users} title="Sem etapas" />
          ) : (
            <ul className="mt-5 space-y-4" aria-label="Contatos por etapa do funil">
              {d.by_stage.map((s) => {
                const share = totalInStages ? Math.round((s.count / totalInStages) * 100) : 0;
                return (
                  <li key={s.id} className="group" title={`${s.name}: ${s.count} contato(s), ${share}% do total`}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-2 text-fg">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                        {s.name}
                      </span>
                      <span className="tabular-nums text-muted">
                        {s.count} <span className="text-subtle">· {share}%</span>
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-surface-2">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all group-hover:from-brand-500 group-hover:to-brand-300"
                        style={{ width: `${s.count === 0 ? 0 : Math.max(2, (s.count / maxStage) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card lg:col-span-2">
          <h2 className="section-title">Últimas interações</h2>
          {recent.length === 0 ? (
            <EmptyState icon={MessageCircle} title="Nenhuma interação ainda" hint="Registre notas e ligações nos contatos, ou conecte o WhatsApp." />
          ) : (
            <ul className="mt-4 space-y-1">
              {recent.map((i) => (
                <li key={i.id}>
                  <Link href={`/contatos/${i.contact_id}`} className="flex gap-3 rounded-xl px-2 py-2 transition hover:bg-surface-2">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${i.type === "whatsapp" ? "bg-success/10 text-success" : "bg-brand-500/10 text-brand-600"}`}>
                      {i.type === "whatsapp" ? <MessageCircle className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{i.contacts?.name ?? "Contato"}</span>
                        <span className="shrink-0 text-xs text-subtle">{dateTime(i.occurred_at)}</span>
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {interactionLabel[i.type]} · {i.body}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
