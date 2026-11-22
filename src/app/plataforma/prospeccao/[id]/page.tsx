import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, History, Mail, MessageSquarePlus, Phone, Save, StickyNote, Trash2, Users } from "lucide-react";
import { getPlatformContext } from "@/server/platform";
import { getProspect } from "@/server/prospects";
import { HttpError } from "@/server/errors";
import { idSchema } from "@/server/validation";
import { ActionForm } from "@/components/action-form";
import { brl, dateTime, phoneFmt, toLocalInput } from "@/components/format";
import { ACTIVITY_LABEL, ACTIVITY_TYPES, PROSPECT_STATUS, STATUS_LABEL, type ProspectStatus } from "@/shared/prospects";
import { deleteProspectAction, logContactAction, updateProspectAction } from "../actions";
import { ContactButtons, FollowupPicker, StatusBadge } from "../bits";

export const metadata = { title: "Lead da prospecção" };

const ICON = { whatsapp: MessageSquarePlus, ligacao: Phone, email: Mail, reuniao: Users, nota: StickyNote, status: History } as const;

export default async function ProspectPage({ params }: PageProps<"/plataforma/prospeccao/[id]">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const p = await getPlatformContext();
  let x;
  try {
    x = await getProspect(p, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const statusText = (body: string) =>
    body.split("→").map((s) => STATUS_LABEL[s as ProspectStatus] ?? s).join(" → ");

  return (
    <div className="space-y-6">
      <Link href="/plataforma/prospeccao" className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Prospecção</Link>

      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{x.name}</h1>
          <p className="text-sm text-muted">{[x.company, x.city, x.niche].filter(Boolean).join(" · ") || "—"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={x.status} />
            {x.phone && <span className="chip">{phoneFmt(x.phone)}</span>}
            {Number(x.value_cents) > 0 && <span className="chip">{brl(Number(x.value_cents))}</span>}
            {x.next_followup_at && <span className="chip"><CalendarClock className="h-3 w-3" /> Follow-up {dateTime(x.next_followup_at)}</span>}
          </div>
        </div>
        <ContactButtons phone={x.phone} name={x.name} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card h-fit lg:col-span-1">
          <h2 className="section-title">Dados da lead</h2>
          <ActionForm action={updateProspectAction} className="mt-4 space-y-3" submitLabel="Salvar" submitIcon={<Save className="h-4 w-4" />} submitClassName="btn-primary w-full">
            <input type="hidden" name="id" value={x.id} />
            <label className="block"><span className="label">Nome</span><input name="name" required maxLength={200} defaultValue={x.name} className="input" /></label>
            <label className="block"><span className="label">Empresa</span><input name="company" maxLength={200} defaultValue={x.company ?? ""} className="input" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">WhatsApp</span><input name="phone" defaultValue={x.phone ?? ""} className="input" /></label>
              <label className="block"><span className="label">E-mail</span><input name="email" type="email" defaultValue={x.email ?? ""} className="input" /></label>
              <label className="block"><span className="label">Cidade</span><input name="city" maxLength={120} defaultValue={x.city ?? ""} className="input" /></label>
              <label className="block"><span className="label">Nicho</span><input name="niche" maxLength={120} defaultValue={x.niche ?? ""} className="input" /></label>
              <label className="block"><span className="label">Origem</span><input name="source" maxLength={120} defaultValue={x.source ?? ""} className="input" /></label>
              <label className="block"><span className="label">Valor (R$/mês)</span><input name="value" inputMode="decimal" defaultValue={(Number(x.value_cents) / 100).toFixed(2).replace(".", ",")} className="input" /></label>
            </div>
            <label className="block"><span className="label">Etapa</span>
              <select name="status" defaultValue={x.status} className="input">
                {PROSPECT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Próximo follow-up</span><input type="datetime-local" name="followup_at" defaultValue={toLocalInput(x.next_followup_at)} className="input" /></label>
            <label className="block"><span className="label">Observações</span><textarea name="notes" rows={4} maxLength={10000} defaultValue={x.notes ?? ""} className="input" /></label>
          </ActionForm>
          <details className="mt-4 border-t border-line pt-4">
            <summary className="btn-ghost btn-sm cursor-pointer list-none text-danger"><Trash2 className="h-3.5 w-3.5" /> Excluir lead</summary>
            <ActionForm action={deleteProspectAction} className="mt-2" submitLabel="Confirmar exclusão" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-danger btn-sm w-full">
              <input type="hidden" name="id" value={x.id} />
              <p className="mb-2 text-xs text-muted">Apaga a lead e todo o histórico de contatos.</p>
            </ActionForm>
          </details>
        </section>

        <div className="space-y-6 lg:col-span-2">
          <section className="card">
            <h2 className="section-title"><MessageSquarePlus className="h-4 w-4 text-accent" /> Registrar contato / follow-up</h2>
            <ActionForm action={logContactAction} resetOnSuccess className="mt-4 space-y-3" submitLabel="Registrar" submitClassName="btn-primary">
              <input type="hidden" name="id" value={x.id} />
              <div className="flex flex-wrap gap-2">
                {ACTIVITY_TYPES.map((t, i) => (
                  <label key={t} className="cursor-pointer">
                    <input type="radio" name="type" value={t} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="chip peer-checked:border-brand-500 peer-checked:bg-brand-500/10 peer-checked:text-accent-strong">{ACTIVITY_LABEL[t]}</span>
                  </label>
                ))}
              </div>
              <textarea name="body" rows={3} maxLength={5000} placeholder="O que foi conversado? Próximos passos…" className="input" aria-label="Resumo do contato" />
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <span className="label">Próximo follow-up</span>
                  <FollowupPicker />
                </div>
                <label className="block"><span className="label">Mudar etapa (opcional)</span>
                  <select name="status" defaultValue="" className="input py-1.5 text-sm">
                    <option value="">Manter: {STATUS_LABEL[x.status as ProspectStatus] ?? x.status}</option>
                    {PROSPECT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
              </div>
            </ActionForm>
          </section>

          <section className="card">
            <h2 className="section-title"><History className="h-4 w-4 text-accent" /> Histórico</h2>
            <ol className="mt-4 space-y-3">
              {x.activities.map((a) => {
                const Icon = ICON[a.type as keyof typeof ICON] ?? StickyNote;
                return (
                  <li key={a.id} className="flex gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-accent"><Icon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2">
                      <p className="text-xs text-subtle">{ACTIVITY_LABEL[a.type as keyof typeof ACTIVITY_LABEL] ?? a.type} · {dateTime(a.created_at)}</p>
                      <p className="whitespace-pre-wrap text-sm">{a.type === "status" ? statusText(a.body) : a.body || <span className="text-subtle">(sem anotação)</span>}</p>
                    </div>
                  </li>
                );
              })}
              {x.activities.length === 0 && <li className="text-sm text-subtle">Nenhum contato registrado ainda.</li>}
              <li className="text-xs text-subtle">Cadastrada em {dateTime(x.created_at)}{x.source ? ` · origem: ${x.source}` : ""}</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
