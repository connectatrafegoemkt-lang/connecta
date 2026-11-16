import Link from "next/link";
import { getTenantContext } from "@/server/context";
import { listTasks } from "@/server/data/tasks";
import { listMembers } from "@/server/data/members";
import { ActionForm } from "@/components/action-form";
import { dateTime } from "@/components/format";
import { createTaskAction, deleteTaskAction, setTaskStatusAction } from "../actions";

export const metadata = { title: "Tarefas — CONNECTA CRM" };

const FILTERS = [
  ["pendente", "Pendentes"],
  ["concluida", "Concluídas"],
  ["cancelada", "Canceladas"],
] as const;

export default async function TarefasPage({ searchParams }: PageProps<"/tarefas">) {
  const ctx = await getTenantContext();
  const sp = await searchParams;
  const status = FILTERS.find(([k]) => k === sp.status)?.[0] ?? "pendente";
  const [tasks, members] = await Promise.all([listTasks(ctx, { status }), listMembers(ctx)]);
  const memberName = new Map(members.map((m) => [m.user_id, m.display_name ?? "Usuário"]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tarefas e lembretes</h1>

      <div className="card">
        <ActionForm action={createTaskAction} resetOnSuccess className="grid gap-3 md:grid-cols-6" submitLabel="Criar tarefa">
          <input name="title" required placeholder="Título *" className="input md:col-span-2" />
          <label className="text-xs text-slate-500">Prazo<input type="datetime-local" name="due_at" className="input" /></label>
          <label className="text-xs text-slate-500">Lembrete<input type="datetime-local" name="remind_at" className="input" /></label>
          <label className="text-xs text-slate-500">Responsável
            <select name="assigned_to" defaultValue={ctx.userId} className="input">
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name ?? "Usuário"}</option>)}
            </select>
          </label>
          <textarea name="description" placeholder="Descrição" rows={1} className="input md:col-span-6" />
        </ActionForm>
      </div>

      <nav className="flex gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/tarefas?status=${k}`} className={k === status ? "btn-primary" : "btn-secondary"}>{label}</Link>
        ))}
      </nav>

      <ul className="card divide-y divide-slate-100 p-0">
        {tasks.map((t) => {
          const overdue = t.overdue;
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <form action={setTaskStatusAction}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value={t.status === "concluida" ? "pendente" : "concluida"} />
                <button
                  title={t.status === "concluida" ? "Reabrir" : "Concluir"}
                  className={`flex h-5 w-5 items-center justify-center rounded border ${t.status === "concluida" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}
                >
                  {t.status === "concluida" ? "✓" : ""}
                </button>
              </form>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${t.status === "concluida" ? "text-slate-400 line-through" : ""}`}>{t.title}</p>
                <p className="text-xs text-slate-500">
                  {t.contacts?.name && t.contact_id && (<><Link href={`/contatos/${t.contact_id}`} className="hover:underline">{t.contacts.name}</Link> · </>)}
                  <span className={overdue ? "font-medium text-red-600" : ""}>Prazo {dateTime(t.due_at)}</span>
                  {t.remind_at && ` · Lembrete ${dateTime(t.remind_at)}`}
                  {t.assigned_to && ` · ${memberName.get(t.assigned_to) ?? ""}`}
                </p>
              </div>
              {t.status === "pendente" && (
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="status" value="cancelada" />
                  <button className="text-xs text-slate-400 hover:text-slate-700">Cancelar</button>
                </form>
              )}
              <form action={deleteTaskAction}>
                <input type="hidden" name="id" value={t.id} />
                <button className="text-xs text-slate-400 hover:text-red-600">Excluir</button>
              </form>
            </li>
          );
        })}
        {tasks.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma tarefa.</li>}
      </ul>
    </div>
  );
}
