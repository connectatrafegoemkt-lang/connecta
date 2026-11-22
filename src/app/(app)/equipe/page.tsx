import { redirect } from "next/navigation";
import { Building, KeyRound, Plus, ShieldCheck, Trash2, UserCog, UserPlus, UserRound, Users } from "lucide-react";
import { can, getTenantContext } from "@/server/context";
import { listMembers } from "@/server/data/members";
import { listDepartments } from "@/server/data/departments";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { PERMISSION_KEYS, profileLabel } from "@/shared/permissions";
import {
  createDepartmentAction,
  deleteDepartmentAction,
  inviteMemberAction,
  removeMemberAction,
  resetMemberPasswordAction,
  updateMemberAction,
} from "../actions";
import { AccessFields } from "./access-fields";

export const metadata = { title: "Equipe" };

const colorInput = "h-10 w-10 shrink-0 cursor-pointer rounded-xl border border-line bg-surface-2 p-1";

export default async function EquipePage() {
  const ctx = await getTenantContext();
  if (!can(ctx, "equipe.gerenciar")) redirect("/dashboard");
  const isAdmin = ctx.role === "admin";
  const [members, departments] = await Promise.all([listMembers(ctx), listDepartments(ctx)]);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const grantable = isAdmin ? PERMISSION_KEYS : PERMISSION_KEYS.filter((p) => ctx.permissions.has(p));
  const countBy = new Map<string, number>();
  for (const m of members) for (const d of m.department_ids) countBy.set(d, (countBy.get(d) ?? 0) + 1);

  return (
    <div className="space-y-8">
      <PageHeader icon={Users} title="Equipe" subtitle="Usuários, setores e o que cada pessoa pode acessar" />

      <section className="card">
        <h2 className="section-title"><Building className="h-4 w-4 text-accent" /> Setores</h2>
        <p className="mt-1 text-sm text-muted">Ex.: Comercial, Trabalhista, Previdenciário. Cada contato pode pertencer a um setor.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center gap-1 rounded-xl border border-line bg-surface-2/40 py-1 pl-3 pr-1 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} aria-hidden />
              <span className="font-medium">{d.name}</span>
              <span className="text-xs text-subtle">· {countBy.get(d.id) ?? 0} pessoa(s)</span>
              <ActionForm action={deleteDepartmentAction} submitLabel="Excluir" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-ghost btn-sm hover:text-danger">
                <input type="hidden" name="id" value={d.id} />
              </ActionForm>
            </li>
          ))}
          {departments.length === 0 && <li className="text-sm text-subtle">Nenhum setor ainda.</li>}
        </ul>
        <ActionForm action={createDepartmentAction} resetOnSuccess className="mt-4 flex flex-wrap items-center gap-2" submitLabel="Criar setor" submitIcon={<Plus className="h-4 w-4" />}>
          <input type="color" name="color" defaultValue="#a100ff" className={colorInput} aria-label="Cor do setor" />
          <input name="name" required maxLength={60} placeholder="Nome do setor" className="input max-w-xs" aria-label="Nome do setor" />
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="section-title"><UserCog className="h-4 w-4 text-accent" /> Pessoas</h2>
        <ul className="mt-4 space-y-3">
          {members.map((m) => {
            const editable = m.user_id !== ctx.userId && (isAdmin || m.profile !== "admin");
            return (
              <li key={m.id} className="rounded-xl border border-line">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-3 text-sm">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
                      {(m.display_name ?? "U").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {m.display_name ?? "Usuário"}
                        {m.user_id === ctx.userId && <span className="text-muted"> (você)</span>}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        {m.profile === "admin" ? <ShieldCheck className="h-3 w-3 text-accent" /> : <UserRound className="h-3 w-3" />}
                        {profileLabel(m.profile)}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {m.department_ids.map((id) => {
                        const d = deptById.get(id);
                        return d ? (
                          <span key={id} className="chip gap-1.5 text-xs">
                            <span className="h-2 w-2 rounded-full" style={{ background: d.color }} aria-hidden />
                            {d.name}
                          </span>
                        ) : null;
                      })}
                    </span>
                    {editable && <span className="btn-secondary btn-sm">Editar acessos</span>}
                  </summary>
                  {editable && (
                    <div className="border-t border-line p-4">
                      <ActionForm action={updateMemberAction} className="space-y-4" submitLabel="Salvar acessos">
                        <input type="hidden" name="id" value={m.id} />
                        <input name="display_name" defaultValue={m.display_name ?? ""} required maxLength={100} className="input max-w-sm" aria-label="Nome" />
                        <AccessFields
                          idPrefix={m.id}
                          defaultProfile={m.profile}
                          defaultPermissions={m.permissions}
                          defaultDepartments={m.department_ids}
                          departments={departments}
                          grantable={grantable}
                          allowAdmin={isAdmin}
                        />
                      </ActionForm>
                      <div className="mt-4 rounded-xl border border-line bg-surface-2/40 p-3">
                        <p className="flex items-center gap-1.5 text-sm font-medium"><KeyRound className="h-4 w-4 text-accent" /> Redefinir senha</p>
                        <p className="mt-0.5 text-xs text-muted">Defina uma senha provisória. No próximo acesso, a pessoa entra com ela e cria a própria senha.</p>
                        <ActionForm action={resetMemberPasswordAction} resetOnSuccess className="mt-2 flex flex-wrap items-center gap-2" submitLabel="Definir senha provisória" submitClassName="btn-secondary btn-sm">
                          <input type="hidden" name="id" value={m.id} />
                          <input name="senha" type="text" required minLength={10} maxLength={200} autoComplete="off" placeholder="Senha provisória (10+)" className="input max-w-xs py-1.5 text-sm" aria-label="Senha provisória" />
                        </ActionForm>
                      </div>
                      <ActionForm action={removeMemberAction} className="mt-3" submitLabel="Remover da equipe" submitIcon={<Trash2 className="h-3.5 w-3.5" />} submitClassName="btn-danger btn-sm">
                        <input type="hidden" name="id" value={m.id} />
                      </ActionForm>
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="section-title"><UserPlus className="h-4 w-4 text-accent" /> Adicionar pessoa</h2>
        <ActionForm action={inviteMemberAction} resetOnSuccess className="mt-4 space-y-4" submitLabel="Criar usuário" submitIcon={<UserPlus className="h-4 w-4" />}>
          <div className="grid gap-2 md:grid-cols-3">
            <input name="display_name" required maxLength={100} placeholder="Nome" className="input" aria-label="Nome" />
            <input name="email" type="email" required placeholder="E-mail" className="input" aria-label="E-mail" />
            <input name="password" type="password" required minLength={10} placeholder="Senha provisória (10+)" className="input" aria-label="Senha provisória" />
          </div>
          <p className="text-xs text-muted">No primeiro acesso, a pessoa entra com essa senha provisória e é levada a criar a senha pessoal dela.</p>
          <AccessFields idPrefix="novo" departments={departments} grantable={grantable} allowAdmin={isAdmin} />
        </ActionForm>
      </section>
    </div>
  );
}
