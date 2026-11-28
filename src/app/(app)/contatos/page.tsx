import Link from "next/link";
import { Filter, Plus, Search, UserPlus, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { can, getTenantContext } from "@/server/context";
import { listDepartments } from "@/server/data/departments";
import { listContacts } from "@/server/data/contacts";
import { listStages } from "@/server/data/stages";
import { listTags } from "@/server/data/tags";
import { contactListQuerySchema } from "@/server/validation";
import { ActionForm } from "@/components/action-form";
import { TagBadge } from "@/components/tag-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { brl, dateTime, phoneFmt } from "@/components/format";
import { createContactAction } from "../actions";
import { listContactFields } from "@/server/data/contact-fields";
import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { displayName } from "@/shared/contact-name";
import { ScheduleButtons } from "@/components/schedule-dialog";

export const metadata = { title: "Contatos" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export default async function ContatosPage({ searchParams }: PageProps<"/contatos">) {
  const ctx = await getTenantContext();
  if (!can(ctx, "contatos.ver")) redirect(can(ctx, "whatsapp.ver") ? "/whatsapp" : "/dashboard");
  const canEdit = can(ctx, "contatos.editar");
  const canSchedule = can(ctx, "whatsapp.enviar");
  const allSectors = can(ctx, "setores.todos");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const parsed = contactListQuerySchema.safeParse({ q: str(sp.q), stage_id: str(sp.etapa), tag_id: str(sp.tag), department_id: str(sp.setor) });
  const filters = parsed.success ? parsed.data : { limit: 50, offset: 0 };
  const [{ items, total }, stages, tags, allDepartments, fields] = await Promise.all([
    listContacts(ctx, filters),
    listStages(ctx),
    listTags(ctx),
    listDepartments(ctx),
    listContactFields(ctx),
  ]);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const deptById = new Map(allDepartments.map((d) => [d.id, d]));
  // Setores em que a pessoa pode criar/mover contatos
  const myDepartments = allSectors ? allDepartments : allDepartments.filter((d) => ctx.departmentIds.includes(d.id));

  return (
    <div className="space-y-6">
      <PageHeader icon={Users} title="Contatos" subtitle={`${total} contato${total === 1 ? "" : "s"} na sua base`} />

      {canEdit && (
      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-accent-strong marker:hidden">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-accent transition group-open:rotate-45">
            <Plus className="h-4 w-4" />
          </span>
          Novo contato
        </summary>
        <ActionForm
          action={createContactAction}
          className="mt-5 grid gap-3 md:grid-cols-3"
          submitLabel="Criar contato"
          submitIcon={<UserPlus className="h-4 w-4" />}
          submitClassName="btn-primary md:col-start-3"
        >
          <label><span className="label">Nome *</span><input name="name" required placeholder="Nome completo" className="input" /></label>
          <label><span className="label">WhatsApp</span><input name="phone" placeholder="55 11 98888-7777" className="input" /></label>
          <label><span className="label">E-mail</span><input name="email" type="email" placeholder="email@exemplo.com" className="input" /></label>
          <label><span className="label">Empresa</span><input name="company" placeholder="Empresa" className="input" /></label>
          <label><span className="label">Origem</span><input name="source" placeholder="Instagram, indicação…" className="input" /></label>
          <label><span className="label">Valor (R$)</span><input name="value" inputMode="decimal" placeholder="0,00" className="input" /></label>
          <label><span className="label">Etapa inicial</span>
            <select name="stage_id" className="input" defaultValue="">
              <option value="">Primeira etapa do funil</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {allDepartments.length > 0 && (
            <label><span className="label">Setor</span>
              <select name="department_id" className="input" defaultValue={allSectors ? "" : (myDepartments[0]?.id ?? "")}>
                {(allSectors || myDepartments.length === 0) && <option value="">Sem setor</option>}
                {myDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <label className="md:col-span-2"><span className="label">Tags (Ctrl+clique para várias)</span>
            <select name="tag_ids[]" multiple className="input" size={Math.min(4, Math.max(2, tags.length))}>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {fields.length > 0 && <CustomFieldInputs fields={fields} className="contents" />}
          <label className="md:col-span-3"><span className="label">Observações</span><textarea name="notes" rows={2} className="input" /></label>
        </ActionForm>
      </details>
      )}

      <form className="flex flex-wrap items-center gap-2">
        <span className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input name="q" defaultValue={str(sp.q) ?? ""} placeholder="Buscar por nome, e-mail, telefone ou empresa" className="input pl-10" />
        </span>
        <select name="etapa" defaultValue={str(sp.etapa) ?? ""} className="input w-auto min-w-44">
          <option value="">Todas as etapas</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="tag" defaultValue={str(sp.tag) ?? ""} className="input w-auto min-w-40">
          <option value="">Todas as tags</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {allDepartments.length > 1 && (
          <select name="setor" defaultValue={str(sp.setor) ?? ""} className="input w-auto min-w-40">
            <option value="">Todos os setores</option>
            {allDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <button className="btn-secondary"><Filter className="h-4 w-4" /> Filtrar</button>
      </form>

      <div className="card overflow-hidden p-0">
        {items.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum contato encontrado" hint="Cadastre o primeiro contato acima ou ajuste os filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-5 py-3">Contato</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Etapa</th>
                  {allDepartments.length > 0 && <th className="px-5 py-3">Setor</th>}
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3 text-right">Valor</th>
                  <th className="px-5 py-3">Última interação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((c) => {
                  const st = c.stage_id ? stageById.get(c.stage_id) : undefined;
                  return (
                    <tr key={c.id} className="transition hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                        <Link href={`/contatos/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong text-xs font-semibold">
                            {initials(displayName(c))}
                          </span>
                          <span>
                            <span className="block font-medium text-fg hover:text-accent-strong">{displayName(c)}</span>
                            {c.company && <span className="block text-xs text-muted">{c.company}</span>}
                          </span>
                        </Link>
                        {canSchedule && c.phone && <ScheduleButtons contactId={c.id} name={displayName(c)} compact />}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{phoneFmt(c.phone)}</td>
                      <td className="px-5 py-3">
                        {st && (
                          <span className="chip">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} />
                            {st.name}
                          </span>
                        )}
                      </td>
                      {allDepartments.length > 0 && (
                        <td className="whitespace-nowrap px-5 py-3 text-muted">
                          {c.department_id && deptById.get(c.department_id) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: deptById.get(c.department_id)!.color }} />
                              {deptById.get(c.department_id)!.name}
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-3"><div className="flex flex-wrap gap-1">{c.tags?.map((t) => <TagBadge key={t.id} {...t} />)}</div></td>
                      <td className="px-5 py-3 text-right tabular-nums">{brl(c.value_cents)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{dateTime(c.last_interaction_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
