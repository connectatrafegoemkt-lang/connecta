import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Check,
  History,
  ListTodo,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  Plus,
  RotateCcw,
  Save,
  StickyNote,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { getTenantContext } from "@/server/context";
import { HttpError } from "@/server/errors";
import { getContact } from "@/server/data/contacts";
import { listInteractions } from "@/server/data/interactions";
import { listTasks } from "@/server/data/tasks";
import { listStages } from "@/server/data/stages";
import { listTags } from "@/server/data/tags";
import { listMembers } from "@/server/data/members";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { brl, dateTime, interactionLabel, phoneFmt } from "@/components/format";
import {
  createInteractionAction,
  createTaskAction,
  deleteContactAction,
  deleteInteractionAction,
  setTaskStatusAction,
  updateContactAction,
} from "../../actions";
import { LiveTimeline } from "./live-timeline";

const TYPE_ICON: Record<string, LucideIcon> = {
  nota: StickyNote,
  ligacao: PhoneCall,
  email: Mail,
  reuniao: Users,
  whatsapp: MessageCircle,
};

export default async function ContatoPage({ params }: PageProps<"/contatos/[id]">) {
  const { id } = await params;
  const ctx = await getTenantContext();
  let contact;
  try {
    contact = await getContact(ctx, id);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const [interactions, tasks, stages, tags, members] = await Promise.all([
    listInteractions(ctx, id),
    listTasks(ctx, { contact_id: id }),
    listStages(ctx),
    listTags(ctx),
    listMembers(ctx),
  ]);
  const tagSet = new Set(contact.tags?.map((t) => t.id));
  const memberName = new Map(members.map((m) => [m.user_id, m.display_name ?? "Usuário"]));
  const stage = stages.find((s) => s.id === contact.stage_id);
  const initials = contact.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

  return (
    <div className="space-y-6">
      <Link href="/contatos" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Contatos
      </Link>

      <div className="card flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-accent-soft via-surface to-surface">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-lg font-semibold text-white shadow-[0_8px_24px_-8px_rgb(161_0_255/0.8)]">
            {initials}
          </span>
          <div>
            <h1 className="page-title">{contact.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              {contact.phone && <span className="chip"><Phone className="h-3 w-3" /> {phoneFmt(contact.phone)}</span>}
              {contact.email && <span className="chip"><Mail className="h-3 w-3" /> {contact.email}</span>}
              {contact.company && <span className="chip"><Building2 className="h-3 w-3" /> {contact.company}</span>}
              {stage && (
                <span className="chip">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} /> {stage.name}
                </span>
              )}
              {contact.value_cents > 0 && <span className="chip text-fg">{brl(contact.value_cents)}</span>}
            </div>
          </div>
        </div>
        {contact.phone && (
          <Link href={`/whatsapp?contato=${contact.id}`} className="btn-primary">
            <MessageCircle className="h-4 w-4" /> Conversar no WhatsApp
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card h-fit lg:col-span-1">
          <h2 className="section-title">Dados do contato</h2>
          <ActionForm action={updateContactAction} className="mt-4 space-y-3" submitLabel="Salvar alterações" submitIcon={<Save className="h-4 w-4" />} submitClassName="btn-primary w-full">
            <input type="hidden" name="id" value={contact.id} />
            <input type="hidden" name="tags_present" value="1" />
            <label className="block"><span className="label">Nome</span><input name="name" defaultValue={contact.name} required className="input" /></label>
            <label className="block"><span className="label">Telefone (WhatsApp)</span><input name="phone" defaultValue={contact.phone ?? ""} className="input" /></label>
            <label className="block"><span className="label">E-mail</span><input name="email" type="email" defaultValue={contact.email ?? ""} className="input" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Empresa</span><input name="company" defaultValue={contact.company ?? ""} className="input" /></label>
              <label className="block"><span className="label">Origem</span><input name="source" defaultValue={contact.source ?? ""} className="input" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Valor (R$)</span>
                <input name="value" inputMode="decimal" defaultValue={(contact.value_cents / 100).toFixed(2).replace(".", ",")} className="input" />
              </label>
              <label className="block"><span className="label">Etapa</span>
                <select name="stage_id" defaultValue={contact.stage_id ?? ""} className="input">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="label">Tags</legend>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <label key={t.id} className="cursor-pointer">
                    <input type="checkbox" name="tag_ids[]" value={t.id} defaultChecked={tagSet.has(t.id)} className="peer sr-only" />
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-muted transition peer-checked:border-current peer-checked:text-[var(--tag)] peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40"
                      style={{ ["--tag" as string]: `color-mix(in oklab, ${t.color} 72%, var(--tag-mix))` }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </span>
                  </label>
                ))}
                {tags.length === 0 && <span className="text-xs text-subtle">Crie tags em Configurações.</span>}
              </div>
            </fieldset>
            <label className="block"><span className="label">Observações</span><textarea name="notes" defaultValue={contact.notes ?? ""} rows={3} className="input" /></label>
          </ActionForm>
          <form action={deleteContactAction} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="id" value={contact.id} />
            <button className="btn-danger w-full"><Trash2 className="h-4 w-4" /> Excluir contato</button>
          </form>
        </section>

        <section className="space-y-6 lg:col-span-2">
          <div className="card">
            <h2 className="section-title"><Plus className="h-4 w-4 text-accent" /> Registrar interação</h2>
            <ActionForm action={createInteractionAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-3" submitLabel="Registrar" submitClassName="btn-primary md:col-start-3">
              <input type="hidden" name="contact_id" value={contact.id} />
              <label><span className="label">Tipo</span>
                <select name="type" className="input" defaultValue="nota">
                  <option value="nota">Nota</option>
                  <option value="ligacao">Ligação</option>
                  <option value="email">E-mail</option>
                  <option value="reuniao">Reunião</option>
                </select>
              </label>
              <label><span className="label">Direção</span>
                <select name="direction" className="input" defaultValue="interna">
                  <option value="interna">Interna</option>
                  <option value="saida">Saída (nós → cliente)</option>
                  <option value="entrada">Entrada (cliente → nós)</option>
                </select>
              </label>
              <label><span className="label">Quando</span><input type="datetime-local" name="occurred_at" className="input" /></label>
              <textarea name="body" required rows={2} placeholder="O que aconteceu?" className="input md:col-span-3" />
            </ActionForm>
          </div>

          <div className="card">
            <h2 className="section-title"><History className="h-4 w-4 text-accent" /> Histórico</h2>
            <LiveTimeline contactId={contact.id} />
            {interactions.length === 0 ? (
              <EmptyState icon={History} title="Nenhuma interação registrada" />
            ) : (
              <ol className="relative mt-5 space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
                {interactions.map((i) => {
                  const Icon = TYPE_ICON[i.type] ?? StickyNote;
                  return (
                    <li key={i.id} className="relative flex gap-4">
                      <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${i.type === "whatsapp" ? "border-success/40 bg-success/10 text-success" : "border-brand-500/40 bg-surface-2 text-accent"}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2/50 px-4 py-3">
                        <p className="flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                          <span className="font-medium text-muted">{interactionLabel[i.type]}</span>
                          {i.direction !== "interna" && <span>· {i.direction === "entrada" ? "recebida" : "enviada"}</span>}
                          <span>· {dateTime(i.occurred_at)}</span>
                          {i.created_by && memberName.get(i.created_by) && <span>· {memberName.get(i.created_by)}</span>}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{i.body}</p>
                      </div>
                      {i.type !== "whatsapp" && (
                        <form action={deleteInteractionAction} className="absolute right-2 top-2">
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="contact_id" value={contact.id} />
                          <button className="icon-btn h-7 w-7" title="Excluir" aria-label="Excluir interação"><X className="h-3.5 w-3.5" /></button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="card">
            <h2 className="section-title"><ListTodo className="h-4 w-4 text-accent" /> Tarefas</h2>
            {tasks.length > 0 && (
              <ul className="mt-3 divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className={t.status === "concluida" ? "text-subtle line-through" : ""}>
                      {t.title}
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-subtle"><CalendarClock className="h-3 w-3" />{dateTime(t.due_at)}</span>
                    </span>
                    <form action={setTaskStatusAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value={t.status === "concluida" ? "pendente" : "concluida"} />
                      <button className="btn-secondary btn-sm">
                        {t.status === "concluida" ? <><RotateCcw className="h-3.5 w-3.5" /> Reabrir</> : <><Check className="h-3.5 w-3.5" /> Concluir</>}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={createTaskAction} resetOnSuccess className="mt-4 grid gap-2 md:grid-cols-4" submitLabel="Adicionar tarefa" submitIcon={<Plus className="h-4 w-4" />} submitClassName="btn-secondary md:col-start-4">
              <input type="hidden" name="contact_id" value={contact.id} />
              <input name="title" required placeholder="Nova tarefa" className="input md:col-span-2" />
              <input type="datetime-local" name="due_at" className="input" title="Prazo" aria-label="Prazo" />
              <input type="datetime-local" name="remind_at" className="input" title="Lembrete" aria-label="Lembrete" />
            </ActionForm>
          </div>
        </section>
      </div>
    </div>
  );
}
