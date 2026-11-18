import Link from "next/link";
import { AlarmClock, Ban, CalendarClock, Check, CircleCheck, ListTodo, Plus, Trash2, UserRound } from "lucide-react";
import { getTenantContext } from "@/server/context";
import { listTasks } from "@/server/data/tasks";
import { listMembers } from "@/server/data/members";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { dateTime } from "@/components/format";
import { createTaskAction, deleteTaskAction, setTaskStatusAction } from "../actions";

export const metadata = { title: "Tarefas" };

const FILTERS = [
  ["pendente", "Pendentes", ListTodo],
  ["concluida", "Concluídas", CircleCheck],
  ["cancelada", "Canceladas", Ban],
] as const;

export default async function TarefasPage({ searchParams }: PageProps<"/tarefas">) {
  const ctx = await getTenantContext();
  const sp = await searchParams;
  const status = FILTERS.find(([k]) => k === sp.status)?.[0] ?? "pendente";
  const [tasks, members] = await Promise.all([listTasks(ctx, { status }), listMembers(ctx)]);
  const memberName = new Map(members.map((m) => [m.user_id, m.display_name ?? "Usuário"]));

  return (
    <div className="space-y-6">
      <PageHeader icon={ListTodo} title="Tarefas e lembretes" subtitle="Organize o follow-up da equipe e não perca nenhum retorno." />

      <div className="card">
        <h2 className="section-title"><Plus className="h-4 w-4 text-accent" /> Nova tarefa</h2>
        <ActionForm action={createTaskAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-6" submitLabel="Criar tarefa" submitIcon={<Plus className="h-4 w-4" />} submitClassName="btn-primary self-end md:col-start-6">
          <label className="md:col-span-3"><span className="label">Título *</span><input name="title" required placeholder="Ex.: Ligar para confirmar proposta" className="input" /></label>
          <label><span className="label">Prazo</span><input type="datetime-local" name="due_at" className="input" /></label>
          <label><span className="label">Lembrete</span><input type="datetime-local" name="remind_at" className="input" /></label>
          <label><span className="label">Responsável</span>
            <select name="assigned_to" defaultValue={ctx.userId} className="input">
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name ?? "Usuário"}</option>)}
            </select>
          </label>
          <label className="md:col-span-5"><span className="label">Descrição</span><textarea name="description" rows={1} className="input" /></label>
        </ActionForm>
      </div>

      <nav className="inline-flex rounded-xl border border-line bg-surface p-1">
        {FILTERS.map(([k, label, Icon]) => (
          <Link
            key={k}
            href={`/tarefas?status=${k}`}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${k === status ? "bg-brand-500/20 text-accent-strong shadow-[inset_0_0_0_1px_rgb(161_0_255/0.4)]" : "text-muted hover:text-fg"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </nav>

      <div className="card p-0">
        {tasks.length === 0 ? (
          <EmptyState icon={CircleCheck} title="Nada por aqui" hint={status === "pendente" ? "Todas as tarefas em dia." : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t) => {
              const done = t.status === "concluida";
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-surface-2/50">
                  <form action={setTaskStatusAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value={done ? "pendente" : "concluida"} />
                    <button
                      title={done ? "Reabrir" : "Concluir"}
                      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
                      className={`flex h-6 w-6 items-center justify-center rounded-lg border transition ${done ? "border-brand-500 bg-brand-500 text-white" : "border-line-strong hover:border-brand-400 hover:bg-brand-500/10"}`}
                    >
                      {done && <Check className="h-3.5 w-3.5" />}
                    </button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${done ? "text-subtle line-through" : "text-fg"}`}>{t.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {t.contacts?.name && t.contact_id && (
                        <Link href={`/contatos/${t.contact_id}`} className="link">{t.contacts.name}</Link>
                      )}
                      <span className={`inline-flex items-center gap-1 ${t.overdue ? "font-medium text-danger" : ""}`}>
                        <CalendarClock className="h-3 w-3" /> {t.overdue ? "Atrasada · " : ""}{dateTime(t.due_at)}
                      </span>
                      {t.remind_at && <span className="inline-flex items-center gap-1"><AlarmClock className="h-3 w-3" /> {dateTime(t.remind_at)}</span>}
                      {t.assigned_to && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" /> {memberName.get(t.assigned_to) ?? ""}</span>}
                    </div>
                  </div>
                  {t.status === "pendente" && (
                    <form action={setTaskStatusAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="cancelada" />
                      <button className="btn-ghost btn-sm"><Ban className="h-3.5 w-3.5" /> Cancelar</button>
                    </form>
                  )}
                  <form action={deleteTaskAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="icon-btn hover:text-danger" title="Excluir" aria-label="Excluir tarefa"><Trash2 className="h-4 w-4" /></button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
