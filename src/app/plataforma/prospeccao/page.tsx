import Link from "next/link";
import { ArrowDownAZ, AtSign, Clock, FileSpreadsheet, RefreshCw, Trash2, AlarmClock, CalendarClock, ChevronRight, ClipboardPaste, HandCoins, Plus, Search, Target, Trophy, UserPlus } from "lucide-react";
import { getPlatformContext } from "@/server/platform";
import { getProspect, listProspects, listSheetSources, syncDueSheets } from "@/server/prospects";
import { idSchema } from "@/server/validation";
import { instagramUrl } from "@/shared/prospects";
import { ProspectDrawer } from "./prospect-drawer";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { brl, dateTime, phoneFmt } from "@/components/format";
import { isOpen, PROSPECT_STATUS, STATUS_LABEL } from "@/shared/prospects";
import { addSheetAction, createProspectAction, deleteSheetAction, importProspectsAction, syncSheetAction } from "./actions";
import { ContactButtons, FollowupPicker, StatusBadge } from "./bits";
import { WhatsappDialog } from "./whatsapp-dialog";
import { ScheduledList } from "@/components/scheduled-list";
import { cancelScheduledAction } from "@/app/(app)/actions";
import { ownWhatsappInfo } from "./whatsapp-info";

export const metadata = { title: "Prospecção" };

/** Relógio do servidor (a página é renderizada a cada acesso). */
const nowMs = () => Date.now();

const endOfTodaySP = () => {
  const d = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new Date(`${d}T23:59:59-03:00`).getTime();
};

export default async function ProspeccaoPage({ searchParams }: PageProps<"/plataforma/prospeccao">) {
  const p = await getPlatformContext();
  const sp = await searchParams;
  const etapa = typeof sp.etapa === "string" && (PROSPECT_STATUS as readonly string[]).includes(sp.etapa) ? sp.etapa : null;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 100) : "";
  const ordem = sp.ordem === "recentes" || sp.ordem === "az" ? sp.ordem : "followup";
  // Planilhas do Google Sheets: lê as que não foram lidas nos últimos 5 min
  // (com tempo máximo, para a página não ficar presa se o Google demorar).
  await Promise.race([syncDueSheets(p).catch(() => 0), new Promise((r) => setTimeout(r, 8000))]);
  const leadId = typeof sp.lead === "string" && idSchema.safeParse(sp.lead).success ? sp.lead : null;
  const [all, sheets, wa, opened] = await Promise.all([
    listProspects(p),
    listSheetSources(p),
    ownWhatsappInfo(),
    leadId ? getProspect(p, leadId).catch(() => null) : Promise.resolve(null),
  ]);

  const now = nowMs();
  // Agendadas: só as mensagens para leads da prospecção (pelo telefone) e
  // o nome clicável abre a ficha da lead.
  const byPhone = new Map(all.filter((x) => x.phone).map((x) => [x.phone!, x.id]));
  const scheduledAll = wa.scheduled ?? [];
  const scheduled = scheduledAll.filter((m) => m.contact_phone && byPhone.has(m.contact_phone));
  const eod = endOfTodaySP();
  const due = all
    .filter((x) => isOpen(x.status) && x.next_followup_at && new Date(x.next_followup_at).getTime() <= eod)
    .sort((a, b) => a.next_followup_at!.localeCompare(b.next_followup_at!));
  const digits = q.replace(/\D/g, "");
  const list = all
    .filter((x) => (etapa ? x.status === etapa : x.status !== "perdido" && x.status !== "ganho"))
    .filter((x) =>
      !q ||
      [x.name, x.company, x.city, x.niche, x.email].some((v) => v?.toLowerCase().includes(q)) ||
      (digits.length >= 3 && (x.phone ?? "").includes(digits)),
    )
    .sort((a, b) =>
      ordem === "az"
        ? a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })
        : ordem === "recentes"
          ? b.created_at.localeCompare(a.created_at)
          : (a.next_followup_at ?? "9999").localeCompare(b.next_followup_at ?? "9999"),
    );

  const monthStart = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const open = all.filter((x) => isOpen(x.status));
  const stats = [
    { icon: Target, label: "Leads em prospecção", value: open.length },
    { icon: AlarmClock, label: "Follow-ups para hoje", value: due.length, alert: due.length > 0 },
    { icon: HandCoins, label: "Em negociação", value: brl(open.reduce((s, x) => s + Number(x.value_cents), 0)) },
    { icon: Trophy, label: "Viraram cliente no mês", value: all.filter((x) => x.status === "ganho" && x.updated_at.slice(0, 7) >= monthStart).length },
  ];
  const counts = new Map<string, number>();
  for (const x of all) counts.set(x.status, (counts.get(x.status) ?? 0) + 1);
  const href = (e: string | null, lead?: string, o: string = ordem) => {
    const u = new URLSearchParams();
    if (e) u.set("etapa", e);
    if (q) u.set("q", q);
    if (o !== "followup") u.set("ordem", o);
    if (lead) u.set("lead", lead);
    const s = u.toString();
    return s ? `/plataforma/prospeccao?${s}` : "/plataforma/prospeccao";
  };
  const scheduledHref = new Map(
    scheduled.map((m) => [m.contact_id, href(etapa, byPhone.get(m.contact_phone!))] as const),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Target}
        title="Prospecção"
        subtitle="Leads ativas da CONNECTA: cadastre, contate e faça follow-up. Só a equipe CONNECTA vê esta área."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`card p-4 ${s.alert ? "border-warning/50 bg-warning/5" : ""}`}>
            <s.icon className={`h-5 w-5 ${s.alert ? "text-warning" : "text-accent"}`} />
            <p className="mt-3 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-xs text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <details className="card group" open={all.length === 0}>
          <summary className="section-title cursor-pointer list-none"><UserPlus className="h-4 w-4 text-accent" /> Nova lead</summary>
          <ActionForm action={createProspectAction} resetOnSuccess className="mt-4 grid gap-2 sm:grid-cols-2" submitLabel="Cadastrar" submitIcon={<Plus className="h-4 w-4" />} submitClassName="btn-primary sm:col-start-2 sm:justify-self-end">
            <input name="name" required maxLength={200} placeholder="Nome *" className="input" aria-label="Nome" />
            <input name="company" maxLength={200} placeholder="Empresa / escritório" className="input" aria-label="Empresa" />
            <input name="phone" placeholder="WhatsApp (55 41 99999-8888)" className="input" aria-label="WhatsApp" />
            <input name="email" type="email" placeholder="E-mail" className="input" aria-label="E-mail" />
            <input name="city" maxLength={120} placeholder="Cidade" className="input" aria-label="Cidade" />
            <input name="niche" maxLength={120} placeholder="Nicho (ex.: Advocacia)" className="input" aria-label="Nicho" />
            <input name="area" maxLength={120} placeholder="Área de atuação (ex.: Trabalhista)" className="input" aria-label="Área de atuação" />
            <input name="instagram" maxLength={200} placeholder="Instagram (@usuario ou link)" className="input" aria-label="Instagram" />
            <input name="source" maxLength={120} placeholder="Onde achou (Instagram, Google…)" className="input" aria-label="Origem" />
            <input name="value" inputMode="decimal" placeholder="Valor estimado (R$/mês)" className="input" aria-label="Valor estimado" />
            <div className="sm:col-span-2">
              <span className="label">Primeiro contato</span>
              <FollowupPicker defaultValue="amanha" />
            </div>
            <textarea name="notes" rows={2} maxLength={10000} placeholder="Observações" className="input sm:col-span-2" aria-label="Observações" />
          </ActionForm>
        </details>
        <details className="card group">
          <summary className="section-title cursor-pointer list-none"><ClipboardPaste className="h-4 w-4 text-accent" /> Importar lista</summary>
          <p className="mt-2 text-sm text-muted">
            Cole do Excel ou planilha, uma lead por linha: <span className="font-mono text-xs">nome; telefone; empresa; cidade; nicho; área; instagram</span>. Até 500 por vez.
          </p>
          <ActionForm action={importProspectsAction} resetOnSuccess className="mt-3 space-y-2" submitLabel="Importar" submitIcon={<ClipboardPaste className="h-4 w-4" />}>
            <textarea name="lista" required rows={6} placeholder={"Dra. Ana Souza; 41 99999-8888; Souza Advocacia; Curitiba; Trabalhista\nDr. João Lima; 11 98888-7777; Lima & Associados; São Paulo; Previdenciário"} className="input font-mono text-xs" aria-label="Lista de leads" />
            <input name="source" maxLength={120} placeholder="Origem da lista (ex.: OAB/PR, Google Maps)" className="input" aria-label="Origem da lista" />
          </ActionForm>
        </details>
      </div>

      <details className="card" open={sheets.length === 0}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
          <span className="section-title"><FileSpreadsheet className="h-4 w-4 text-success" /> Google Sheets</span>
          <span className="text-xs text-muted">
            {sheets.length === 0 ? "Conecte uma planilha para as leads entrarem sozinhas" : `${sheets.length} planilha(s) conectada(s) · lidas a cada 5 min ao abrir esta página`}
          </span>
        </summary>
        <ul className="mt-4 divide-y divide-line">
          {sheets.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <a href={`https://docs.google.com/spreadsheets/d/${s.sheet_id}/edit#gid=${s.gid}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {s.name}
                </a>
                <span className={`block text-xs ${s.last_ok === false ? "text-danger" : "text-muted"}`}>
                  {s.last_sync_at ? `Última leitura ${dateTime(s.last_sync_at)}: ${s.last_result ?? ""}` : "Ainda não lida"} · {s.imported} lead(s) importada(s) no total
                </span>
              </span>
              <ActionForm action={syncSheetAction} submitLabel="Sincronizar agora" submitIcon={<RefreshCw className="h-3.5 w-3.5" />} submitClassName="btn-secondary btn-sm">
                <input type="hidden" name="id" value={s.id} />
              </ActionForm>
              <ActionForm action={deleteSheetAction} submitLabel="Desconectar" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-ghost btn-sm hover:text-danger">
                <input type="hidden" name="id" value={s.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <ActionForm action={addSheetAction} resetOnSuccess className="space-y-2" submitLabel="Conectar planilha" submitIcon={<FileSpreadsheet className="h-4 w-4" />}>
            <input name="url" required placeholder="Link da planilha (https://docs.google.com/spreadsheets/d/...)" className="input" aria-label="Link da planilha" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input name="name" maxLength={120} placeholder="Nome (ex.: Leads OAB/PR)" className="input" aria-label="Nome da planilha" />
              <input name="source" maxLength={120} placeholder="Origem das leads (opcional)" className="input" aria-label="Origem" />
            </div>
          </ActionForm>
          <div className="rounded-xl bg-surface-2/60 p-3 text-xs text-muted">
            <p className="font-medium text-fg">Como preparar a planilha</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Primeira linha com os títulos: <strong>Nome</strong> (obrigatório), Telefone ou WhatsApp, Empresa, Cidade, Nicho, Área de atuação, Instagram, E-mail, Origem, Observações.</li>
              <li>Em <strong>Compartilhar</strong>, deixe “Qualquer pessoa com o link” como <strong>Leitor</strong>. Atenção: quem tiver o link consegue ver a planilha.</li>
              <li>Cole o link aqui. Para outra aba, abra a aba e copie o link (ele inclui o <span className="font-mono">gid</span>).</li>
            </ol>
            <p className="mt-1">
              Linhas novas viram leads. Se você preencher uma coluna depois (ex.: Instagram), a lead é completada na próxima leitura, sem apagar o
              que foi editado aqui. Lead excluída aqui não volta.
            </p>
          </div>
        </div>
      </details>

      {due.length > 0 && (
        <section className="card border-warning/40">
          <h2 className="section-title"><AlarmClock className="h-4 w-4 text-warning" /> Follow-ups de hoje e atrasados</h2>
          <ul className="mt-3 divide-y divide-line">
            {due.map((x) => {
              const late = new Date(x.next_followup_at!).getTime() < now - 3_600_000;
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <Link href={href(etapa, x.id)} scroll={false} className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium">{x.name}</span>
                    {x.company && <span className="text-muted"> · {x.company}</span>}
                  </Link>
                  <StatusBadge status={x.status} />
                  <span className={`flex items-center gap-1 text-xs ${late ? "font-medium text-danger" : "text-muted"}`}>
                    <CalendarClock className="h-3.5 w-3.5" /> {late ? "Atrasado · " : ""}{dateTime(x.next_followup_at)}
                  </span>
                  <WhatsappDialog id={x.id} name={x.name} phone={x.phone} quickReplies={wa.quickReplies} connected={wa.connected} />
                          <ContactButtons phone={x.phone} name={x.name} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {wa.connected !== null && (
        <details className="card" open={scheduled.length > 0 && scheduled.length <= 5}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="section-title"><CalendarClock className="h-4 w-4 text-accent" /> Mensagens agendadas</span>
            <span className="text-xs text-muted">{scheduled.length} esperando envio</span>
          </summary>
          <div className="mt-2">
            <ScheduledList
              items={scheduled}
              cancel={cancelScheduledAction}
              canCancel
              hrefs={Object.fromEntries(scheduledHref)}
              empty="Nenhuma mensagem agendada para as leads. Use o botão de WhatsApp da lead e escolha “Agendar”."
            />
          </div>
        </details>
      )}

      <section className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <div className="flex flex-wrap gap-1.5">
            <Link href={href(null)} className={`chip ${!etapa ? "border-brand-500 text-accent-strong" : ""}`}>Em andamento</Link>
            {PROSPECT_STATUS.map((s) => (
              <Link key={s} href={href(s)} className={`chip ${etapa === s ? "border-brand-500 text-accent-strong" : ""}`}>
                {STATUS_LABEL[s]} <span className="text-subtle">{counts.get(s) ?? 0}</span>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 text-xs" role="group" aria-label="Ordenar">
            {([
              ["followup", "Próximo follow-up"],
              ["recentes", "Mais recentes"],
              ["az", "A–Z"],
            ] as const).map(([k, l]) => (
              <Link
                key={k}
                href={href(etapa, undefined, k)}
                scroll={false}
                aria-current={ordem === k ? "true" : undefined}
                className={`flex items-center gap-1 rounded-md px-2 py-1 ${ordem === k ? "bg-brand-500/15 font-medium text-accent-strong" : "text-muted hover:text-fg"}`}
              >
                {k === "az" ? <ArrowDownAZ className="h-3.5 w-3.5" /> : k === "recentes" ? <Clock className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                {l}
              </Link>
            ))}
          </div>
          <form action="/plataforma/prospeccao" className="flex items-center gap-2">
            {etapa && <input type="hidden" name="etapa" value={etapa} />}
            {ordem !== "followup" && <input type="hidden" name="ordem" value={ordem} />}
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input name="q" defaultValue={q} placeholder="Buscar nome, empresa, cidade…" className="input py-1.5 pl-9 text-sm" aria-label="Buscar" />
            </label>
          </form>
          </div>
        </div>
        {list.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Target} title="Nenhuma lead aqui" hint="Cadastre uma lead ou importe uma lista para começar a prospectar." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-y border-line text-left text-xs uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Lead</th>
                  <th className="px-5 py-2.5 font-medium">Etapa</th>
                  <th className="px-5 py-2.5 font-medium">Próximo follow-up</th>
                  <th className="px-5 py-2.5 font-medium">Último contato</th>
                  <th className="px-5 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((x) => {
                  const late = isOpen(x.status) && x.next_followup_at && new Date(x.next_followup_at).getTime() < now;
                  return (
                    <tr key={x.id} className="relative cursor-pointer hover:bg-surface-2/40">
                      <td className="px-5 py-3">
                        {/* link "esticado": clicar em qualquer ponto da linha abre a ficha */}
                        <Link href={href(etapa, x.id)} scroll={false} className="block font-medium after:absolute after:inset-0 hover:underline" title="Abrir ficha da lead">{x.name}</Link>
                        <span className="block text-xs text-subtle">
                          {[x.company, x.area ?? x.niche, x.city].filter(Boolean).join(" · ") || phoneFmt(x.phone)}
                        </span>
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={x.status} /></td>
                      <td className={`whitespace-nowrap px-5 py-3 ${late ? "font-medium text-danger" : "text-muted"}`}>
                        {x.next_followup_at ? dateTime(x.next_followup_at) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">
                        {x.last_contact_at ? dateTime(x.last_contact_at) : "Nunca"}
                        {x.activities ? <span className="block text-xs text-subtle">{x.activities} contato(s)</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{Number(x.value_cents) ? brl(Number(x.value_cents)) : "—"}</td>
                      <td className="relative z-10 px-5 py-3">
                        <span className="flex items-center justify-end gap-1">
                          <WhatsappDialog id={x.id} name={x.name} phone={x.phone} quickReplies={wa.quickReplies} connected={wa.connected} />
                          <ContactButtons phone={x.phone} name={x.name} />
                          {x.instagram && (
                            <a href={instagramUrl(x.instagram)} target="_blank" rel="noopener noreferrer" className="icon-btn h-8 w-8" title={`@${x.instagram}`} aria-label={`Instagram de ${x.name}`}>
                              <AtSign className="h-4 w-4" />
                            </a>
                          )}
                          <Link href={href(etapa, x.id)} scroll={false} className="icon-btn h-8 w-8" aria-label={`Abrir ${x.name}`}><ChevronRight className="h-4 w-4" /></Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {opened && <ProspectDrawer key={opened.id} prospect={opened} closeHref={href(etapa)} wa={wa} />}
    </div>
  );
}
