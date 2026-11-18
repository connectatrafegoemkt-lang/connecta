import { Bot, Building2, Contact, MessageCircle, Plus, ShieldCheck, Users } from "lucide-react";
import { getPlatformContext, listClientTenants } from "@/server/platform";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { dateTime } from "@/components/format";
import { createClientTenantAction } from "./actions";

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
    }),
    { users: 0, contacts: 0, wa: 0, ai: 0 },
  );
  const stats = [
    { icon: Building2, label: "Clientes", value: num(clients.length) },
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
        <p className="mt-1 text-sm text-muted">Cria a empresa no CRM com o funil padrão e o administrador dela. Ele entra com o e-mail e a senha abaixo e cadastra a própria equipe.</p>
        <ActionForm action={createClientTenantAction} resetOnSuccess className="mt-4 grid gap-3 md:grid-cols-2" submitLabel="Criar cliente" submitIcon={<Plus className="h-4 w-4" />} submitClassName="btn-primary md:col-start-2 md:justify-self-end">
          <label><span className="label">Nome do escritório *</span><input name="name" required minLength={2} maxLength={120} placeholder="Ex.: Silva & Souza Advogados" className="input" /></label>
          <label><span className="label">Identificador (opcional)</span><input name="slug" maxLength={40} pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?" placeholder="gerado a partir do nome" className="input font-mono" /></label>
          <label><span className="label">Nome do administrador *</span><input name="admin_name" required maxLength={100} placeholder="Ex.: Dra. Ana Silva" className="input" /></label>
          <label><span className="label">E-mail do administrador *</span><input name="admin_email" type="email" required placeholder="ana@silvasouza.adv.br" className="input" /></label>
          <label><span className="label">Senha inicial * (10+ caracteres)</span><input name="admin_password" type="password" required minLength={10} autoComplete="new-password" className="input" /></label>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {clients.map((c) => {
                  const wa = WA_LABEL[c.whatsapp_status ?? "desconectado"] ?? WA_LABEL.desconectado;
                  return (
                    <tr key={c.id} className="transition hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <span className="block font-medium">{c.name}</span>
                        <span className="block font-mono text-xs text-subtle">{c.slug}</span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(c.members)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{num(c.contacts)}</td>
                      <td className={`whitespace-nowrap px-5 py-3 font-medium ${wa.cls}`}>{wa.label}</td>
                      <td className="px-5 py-3 text-muted">{AI_LABEL[c.ai_mode ?? "desligado"] ?? "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-muted">
                        {num(c.ai_messages_month)} resp. · {num(Math.round(c.ai_tokens_month / 1000))} mil tokens
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted">{dateTime(c.created_at)}</td>
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
