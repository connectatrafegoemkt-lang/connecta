import Link from "next/link";
import { BarChart3, Ban, KeyRound, Trash2, Bot, Building2, CirclePlay, Contact, MessageCircle, Plus, ShieldCheck, Users } from "lucide-react";
import { getPlatformContext, listClientTenants } from "@/server/platform";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { dateTime } from "@/components/format";
import { currentMonth, monthLabel, shiftMonth } from "@/shared/months";
import { NICHE_KEYS, NICHES } from "@/shared/niches";
import { createClientTenantAction, deleteClientTenantAction, resetClientPasswordAction, setClientSuspendedAction } from "./actions";

const WA_LABEL: Record<string, { label: string; cls: string }> = {
  conectado: { label: "Conectado", cls: "text-success" },
  conectando: { label: "Conectando", cls: "text-warning" },
  aguardando_qr: { label: "Aguardando QR", cls: "text-warning" },
  erro: { label: "Erro", cls: "text-danger" },
  desconectado: { label: "Desconectado", cls: "text-subtle" },
};
const AI_LABEL: Record<string, string> = { desligado: "Desligada", sugerir: "Sugere", automatico: "Automática" };

const num = (n: number) => n.toLocaleString("pt-BR");

export default async function PlataformaPage() {
  const p = await getPlatformContext();
  const clients = await listClientTenants(p);
  const totals = clients.reduce(
    (acc, c) => ({
      users: acc.users + c.members,
      contacts: acc.contacts + c.contacts,
      wa: acc.wa + (c.whatsapp_status === "conectado" ? 1 : 0),
      ai: acc.ai + c.ai_messages_month,
      suspended: acc.suspended + (c.suspended_at ? 1 : 0),
    }),
    { users: 0, contacts: 0, wa: 0, ai: 0, suspended: 0 },
  );
  const stats = [
    { icon: Building2, label: totals.suspended ? `Clientes (${totals.suspended} suspenso${totals.suspended > 1 ? "s" : ""})` : "Clientes", value: num(clients.length) },
    { icon: Users, label: "Usuários", value: num(totals.users) },
    { icon: Contact, label: "Contatos", value: num(totals.contacts) },
    { icon: MessageCircle, label: "WhatsApp conectados", value: num(totals.wa) },
    { icon: Bot, label: "Respostas da IA no mês", value: num(totals.ai) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        icon={ShieldCheck}
        title="Painel da CONNECTA"
        subtitle="Seus clientes no CRM. Aqui aparecem só números gerais; contatos e conversas de cada cliente continuam privados."
      />

      <Link
        href={`/plataforma/relatorios?mes=${shiftMonth(currentMonth(), -1)}`}
        className="card flex flex-wrap items-center justify-between gap-3 border-brand-500/30 bg-brand-500/5 p-4 transition hover:bg-brand-500/10"
      >
        <span className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-accent" />
          <span>
            <span className="block font-medium">Relatório de {monthLabel(shiftMonth(currentMonth(), -1)).toLowerCase()} pronto</span>
            <span className="block text-sm text-muted">Fechamento do mês de cada cliente, com comparação ao mês anterior e PDF para enviar.</span>
          </span>
        </span>
        <span className="btn-primary btn-sm">Abrir relatórios</span>
      </Link>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <s.icon className="h-5 w-5 text-accent" />
            <p className="mt-3 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-xs text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <section className="card">
        <h2 className="section-title"><Plus className="h-4 w-4 text-accent" /> Novo cliente</h2>
        <p className="mt-1 text-sm text-muted">Cria a empresa no CRM e o administrador dela. No primeiro acesso, ele responde um assistente que monta funil, etiquetas, mensagens e campos do nicho (o nicho escolhido aqui já vem marcado).</p>
        <ActionForm action={createClientTenantAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-2" submitLabel="Criar cliente" submitIcon={<Plus className="h-4 w-4" />} submitClassName="btn-primary md:col-start-2 md:justify-self-end">
          <label><span className="label">Nome do escritório *</span><input name="name" required minLength={2} maxLength={120} placeholder="Ex.: Silva & Souza Advogados" className="input" /></label>
          <label><span className="label">Identificador (opcional)</span><input name="slug" maxLength={40} pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?" placeholder="gerado a partir do nome" className="input font-mono" /></label>
          <label><span className="label">Nome do administrador *</span><input name="admin_name" required maxLength={100} placeholder="Ex.: Dra. Ana Silva" className="input" /></label>
          <label><span className="label">E-mail do administrador *</span><input name="admin_email" type="email" required placeholder="ana@silvasouza.adv.br" className="input" /></label>
          <label><span className="label">Senha provisória * (10+ caracteres; ele troca no 1º acesso)</span><input name="admin_password" type="password" required minLength={10} autoComplete="new-password" className="input" /></label>
          <label><span className="label">Nicho (opcional)</span>
            <select name="niche" defaultValue="" className="input">
              <option value="">O cliente escolhe no primeiro acesso</option>
              {NICHE_KEYS.map((k) => <option key={k} value={k}>{NICHES[k].label}</option>)}
            </select>
          </label>
        </ActionForm>
      </section>

      <section className="card overflow-hidden p-0">
        <h2 className="section-title px-5 pt-5"><Building2 className="h-4 w-4 text-accent" /> Clientes</h2>
        {clients.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhum cliente ainda" hint="Crie o primeiro acima." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3 text-right">Usuários</th>
                  <th className="px-5 py-3 text-right">Contatos</th>
                  <th className="px-5 py-3">WhatsApp</th>
                  <th className="px-5 py-3">IA</th>
                  <th className="px-5 py-3 text-right">IA no mês</th>
                  <th className="px-5 py-3">Desde</th>
                  <th className="px-5 py-3">Acesso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {clients.map((c) => {
                  const wa = WA_LABEL[c.whatsapp_status ?? "desconectado"] ?? WA_LABEL.desconectado;
                  return (
                    <tr key={c.id} className={`transition hover:bg-surface-2/60 ${c.suspended_at ? "bg-danger/5" : ""}`}>
                      <td className="px-5 py-3">
                        <span className="block font-medium">{c.name}</span>
                        <span className="block font-mono text-xs text-subtle">{c.slug}</span>
                        {c.suspended_at && (
                          <span className="mt-1 inline-flex items-start gap-1 rounded-lg bg-danger/10 px-2 py-1 text-xs font-medium text-danger">
                            <Ban className="mt-0.5 h-3 w-3 shrink-0" /> Suspenso desde {dateTime(c.suspended_at)}
                            {c.suspended_reason ? ` · ${c.suspended_reason}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(c.members)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(c.contacts)}</td>
                      <td className={`whitespace-nowrap px-5 py-3 font-medium ${wa.cls}`}>{wa.label}</td>
                      <td className="px-5 py-3 text-muted">{AI_LABEL[c.ai_mode ?? "desligado"] ?? "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted">
                        {num(c.ai_messages_month)} resp. · {num(Math.round(c.ai_tokens_month / 1000))} mil tokens
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{dateTime(c.created_at)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                        <details className="relative">
                          <summary className="btn-secondary btn-sm cursor-pointer list-none whitespace-nowrap">
                            <KeyRound className="h-3.5 w-3.5" /> Senha
                          </summary>
                          <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl border border-line bg-surface p-3 text-left shadow-xl">
                            <p className="text-sm font-medium">Redefinir senha de alguém de {c.name}</p>
                            <p className="mt-1 text-xs text-muted">A pessoa entra com a senha provisória e cria a senha pessoal dela no próximo acesso.</p>
                            <ActionForm action={resetClientPasswordAction} resetOnSuccess className="mt-3 space-y-2" submitLabel="Definir senha provisória" submitIcon={<KeyRound className="h-3.5 w-3.5" />} submitClassName="btn-primary btn-sm w-full">
                              <input type="hidden" name="id" value={c.id} />
                              <input name="email" type="email" required placeholder="E-mail do usuário" className="input py-1.5 text-sm" aria-label="E-mail do usuário" />
                              <input name="senha" type="text" required minLength={10} maxLength={200} autoComplete="off" placeholder="Senha provisória (10+)" className="input py-1.5 text-sm" aria-label="Senha provisória" />
                            </ActionForm>
                          </div>
                        </details>
                        {c.suspended_at ? (
                          <div className="flex items-center gap-2">
                            <ActionForm action={setClientSuspendedAction} submitLabel="Reativar" submitIcon={<CirclePlay className="h-3.5 w-3.5" />} submitClassName="btn-primary btn-sm whitespace-nowrap">
                              <input type="hidden" name="id" value={c.id} />
                              <input type="hidden" name="acao" value="reativar" />
                            </ActionForm>
                            <details className="relative">
                              <summary className="btn-danger btn-sm cursor-pointer list-none whitespace-nowrap">
                                <Trash2 className="h-3.5 w-3.5" /> Excluir
                              </summary>
                              <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl border border-danger/40 bg-surface p-3 text-left shadow-xl">
                                <p className="text-sm font-semibold text-danger">Excluir {c.name} para sempre?</p>
                                <p className="mt-1 text-xs text-muted">
                                  Apaga contatos, conversas, tarefas, arquivos, configurações, WhatsApp e os logins da equipe deste cliente. <strong>Não tem como desfazer.</strong>
                                </p>
                                <ActionForm action={deleteClientTenantAction} className="mt-3 space-y-2" submitLabel="Excluir para sempre" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-danger btn-sm w-full">
                                  <input type="hidden" name="id" value={c.id} />
                                  <label className="block text-xs text-muted">
                                    Para confirmar, digite <span className="font-mono font-semibold text-fg">{c.slug}</span>
                                    <input name="confirmacao" required autoComplete="off" spellCheck={false} placeholder={c.slug} className="input mt-1 py-1.5 font-mono text-sm" />
                                  </label>
                                </ActionForm>
                              </div>
                            </details>
                          </div>
                        ) : (
                          <details className="relative">
                            <summary className="btn-danger btn-sm cursor-pointer list-none whitespace-nowrap">
                              <Ban className="h-3.5 w-3.5" /> Suspender
                            </summary>
                            <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-line bg-surface p-3 text-left shadow-xl">
                              <p className="text-sm font-medium">Suspender {c.name}?</p>
                              <p className="mt-1 text-xs text-muted">
                                A equipe do cliente perde o acesso ao CRM e o WhatsApp/IA param. Nenhum dado é apagado; ao reativar, tudo volta como estava.
                              </p>
                              <ActionForm action={setClientSuspendedAction} className="mt-3 space-y-2" submitLabel="Confirmar suspensão" submitIcon={<Ban className="h-3.5 w-3.5" />} submitClassName="btn-danger btn-sm w-full">
                                <input type="hidden" name="id" value={c.id} />
                                <input type="hidden" name="acao" value="suspender" />
                                <input name="motivo" maxLength={300} defaultValue="Pagamento em atraso" className="input py-1.5 text-sm" aria-label="Motivo" />
                              </ActionForm>
                            </div>
                          </details>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
