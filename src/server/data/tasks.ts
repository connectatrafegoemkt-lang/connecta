import "server-only";
import type { TenantContext } from "../context";
import { fromDbError, notFound } from "../errors";

export interface Task {
  id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  status: "pendente" | "concluida" | "cancelada";
  due_at: string | null;
  remind_at: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  created_at: string;
  contacts?: { name: string } | null;
}

const COLS = "id, contact_id, title, description, status, due_at, remind_at, assigned_to, completed_at, created_at, contacts(name)";

export async function listTasks(ctx: TenantContext, opts: { status?: Task["status"]; contact_id?: string } = {}) {
  let q = ctx.db
    .select("tasks", COLS)
    .order("status")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.contact_id) q = q.eq("contact_id", opts.contact_id);
  const { data, error } = await q;
  if (error) throw fromDbError(error);
  return data as unknown as Task[];
}

/** Lembretes vencidos do usuário (para notificação no painel). */
export async function dueReminders(ctx: TenantContext) {
  const { data, error } = await ctx.db
    .select("tasks", COLS)
    .eq("status", "pendente")
    .lte("remind_at", new Date().toISOString())
    .or(`assigned_to.eq.${ctx.userId},assigned_to.is.null`)
    .order("remind_at")
    .limit(20);
  if (error) throw fromDbError(error);
  return data as unknown as Task[];
}

export async function createTask(ctx: TenantContext, input: Partial<Task> & { title: string }) {
  const { data, error } = await ctx.db
    .insert("tasks", { assigned_to: ctx.userId, ...input })
    .select(COLS)
    .single();
  if (error) throw fromDbError(error);
  return data as unknown as Task;
}

export async function updateTask(ctx: TenantContext, id: string, input: Partial<Task>) {
  const { data, error } = await ctx.db.update("tasks", input).eq("id", id).select(COLS);
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Tarefa não encontrada");
  return data[0] as unknown as Task;
}

export async function deleteTask(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.delete("tasks").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Tarefa não encontrada");
}
