import Link from "next/link";
import { getTenantContext } from "@/server/context";
import { listContacts } from "@/server/data/contacts";
import { listStages } from "@/server/data/stages";
import { listTags } from "@/server/data/tags";
import { contactListQuerySchema } from "@/server/validation";
import { ActionForm } from "@/components/action-form";
import { TagBadge } from "@/components/tag-badge";
import { brl, dateTime, phoneFmt } from "@/components/format";
import { createContactAction } from "../actions";

export const metadata = { title: "Contatos — CONNECTA CRM" };

export default async function ContatosPage({ searchParams }: PageProps<"/contatos">) {
  const ctx = await getTenantContext();
  const sp = await searchParams;
  const parsed = contactListQuerySchema.safeParse({
    q: typeof sp.q === "string" && sp.q ? sp.q : undefined,
    stage_id: typeof sp.etapa === "string" && sp.etapa ? sp.etapa : undefined,
    tag_id: typeof sp.tag === "string" && sp.tag ? sp.tag : undefined,
  });
  const filters = parsed.success ? parsed.data : { limit: 50, offset: 0 };
  const [{ items, total }, stages, tags] = await Promise.all([
    listContacts(ctx, filters),
    listStages(ctx),
    listTags(ctx),
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Contatos <span className="text-base font-normal text-slate-400">({total})</span></h1>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-medium text-sky-700">+ Novo contato</summary>
        <ActionForm action={createContactAction} className="mt-4 grid gap-3 md:grid-cols-3" submitLabel="Criar contato">
          <input name="name" required placeholder="Nome *" className="input" />
          <input name="phone" placeholder="WhatsApp (ex.: 5511988887777)" className="input" />
          <input name="email" type="email" placeholder="E-mail" className="input" />
          <input name="company" placeholder="Empresa" className="input" />
          <input name="source" placeholder="Origem (ex.: Instagram)" className="input" />
          <input name="value" inputMode="decimal" placeholder="Valor (R$)" className="input" />
          <select name="stage_id" className="input" defaultValue="">
            <option value="">Etapa inicial (padrão)</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select name="tag_ids[]" multiple className="input md:col-span-2" size={Math.min(4, Math.max(2, tags.length))}>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <textarea name="notes" placeholder="Observações" className="input md:col-span-3" rows={2} />
        </ActionForm>
      </details>

      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={typeof sp.q === "string" ? sp.q : ""} placeholder="Buscar por nome, e-mail, telefone…" className="input max-w-xs" />
        <select name="etapa" defaultValue={typeof sp.etapa === "string" ? sp.etapa : ""} className="input max-w-[12rem]">
          <option value="">Todas as etapas</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select name="tag" defaultValue={typeof sp.tag === "string" ? sp.tag : ""} className="input max-w-[12rem]">
          <option value="">Todas as tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button className="btn-secondary">Filtrar</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Última interação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((c) => {
              const st = c.stage_id ? stageName.get(c.stage_id) : undefined;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/contatos/${c.id}`} className="font-medium text-sky-700 hover:underline">{c.name}</Link>
                    {c.company && <p className="text-xs text-slate-500">{c.company}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{phoneFmt(c.phone)}</td>
                  <td className="px-4 py-3">
                    {st && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} />{st.name}</span>}
                  </td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{c.tags?.map((t) => <TagBadge key={t.id} {...t} />)}</div></td>
                  <td className="px-4 py-3 text-right tabular-nums">{brl(c.value_cents)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{dateTime(c.last_interaction_at)}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Nenhum contato encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
