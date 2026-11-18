"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  PERMISSIONS,
  PROFILE_PERMISSIONS,
  PROFILES,
  type Permission,
  type Profile,
} from "@/shared/permissions";

const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

/**
 * Perfil + ajuste fino das permissões + setores. Ao trocar o perfil, as
 * caixas voltam ao padrão dele; depois dá para marcar/desmarcar à vontade.
 * Quem não é admin só vê (e só pode conceder) as permissões que tem.
 */
export function AccessFields({
  defaultProfile = "atendente",
  defaultPermissions,
  defaultDepartments = [],
  departments,
  grantable,
  allowAdmin,
  idPrefix,
}: {
  defaultProfile?: Profile;
  defaultPermissions?: Permission[];
  defaultDepartments?: string[];
  departments: { id: string; name: string; color: string }[];
  grantable: Permission[];
  allowAdmin: boolean;
  idPrefix: string;
}) {
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [perms, setPerms] = useState<Set<Permission>>(
    new Set(defaultPermissions ?? PROFILE_PERMISSIONS[defaultProfile]),
  );
  const isAdmin = profile === "admin";
  const allowed = new Set(grantable);

  function changeProfile(p: Profile) {
    setProfile(p);
    setPerms(new Set(PROFILE_PERMISSIONS[p].filter((x) => p === "admin" || allowed.has(x))));
  }
  function toggle(p: Permission) {
    setPerms((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Perfil</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PROFILES.filter((p) => allowAdmin || p.key !== "admin").map((p) => (
            <label
              key={p.key}
              className={`cursor-pointer rounded-xl border p-3 text-sm transition ${
                profile === p.key ? "border-brand-500 bg-brand-500/10" : "border-line hover:bg-surface-2"
              }`}
            >
              <input
                type="radio"
                name="profile"
                value={p.key}
                checked={profile === p.key}
                onChange={() => changeProfile(p.key)}
                className="sr-only"
              />
              <span className="block font-medium">{p.label}</span>
              <span className="block text-xs text-muted">{p.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
          Acessos {isAdmin && <span className="normal-case tracking-normal text-muted">— administrador tem acesso total</span>}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {GROUPS.map((g) => {
            const items = PERMISSIONS.filter((p) => p.group === g && (allowAdmin || allowed.has(p.key)));
            if (!items.length) return null;
            return (
              <fieldset key={g} className="rounded-xl border border-line p-3">
                <legend className="px-1 text-xs font-medium text-muted">{g}</legend>
                {items.map((p) => {
                  const id = `${idPrefix}-${p.key}`;
                  const checked = isAdmin || perms.has(p.key);
                  return (
                    <label key={p.key} htmlFor={id} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        id={id}
                        type="checkbox"
                        name="permissions[]"
                        value={p.key}
                        checked={checked}
                        disabled={isAdmin}
                        onChange={() => toggle(p.key)}
                        className="h-4 w-4 accent-[var(--color-brand-500)]"
                      />
                      {p.label}
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Setores</p>
        {departments.length === 0 ? (
          <p className="text-sm text-subtle">Nenhum setor criado ainda. Sem setor, a pessoa só vê contatos sem setor.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => (
              <label key={d.id} className="chip cursor-pointer gap-1.5 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10">
                <input
                  type="checkbox"
                  name="department_ids[]"
                  value={d.id}
                  defaultChecked={defaultDepartments.includes(d.id)}
                  className="peer sr-only"
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} aria-hidden />
                {d.name}
                <Check className="hidden h-3 w-3 text-accent peer-checked:block" aria-hidden />
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          A pessoa vê os contatos e conversas dos setores marcados (e os sem setor).
          Com &quot;Ver contatos de todos os setores&quot;, vê tudo.
        </p>
      </div>
    </div>
  );
}
