"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ExternalLink, UserRound, Loader2, Plus, RotateCcw, Save, TriangleAlert, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { dateTime, phoneFmt } from "@/components/format";
import { createTaskAction, setTaskStatusAction, updateContactAction } from "../actions";

export interface DrawerContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string | null;
  notes: string | null;
  value_cents: number;
  stage_id: string | null;
  department_id: string | null;
  avatar_url: string | null;
  whatsapp_name: string | null;
  whatsapp_about: string | null;
  tags: { id: string; name: string; color: string }[];
}

type Opt = { id: string; name: string; color?: string };

/**
 * Ficha do lead em painel lateral, por cima da conversa (sem sair da tela).
 * Salvar usa as mesmas Server Actions da ficha completa (RLS + permissões).
 */
export function LeadDrawer({
  contact,
  stages,
  departments,
  tasks,
  canEdit,
  canTasks,
  allSectors,
  myDepartmentIds,
  subtitle,
  actions,
}: {
  contact: DrawerContact;
  stages: Opt[];
  departments: Opt[];
  tasks: { id: string; title: string; status: string; due_at: string | null }[];
  canEdit: boolean;
  canTasks: boolean;
  allSectors: boolean;
  myDepartmentIds: string[];
  /** Linha abaixo do nome no topo da conversa (recado ou telefone). */
  subtitle?: React.ReactNode;
  /** Botões do topo (etiquetas, IA) entre o nome e o ícone da ficha. */
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [taskBusy, startTask] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const deptOptions = allSectors ? departments : departments.filter((d) => myDepartmentIds.includes(d.id) || d.id === contact.department_id);

  function save(fd: FormData) {
    setMsg(null);
    startSave(async () => {
      const r = await updateContactAction({}, fd);
      setMsg({ ok: !!r.ok, text: r.error ?? r.message ?? "Salvo." });
      router.refresh();
    });
  }
  function addTask(fd: FormData) {
    startTask(async () => {
      const r = await createTaskAction({}, fd);
      if (r.error) setMsg({ ok: false, text: r.error });
      router.refresh();
    });
  }
  function toggleTask(id: string, status: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", status === "concluida" ? "pendente" : "concluida");
    startTask(async () => {
      await setTaskStatusAction(fd);
      router.refresh();
    });
  }

  const label = "mb-1 block text-xs font-medium text-muted";

  return (
    <>
      {subtitle !== undefined && (
        <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left leading-tight" title="Dados do lead">
          <span className="block truncate font-medium">{contact.name}</span>
          <span className="block truncate text-xs text-muted">{subtitle}</span>
        </button>
      )}
      {actions}
      <button type="button" onClick={() => setOpen(true)} className="icon-btn h-10 w-10" title="Ficha do lead" aria-label="Ficha do lead">
        <UserRound className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Ficha de ${contact.name}`}>
          <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" aria-label="Fechar ficha" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-line bg-surface shadow-2xl animate-[slidein_.18s_ease-out]">
            <header className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--wa-panel)" }}>
              <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
              <span className="font-medium">Dados do lead</span>
            </header>

            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col items-center gap-1 px-6 py-6 text-center">
                <Avatar name={contact.name} url={contact.avatar_url} size={160} zoomable />
                <p className="mt-3 text-xl font-medium">{contact.name}</p>
                {contact.whatsapp_name && contact.whatsapp_name !== contact.name && (
                  <p className="text-sm text-muted">~{contact.whatsapp_name}</p>
                )}
                <p className="text-sm text-muted">{phoneFmt(contact.phone)}</p>
              </div>

              {contact.whatsapp_about && (
                <section className="border-t-8 border-[var(--wa-panel)] px-6 py-4">
                  <p className="text-xs font-medium text-muted">Recado</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{contact.whatsapp_about}</p>
                </section>
              )}

              <section className="border-t-8 border-[var(--wa-panel)] px-6 py-4">
                <form action={save}>
                  <fieldset disabled={!canEdit} className="space-y-3">
                    <input type="hidden" name="id" value={contact.id} />
                    <label className="block"><span className={label}>Nome</span><input name="name" defaultValue={contact.name} required className="input" /></label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block"><span className={label}>Telefone</span><input name="phone" defaultValue={contact.phone ?? ""} className="input" /></label>
                      <label className="block"><span className={label}>E-mail</span><input name="email" type="email" defaultValue={contact.email ?? ""} className="input" /></label>
                      <label className="block"><span className={label}>Empresa</span><input name="company" defaultValue={contact.company ?? ""} className="input" /></label>
                      <label className="block"><span className={label}>Origem</span><input name="source" defaultValue={contact.source ?? ""} className="input" /></label>
                      <label className="block"><span className={label}>Valor (R$)</span>
                        <input name="value" inputMode="decimal" defaultValue={(contact.value_cents / 100).toFixed(2).replace(".", ",")} className="input" />
                      </label>
                      <label className="block"><span className={label}>Etapa do funil</span>
                        <select name="stage_id" defaultValue={contact.stage_id ?? ""} className="input">
                          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </label>
                    </div>
                    {departments.length > 0 && (
                      <label className="block"><span className={label}>Setor</span>
                        <select name="department_id" defaultValue={contact.department_id ?? ""} className="input">
                          {(allSectors || !contact.department_id) && <option value="">Sem setor</option>}
                          {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="block"><span className={label}>Observações</span><textarea name="notes" defaultValue={contact.notes ?? ""} rows={3} className="input" /></label>
                    {canEdit && (
                      <button type="submit" className="btn-primary w-full" disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                      </button>
                    )}
                    {msg && (
                      <p className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
                        {msg.ok ? <Check className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />} {msg.text}
                      </p>
                    )}
                  </fieldset>
                </form>
              </section>

              {contact.tags.length > 0 && (
                <section className="border-t-8 border-[var(--wa-panel)] px-6 py-4">
                  <p className="text-xs font-medium text-muted">Etiquetas</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {contact.tags.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--wa-panel)" }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section className="border-t-8 border-[var(--wa-panel)] px-6 py-4">
                <p className="flex items-center gap-2 text-xs font-medium text-muted">
                  Tarefas {taskBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                </p>
                <ul className="mt-2 divide-y divide-line">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className={t.status === "concluida" ? "text-subtle line-through" : ""}>
                        {t.title}
                        {t.due_at && <span className="ml-2 inline-flex items-center gap-1 text-xs text-subtle"><CalendarClock className="h-3 w-3" />{dateTime(t.due_at)}</span>}
                      </span>
                      {canTasks && (
                        <button type="button" className="btn-ghost btn-sm" onClick={() => toggleTask(t.id, t.status)}>
                          {t.status === "concluida" ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </li>
                  ))}
                  {tasks.length === 0 && <li className="py-2 text-sm text-subtle">Nenhuma tarefa.</li>}
                </ul>
                {canTasks && (
                  <form action={addTask} className="mt-3 flex gap-2">
                    <input type="hidden" name="contact_id" value={contact.id} />
                    <input name="title" required placeholder="Nova tarefa (ex.: ligar amanhã)" className="input flex-1" />
                    <input type="datetime-local" name="due_at" className="input w-40" aria-label="Prazo" />
                    <button type="submit" className="btn-secondary" aria-label="Adicionar tarefa"><Plus className="h-4 w-4" /></button>
                  </form>
                )}
              </section>

              <div className="border-t-8 border-[var(--wa-panel)] px-6 py-4">
                <Link href={`/contatos/${contact.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--wa-green)" }}>
                  Abrir ficha completa <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
