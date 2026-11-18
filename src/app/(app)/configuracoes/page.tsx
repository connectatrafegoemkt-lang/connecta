import { History, Layers, Lock, Plus, Save, Settings, Tag, Trash2, X, Zap } from "lucide-react";
import { can, getTenantContext } from "@/server/context";
import { listStages } from "@/server/data/stages";
import { listTags } from "@/server/data/tags";
import { listMembers } from "@/server/data/members";
import { listAuditLogs } from "@/server/data/audit";
import { listQuickReplies } from "@/server/data/whatsapp-media";
import { ActionForm } from "@/components/action-form";
import { TagBadge } from "@/components/tag-badge";
import { PageHeader } from "@/components/page-header";
import { dateTime } from "@/components/format";
import {
  createStageAction,
  createQuickReplyAction,
  createTagAction,
  deleteQuickReplyAction,
  deleteStageAction,
  deleteTagAction,
  updateStageAction,
} from "../actions";
import { StageOrder } from "./stage-order";

export const metadata = { title: "Configurações" };

const TABLE_LABEL: Record<string, string> = {
  contacts: "contato",
  pipeline_stages: "etapa",
  tags: "tag",
  contact_tags: "tag de contato",
  interactions: "interação",
  tasks: "tarefa",
  memberships: "membro",
  tenants: "empresa",
  whatsapp_sessions: "WhatsApp",
  whatsapp_outbox: "mensagem de WhatsApp",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "criou", UPDATE: "alterou", DELETE: "excluiu" };
const ACTION_COLOR: Record<string, string> = { INSERT: "bg-success", UPDATE: "bg-brand-400", DELETE: "bg-danger" };

const colorInput = "h-10 w-10 shrink-0 cursor-pointer rounded-xl border border-line bg-surface-2 p-1";

export default async function ConfiguracoesPage() {
  const ctx = await getTenantContext();
  // "isAdmin" aqui = pode gerenciar funil, tags e mensagens rápidas
  const isAdmin = can(ctx, "configuracoes.gerenciar");
  const canAudit = can(ctx, "auditoria.ver");
  const [stages, tags, members, logs, quickReplies] = await Promise.all([
    listStages(ctx),
    listTags(ctx),
    listMembers(ctx),
    canAudit ? listAuditLogs(ctx, 50) : Promise.resolve([]),
    can(ctx, "whatsapp.ver") ? listQuickReplies(ctx) : Promise.resolve([]),
  ]);
  const memberName = new Map(members.map((m) => [m.user_id, m.display_name ?? "Usuário"]));

  return (
    <div className="space-y-8">
      <PageHeader icon={Settings} title="Configurações" subtitle={`Funil, tags, mensagens rápidas e auditoria de ${ctx.tenantName}`} />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title"><Layers className="h-4 w-4 text-accent" /> Etapas do funil</h2>
          {!isAdmin && <span className="chip"><Lock className="h-3 w-3" /> Somente quem gerencia configurações edita</span>}
        </div>
        <ul className="mt-5 space-y-2">
          {stages.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/40 p-2">
              <ActionForm action={updateStageAction} className="flex flex-1 flex-wrap items-center gap-2" submitLabel={isAdmin ? "Salvar" : undefined} submitIcon={<Save className="h-3.5 w-3.5" />} submitClassName="btn-secondary btn-sm">
                <input type="hidden" name="id" value={s.id} />
                <input type="color" name="color" defaultValue={s.color} disabled={!isAdmin} className={colorInput} aria-label="Cor da etapa" />
                <input name="name" defaultValue={s.name} disabled={!isAdmin} className="input max-w-xs" aria-label="Nome da etapa" />
                <select name="kind" defaultValue={s.is_won ? "won" : s.is_lost ? "lost" : "open"} disabled={!isAdmin} className="input w-40" aria-label="Tipo da etapa">
                  <option value="open">Em aberto</option>
                  <option value="won">Ganho</option>
                  <option value="lost">Perdido</option>
                </select>
              </ActionForm>
              {isAdmin && (
                <ActionForm action={deleteStageAction} submitLabel="Excluir" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-danger btn-sm">
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
            <StageOrder stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color }))} />
            <div className="rounded-xl border border-dashed border-line p-4">
              <p className="text-sm font-medium">Adicionar etapa</p>
              <ActionForm action={createStageAction} resetOnSuccess className="mt-3 flex flex-wrap items-center gap-2" submitLabel="Adicionar" submitIcon={<Plus className="h-4 w-4" />}>
                <input type="color" name="color" defaultValue="#a100ff" className={colorInput} aria-label="Cor" />
                <input name="name" required placeholder="Ex.: Negociação" className="input max-w-xs flex-1" />
              </ActionForm>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="section-title"><Tag className="h-4 w-4 text-accent" /> Tags</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-0.5">
              <TagBadge {...t} />
              {isAdmin && (
                <form action={deleteTagAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="icon-btn h-6 w-6 hover:text-danger" title="Excluir tag" aria-label={`Excluir tag ${t.name}`}><X className="h-3 w-3" /></button>
                </form>
              )}
            </li>
          ))}
          {tags.length === 0 && <li className="text-sm text-subtle">Nenhuma tag criada.</li>}
        </ul>
        {isAdmin && (
          <ActionForm action={createTagAction} resetOnSuccess className="mt-4 flex flex-wrap items-center gap-2" submitLabel="Criar tag" submitIcon={<Plus className="h-4 w-4" />}>
            <input type="color" name="color" defaultValue="#a100ff" className={colorInput} aria-label="Cor da tag" />
            <input name="name" required placeholder="Nome da tag" className="input max-w-xs" />
          </ActionForm>
        )}
      </section>

      <section className="card">
        <h2 className="section-title"><Zap className="h-4 w-4 text-accent" /> Mensagens rápidas do WhatsApp</h2>
        <p className="mt-1 text-sm text-muted">No chat, digite <kbd className="rounded border border-line bg-surface-2 px-1.5 text-xs">/</kbd> e o atalho para inserir a mensagem.</p>
        <ul className="mt-4 divide-y divide-line">
          {quickReplies.map((q) => (
            <li key={q.id} className="flex items-start gap-3 py-3 text-sm">
              <span className="chip shrink-0 font-mono text-accent-strong">/{q.shortcut}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{q.title}</span>
                <span className="block whitespace-pre-wrap text-xs text-muted">{q.body}</span>
              </span>
              {isAdmin && (
                <form action={deleteQuickReplyAction}>
                  <input type="hidden" name="id" value={q.id} />
                  <button className="icon-btn hover:text-danger" title="Excluir" aria-label={`Excluir /${q.shortcut}`}><Trash2 className="h-4 w-4" /></button>
                </form>
              )}
            </li>
          ))}
          {quickReplies.length === 0 && <li className="py-3 text-sm text-subtle">Nenhuma mensagem rápida ainda.</li>}
        </ul>
        {isAdmin && (
          <ActionForm action={createQuickReplyAction} resetOnSuccess className="mt-4 grid gap-2 md:grid-cols-[10rem_1fr]" submitLabel="Criar mensagem rápida" submitIcon={<Plus className="h-4 w-4" />} submitClassName="btn-primary md:col-start-2 md:justify-self-start">
            <input name="shortcut" required placeholder="/atalho" className="input font-mono" aria-label="Atalho" />
            <input name="title" required placeholder="Título (ex.: Boas-vindas)" className="input" aria-label="Título" />
            <textarea name="body" required rows={3} placeholder="Texto da mensagem" className="input md:col-span-2" aria-label="Texto" />
          </ActionForm>
        )}
      </section>

      {canAudit && (
        <section className="card">
          <h2 className="section-title"><History className="h-4 w-4 text-accent" /> Auditoria <span className="text-xs font-normal text-subtle">últimas 50 alterações</span></h2>
          <ul className="mt-4 space-y-1 text-sm">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2/50">
                <span className={`h-2 w-2 shrink-0 rounded-full ${ACTION_COLOR[l.action] ?? "bg-subtle"}`} aria-hidden />
                <span className="w-32 shrink-0 text-xs text-subtle">{dateTime(l.created_at)}</span>
                <span className="min-w-0 truncate">
                  <span className="font-medium">{l.user_id ? memberName.get(l.user_id) ?? "Usuário removido" : "Sistema"}</span>{" "}
                  <span className="text-muted">{ACTION_LABEL[l.action] ?? l.action} {TABLE_LABEL[l.table_name] ?? l.table_name}</span>
                </span>
              </li>
            ))}
            {logs.length === 0 && <li className="text-subtle">Sem registros.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
