import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/server/context";
import { HttpError } from "@/server/errors";
import { getContact } from "@/server/data/contacts";
import { listInteractions } from "@/server/data/interactions";
import { listTasks } from "@/server/data/tasks";
import { listStages } from "@/server/data/stages";
import { listTags } from "@/server/data/tags";
import { listMembers } from "@/server/data/members";
import { ActionForm } from "@/components/action-form";
import { dateTime, interactionLabel, phoneFmt } from "@/components/format";
import {
  createInteractionAction,
  createTaskAction,
  deleteContactAction,
  deleteInteractionAction,
  setTaskStatusAction,
  updateContactAction,
} from "../../actions";
import { LiveTimeline } from "./live-timeline";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/contatos" className="text-sm text-slate-500 hover:underline">← Contatos</Link>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <p className="text-sm text-slate-500">{phoneFmt(contact.phone)} {contact.email && `· ${contact.email}`}</p>
        </div>
        {contact.phone && (
          <Link href={`/whatsapp?contato=${contact.id}`} className="btn-secondary">Conversar no WhatsApp</Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <h2 className="font-semibold">Dados</h2>
          <ActionForm action={updateContactAction} className="mt-4 space-y-3" submitLabel="Salvar">
            <input type="hidden" name="id" value={contact.id} />
            <input type="hidden" name="tags_present" value="1" />
            <label className="block text-sm">Nome<input name="name" defaultValue={contact.name} required className="input mt-1" /></label>
            <label className="block text-sm">Telefone (WhatsApp)<input name="phone" defaultValue={contact.phone ?? ""} className="input mt-1" /></label>
            <label className="block text-sm">E-mail<input name="email" type="email" defaultValue={contact.email ?? ""} className="input mt-1" /></label>
            <label className="block text-sm">Empresa<input name="company" defaultValue={contact.company ?? ""} className="input mt-1" /></label>
            <label className="block text-sm">Origem<input name="source" defaultValue={contact.source ?? ""} className="input mt-1" /></label>
            <label className="block text-sm">Valor (R$)
              <input name="value" inputMode="decimal" defaultValue={(contact.value_cents / 100).toFixed(2).replace(".", ",")} className="input mt-1" />
            </label>
            <label className="block text-sm">Etapa
              <select name="stage_id" defaultValue={contact.stage_id ?? ""} className="input mt-1">
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <fieldset className="text-sm">
              <legend>Tags</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <label key={t.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5">
                    <input type="checkbox" name="tag_ids[]" value={t.id} defaultChecked={tagSet.has(t.id)} />
                    <span style={{ color: t.color }}>{t.name}</span>
                  </label>
                ))}
                {tags.length === 0 && <span className="text-slate-400">Crie tags em Configurações.</span>}
              </div>
            </fieldset>
            <label className="block text-sm">Observações<textarea name="notes" defaultValue={contact.notes ?? ""} rows={3} className="input mt-1" /></label>
          </ActionForm>
          <form action={deleteContactAction} className="mt-4 border-t border-slate-100 pt-4">
            <input type="hidden" name="id" value={contact.id} />
            <button className="btn-danger">Excluir contato</button>
          </form>
        </section>

        <section className="space-y-6 lg:col-span-2">
          <div className="card">
            <h2 className="font-semibold">Registrar interação</h2>
            <ActionForm action={createInteractionAction} resetOnSuccess className="mt-3 grid gap-3 md:grid-cols-3" submitLabel="Registrar">
              <input type="hidden" name="contact_id" value={contact.id} />
              <select name="type" className="input" defaultValue="nota">
                <option value="nota">Nota</option>
                <option value="ligacao">Ligação</option>
                <option value="email">E-mail</option>
                <option value="reuniao">Reunião</option>
              </select>
              <select name="direction" className="input" defaultValue="interna">
                <option value="interna">Interna</option>
                <option value="saida">Saída (nós → cliente)</option>
                <option value="entrada">Entrada (cliente → nós)</option>
              </select>
              <input type="datetime-local" name="occurred_at" className="input" />
              <textarea name="body" required rows={2} placeholder="O que aconteceu?" className="input md:col-span-3" />
            </ActionForm>
          </div>

          <div className="card">
            <h2 className="font-semibold">Histórico</h2>
            <LiveTimeline contactId={contact.id} />
            <ol className="mt-4 space-y-4">
              {interactions.map((i) => (
                <li key={i.id} className="flex gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${i.type === "whatsapp" ? "bg-emerald-500" : "bg-sky-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">
                      {interactionLabel[i.type]}
                      {i.direction !== "interna" && ` · ${i.direction === "entrada" ? "recebida" : "enviada"}`}
                      {" · "}{dateTime(i.occurred_at)}
                      {i.created_by && ` · ${memberName.get(i.created_by) ?? ""}`}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">{i.body}</p>
                  </div>
                  {i.type !== "whatsapp" && (
                    <form action={deleteInteractionAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="contact_id" value={contact.id} />
                      <button className="text-xs text-slate-400 hover:text-red-600" title="Excluir">✕</button>
                    </form>
                  )}
                </li>
              ))}
              {interactions.length === 0 && <li className="text-sm text-slate-500">Nenhuma interação registrada.</li>}
            </ol>
          </div>

          <div className="card">
            <h2 className="font-semibold">Tarefas</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={t.status === "concluida" ? "text-slate-400 line-through" : ""}>
                    {t.title} <span className="text-slate-400">· {dateTime(t.due_at)}</span>
                  </span>
                  <form action={setTaskStatusAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="status" value={t.status === "concluida" ? "pendente" : "concluida"} />
                    <button className="btn-secondary py-1 text-xs">{t.status === "concluida" ? "Reabrir" : "Concluir"}</button>
                  </form>
                </li>
              ))}
            </ul>
            <ActionForm action={createTaskAction} resetOnSuccess className="mt-3 grid gap-2 md:grid-cols-4" submitLabel="Adicionar">
              <input type="hidden" name="contact_id" value={contact.id} />
              <input name="title" required placeholder="Nova tarefa" className="input md:col-span-2" />
              <input type="datetime-local" name="due_at" className="input" title="Prazo" />
              <input type="datetime-local" name="remind_at" className="input" title="Lembrete" />
            </ActionForm>
          </div>
        </section>
      </div>
    </div>
  );
}
