import { getTenantContext } from "@/server/context";
import { listStages } from "@/server/data/stages";
import { listTags } from "@/server/data/tags";
import { listMembers } from "@/server/data/members";
import { listAuditLogs } from "@/server/data/audit";
import { ActionForm } from "@/components/action-form";
import { TagBadge } from "@/components/tag-badge";
import { dateTime } from "@/components/format";
import {
  createStageAction,
  createTagAction,
  deleteStageAction,
  deleteTagAction,
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
  updateStageAction,
} from "../actions";
import { StageOrder } from "./stage-order";

export const metadata = { title: "Configurações — CONNECTA CRM" };

const TABLE_LABEL: Record<string, string> = {
  contacts: "Contato",
  pipeline_stages: "Etapa",
  tags: "Tag",
  contact_tags: "Tag do contato",
  interactions: "Interação",
  tasks: "Tarefa",
  memberships: "Membro",
  tenants: "Empresa",
  whatsapp_sessions: "WhatsApp",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "criou", UPDATE: "alterou", DELETE: "excluiu" };

export default async function ConfiguracoesPage() {
  const ctx = await getTenantContext();
  const isAdmin = ctx.role === "admin";
  const [stages, tags, members, logs] = await Promise.all([
    listStages(ctx),
    listTags(ctx),
    listMembers(ctx),
    isAdmin ? listAuditLogs(ctx, 50) : Promise.resolve([]),
  ]);
  const memberName = new Map(members.map((m) => [m.user_id, m.display_name ?? "Usuário"]));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      <section className="card">
        <h2 className="font-semibold">Etapas do funil</h2>
        {!isAdmin && <p className="mt-1 text-sm text-slate-500">Somente administradores podem editar as etapas.</p>}
        <ul className="mt-4 space-y-2">
          {stages.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <ActionForm action={updateStageAction} className="flex flex-1 flex-wrap items-center gap-2" submitLabel={isAdmin ? "Salvar" : undefined} submitClassName="btn-secondary">
                <input type="hidden" name="id" value={s.id} />
                <input type="color" name="color" defaultValue={s.color} disabled={!isAdmin} className="h-9 w-10 rounded border border-slate-300" />
                <input name="name" defaultValue={s.name} disabled={!isAdmin} className="input max-w-xs" />
                <select name="kind" defaultValue={s.is_won ? "won" : s.is_lost ? "lost" : "open"} disabled={!isAdmin} className="input w-36">
                  <option value="open">Em aberto</option>
                  <option value="won">Ganho</option>
                  <option value="lost">Perdido</option>
                </select>
              </ActionForm>
              {isAdmin && (
                <ActionForm action={deleteStageAction} submitLabel="Excluir" submitClassName="btn-danger">
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <>
            <StageOrder stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
            <ActionForm action={createStageAction} resetOnSuccess className="mt-4 flex flex-wrap gap-2" submitLabel="Adicionar etapa">
              <input type="color" name="color" defaultValue="#64748b" className="h-9 w-10 rounded border border-slate-300" />
              <input name="name" required placeholder="Nova etapa" className="input max-w-xs" />
            </ActionForm>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="font-semibold">Tags</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-1">
              <TagBadge {...t} />
              <form action={deleteTagAction}>
                <input type="hidden" name="id" value={t.id} />
                <button className="text-xs text-slate-400 hover:text-red-600" title="Excluir">✕</button>
              </form>
            </li>
          ))}
          {tags.length === 0 && <li className="text-sm text-slate-500">Nenhuma tag.</li>}
        </ul>
        <ActionForm action={createTagAction} resetOnSuccess className="mt-4 flex flex-wrap gap-2" submitLabel="Criar tag">
          <input type="color" name="color" defaultValue="#0ea5e9" className="h-9 w-10 rounded border border-slate-300" />
          <input name="name" required placeholder="Nome da tag" className="input max-w-xs" />
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="font-semibold">Usuários</h2>
        <ul className="mt-4 divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="flex-1 font-medium">{m.display_name ?? "Usuário"}{m.user_id === ctx.userId && " (você)"}</span>
              {isAdmin ? (
                <>
                  <ActionForm action={updateMemberRoleAction} className="flex items-center gap-2" submitLabel="Alterar" submitClassName="btn-secondary py-1 text-xs">
                    <input type="hidden" name="id" value={m.id} />
                    <select name="role" defaultValue={m.role} className="input w-36 py-1">
                      <option value="admin">Administrador</option>
                      <option value="atendente">Atendente</option>
                    </select>
                  </ActionForm>
                  {m.user_id !== ctx.userId && (
                    <ActionForm action={removeMemberAction} submitLabel="Remover" submitClassName="btn-danger py-1 text-xs">
                      <input type="hidden" name="id" value={m.id} />
                    </ActionForm>
                  )}
                </>
              ) : (
                <span className="text-slate-500">{m.role === "admin" ? "Administrador" : "Atendente"}</span>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <ActionForm action={inviteMemberAction} resetOnSuccess className="mt-4 grid gap-2 md:grid-cols-5" submitLabel="Criar usuário">
            <input name="display_name" required placeholder="Nome" className="input" />
            <input name="email" type="email" required placeholder="E-mail" className="input" />
            <input name="password" type="password" required minLength={10} placeholder="Senha inicial (10+)" className="input" />
            <select name="role" defaultValue="atendente" className="input">
              <option value="atendente">Atendente</option>
              <option value="admin">Administrador</option>
            </select>
          </ActionForm>
        )}
      </section>

      {isAdmin && (
        <section className="card">
          <h2 className="font-semibold">Auditoria (últimas 50 alterações)</h2>
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {logs.map((l) => (
              <li key={l.id} className="py-2">
                <span className="text-slate-400">{dateTime(l.created_at)}</span>{" · "}
                <span className="font-medium">{l.user_id ? memberName.get(l.user_id) ?? "Usuário removido" : "Sistema"}</span>{" "}
                {ACTION_LABEL[l.action] ?? l.action} {TABLE_LABEL[l.table_name] ?? l.table_name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
