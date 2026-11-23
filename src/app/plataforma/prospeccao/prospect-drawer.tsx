"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Briefcase,
  CalendarClock,
  ExternalLink,
  History,
  Mail,
  MapPin,
  MessageSquarePlus,
  Phone,
  Save,
  StickyNote,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { brl, dateTime, phoneFmt, toLocalInput } from "@/components/format";
import { ACTIVITY_LABEL, ACTIVITY_TYPES, instagramUrl, PROSPECT_STATUS, STATUS_LABEL, type ProspectStatus } from "@/shared/prospects";
import { deleteProspectAction, logContactAction, updateProspectAction } from "./actions";
import { ContactButtons, FollowupPicker, StatusBadge } from "./bits";
import { WhatsappDialog, type QuickReplyOpt } from "./whatsapp-dialog";

export interface DrawerProspect {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  niche: string | null;
  area: string | null;
  instagram: string | null;
  source: string | null;
  status: string;
  value_cents: number;
  notes: string | null;
  next_followup_at: string | null;
  created_at: string;
  activities: { id: string; type: string; body: string; created_at: string }[];
}

const ICON = { whatsapp: MessageSquarePlus, ligacao: Phone, email: Mail, reuniao: Users, nota: StickyNote, status: History } as const;

/**
 * Ficha da lead em painel lateral, por cima da lista (sem trocar de página).
 * Abre com ?lead=<id> na URL; fechar volta para a lista com os mesmos filtros.
 */
export function ProspectDrawer({
  prospect: x,
  closeHref,
  wa,
}: {
  prospect: DrawerProspect;
  closeHref: string;
  wa: { connected: boolean | null; quickReplies: QuickReplyOpt[] };
}) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.replace(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  const statusText = (body: string) => body.split("→").map((s) => STATUS_LABEL[s as ProspectStatus] ?? s).join(" → ");
  const label = "mb-1 block text-xs font-medium text-muted";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Lead ${x.name}`}>
      <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" aria-label="Fechar" onClick={close} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-line bg-surface shadow-2xl animate-[slidein_.18s_ease-out]">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{x.name}</h2>
            <p className="truncate text-sm text-muted">{[x.company, x.city].filter(Boolean).join(" · ") || "—"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <StatusBadge status={x.status} />
              {x.area && <span className="chip gap-1"><Briefcase className="h-3 w-3" /> {x.area}</span>}
              {x.niche && <span className="chip">{x.niche}</span>}
              {x.instagram && (
                <a href={instagramUrl(x.instagram)} target="_blank" rel="noopener noreferrer" className="chip gap-1 text-accent-strong hover:underline">
                  <AtSign className="h-3 w-3" />{x.instagram}
                </a>
              )}
              {x.next_followup_at && <span className="chip gap-1"><CalendarClock className="h-3 w-3" /> {dateTime(x.next_followup_at)}</span>}
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={close}><X className="h-5 w-5" /></button>
        </header>

        <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
          <WhatsappDialog id={x.id} name={x.name} phone={x.phone} quickReplies={wa.quickReplies} connected={wa.connected} variant="button" />
          <ContactButtons phone={x.phone} name={x.name} />
          {x.phone && <span className="text-sm text-muted">{phoneFmt(x.phone)}</span>}
          <Link href={`/plataforma/prospeccao/${x.id}`} className="btn-ghost btn-sm ml-auto"><ExternalLink className="h-3.5 w-3.5" /> Página</Link>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="section-title text-sm"><MessageSquarePlus className="h-4 w-4 text-accent" /> Registrar contato / follow-up</h3>
            <ActionForm action={logContactAction} resetOnSuccess className="mt-3 space-y-3" submitLabel="Registrar" submitClassName="btn-primary btn-sm">
              <input type="hidden" name="id" value={x.id} />
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((t, i) => (
                  <label key={t} className="cursor-pointer">
                    <input type="radio" name="type" value={t} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="chip peer-checked:border-brand-500 peer-checked:bg-brand-500/10 peer-checked:text-accent-strong">{ACTIVITY_LABEL[t]}</span>
                  </label>
                ))}
              </div>
              <textarea name="body" rows={2} maxLength={5000} placeholder="O que foi conversado? Próximos passos…" className="input" aria-label="Resumo do contato" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className={label}>Próximo follow-up</span><FollowupPicker /></div>
                <label className="block"><span className={label}>Mudar etapa (opcional)</span>
                  <select name="status" defaultValue="" className="input py-1.5 text-sm">
                    <option value="">Manter: {STATUS_LABEL[x.status as ProspectStatus] ?? x.status}</option>
                    {PROSPECT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
              </div>
            </ActionForm>
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="section-title text-sm">Dados da lead</h3>
            <ActionForm action={updateProspectAction} className="mt-3 space-y-3" submitLabel="Salvar" submitIcon={<Save className="h-4 w-4" />} submitClassName="btn-primary w-full">
              <input type="hidden" name="id" value={x.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className={label}>Nome</span><input name="name" required maxLength={200} defaultValue={x.name} className="input" /></label>
                <label className="block"><span className={label}>Empresa / escritório</span><input name="company" maxLength={200} defaultValue={x.company ?? ""} className="input" /></label>
                <label className="block"><span className={label}>Área de atuação</span><input name="area" maxLength={120} defaultValue={x.area ?? ""} placeholder="Ex.: Trabalhista, Previdenciário" className="input" /></label>
                <label className="block"><span className={label}>WhatsApp</span><input name="phone" defaultValue={x.phone ?? ""} className="input" /></label>
                <label className="block"><span className={label}>Instagram</span>
                  <span className="relative block">
                    <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                    <input name="instagram" defaultValue={x.instagram ?? ""} placeholder="usuario ou link do perfil" className="input pl-9" />
                  </span>
                </label>
                <label className="block"><span className={label}>E-mail</span><input name="email" type="email" defaultValue={x.email ?? ""} className="input" /></label>
                <label className="block"><span className={label}>Cidade</span>
                  <span className="relative block">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                    <input name="city" maxLength={120} defaultValue={x.city ?? ""} className="input pl-9" />
                  </span>
                </label>
                <label className="block"><span className={label}>Nicho</span><input name="niche" maxLength={120} defaultValue={x.niche ?? ""} placeholder="Ex.: Advocacia" className="input" /></label>
                <label className="block"><span className={label}>Origem</span><input name="source" maxLength={120} defaultValue={x.source ?? ""} className="input" /></label>
                <label className="block"><span className={label}>Valor (R$/mês)</span><input name="value" inputMode="decimal" defaultValue={(Number(x.value_cents) / 100).toFixed(2).replace(".", ",")} className="input" /></label>
                <label className="block"><span className={label}>Etapa</span>
                  <select name="status" defaultValue={x.status} className="input">
                    {PROSPECT_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="block sm:col-span-2"><span className={label}>Próximo follow-up</span><input type="datetime-local" name="followup_at" defaultValue={toLocalInput(x.next_followup_at)} className="input" /></label>
                <label className="block sm:col-span-2"><span className={label}>Observações</span><textarea name="notes" rows={3} maxLength={10000} defaultValue={x.notes ?? ""} className="input" /></label>
              </div>
              {Number(x.value_cents) > 0 && <p className="text-xs text-muted">Valor atual: {brl(Number(x.value_cents))}</p>}
            </ActionForm>
          </section>

          <section className="border-t border-line pt-5">
            <h3 className="section-title text-sm"><History className="h-4 w-4 text-accent" /> Histórico</h3>
            <ol className="mt-3 space-y-2.5">
              {x.activities.map((a) => {
                const Icon = ICON[a.type as keyof typeof ICON] ?? StickyNote;
                return (
                  <li key={a.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-accent"><Icon className="h-3.5 w-3.5" /></span>
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

          <details className="border-t border-line pt-4">
            <summary className="btn-ghost btn-sm cursor-pointer list-none text-danger"><Trash2 className="h-3.5 w-3.5" /> Excluir lead</summary>
            <ActionForm action={deleteProspectAction} className="mt-2" submitLabel="Confirmar exclusão" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-danger btn-sm w-full">
              <input type="hidden" name="id" value={x.id} />
              <p className="mb-2 text-xs text-muted">Apaga a lead e todo o histórico de contatos.</p>
            </ActionForm>
          </details>
        </div>
      </aside>
    </div>
  );
}
