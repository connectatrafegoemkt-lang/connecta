import "server-only";
import type { NicheKey } from "@/shared/niches";
import { randomBytes } from "node:crypto";
import { badRequest, HttpError } from "../errors";
import type { PlatformContext } from "../platform";
import { supabaseAdmin } from "./supabase-admin";

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "cliente";
}

/**
 * Cria um novo cliente (tenant) e o administrador dele.
 * Exige PlatformContext (obtido de getPlatformContext(), que checa no banco).
 * service_role é usado só para criar o login e chamar a função de onboarding,
 * que é exclusiva do service_role.
 */
export async function createClientTenant(
  _p: PlatformContext,
  input: { name: string; slug?: string; admin_email: string; admin_password: string; admin_name: string; niche?: NicheKey },
) {
  if (_p?.kind !== "platform") throw new HttpError(403, "Apenas a equipe CONNECTA");
  const admin = supabaseAdmin();
  const explicitSlug = Boolean(input.slug);
  let slug = input.slug || slugify(input.name);
  if (!explicitSlug) {
    const { data } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (data) slug = `${slug}-${randomBytes(2).toString("hex")}`;
  }

  const { data: u, error } = await admin.auth.admin.createUser({
    email: input.admin_email,
    password: input.admin_password,
    email_confirm: true,
  });
  if (error || !u.user) throw badRequest("Não foi possível criar o login (e-mail já cadastrado?)");

  const { data: tenantId, error: e2 } = await admin.rpc("create_tenant_with_admin", {
    p_name: input.name,
    p_slug: slug,
    p_admin_user_id: u.user.id,
    p_admin_name: input.admin_name,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(u.user.id);
    if (e2.code === "23505") throw badRequest("Esse endereço (slug) já está em uso. Escolha outro.");
    throw new HttpError(500, "Falha ao criar o cliente");
  }
  if (input.niche) {
    // Só pré-marca o nicho do tenant recém-criado (id vindo do próprio banco).
    await admin.from("tenants").update({ niche: input.niche }).eq("id", tenantId as string);
  }
  return { tenant_id: tenantId as string, slug };
}

/** Lista todos os arquivos sob um prefixo do bucket (recursivo). */
async function listAllFiles(bucket: ReturnType<ReturnType<typeof supabaseAdmin>["storage"]["from"]>, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(dir, { limit: 1000, offset });
      if (error) throw error;
      for (const e of data ?? []) {
        const path = `${dir}/${e.name}`;
        if (e.id === null) stack.push(path); // pasta
        else out.push(path);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

/**
 * Exclui DEFINITIVAMENTE um cliente. A autorização e as travas (equipe da
 * plataforma, cliente suspenso, confirmação pelo identificador, nunca a
 * própria empresa) são do banco: platform_delete_tenant, chamada com o
 * cliente do PRÓPRIO usuário. Só depois, com service_role, apagamos os
 * arquivos do Storage e os logins da equipe daquele cliente.
 */
export async function deleteClientTenant(p: PlatformContext, tenantId: string, confirmSlug: string) {
  if (p?.kind !== "platform") throw new HttpError(403, "Apenas a equipe CONNECTA");
  const { data, error } = await p.supabase.rpc("platform_delete_tenant", { p_tenant: tenantId, p_confirm_slug: confirmSlug });
  if (error) {
    if (error.code === "P0002") throw new HttpError(404, "Cliente não encontrado");
    if (error.code === "55000" || error.code === "22023") throw badRequest(error.message);
    if (error.code === "42501") throw new HttpError(403, error.message.includes("própria") ? error.message : "Apenas a equipe CONNECTA");
    throw new HttpError(500, "Falha ao excluir o cliente");
  }
  const userIds = (data as string[] | null) ?? [];
  const admin = supabaseAdmin();

  // Arquivos do cliente (pasta <tenant_id>/ do bucket privado)
  let files = 0;
  try {
    const bucket = admin.storage.from("tenant-files");
    const paths = await listAllFiles(bucket, tenantId);
    for (let i = 0; i < paths.length; i += 100) {
      const { error: rmErr } = await bucket.remove(paths.slice(i, i + 100));
      if (rmErr) throw rmErr;
    }
    files = paths.length;
  } catch (e) {
    console.error("[excluir-cliente] falha ao apagar arquivos", tenantId, e);
  }

  // Logins da equipe: só quem não ficou vinculado a nenhuma empresa
  let users = 0;
  if (userIds.length) {
    const { data: still } = await admin.from("memberships").select("user_id").in("user_id", userIds);
    const keep = new Set(((still ?? []) as { user_id: string }[]).map((r) => r.user_id));
    for (const id of userIds) {
      if (keep.has(id)) continue;
      const { error: delErr } = await admin.auth.admin.deleteUser(id);
      if (delErr) console.error("[excluir-cliente] falha ao apagar login", id, delErr.message);
      else users++;
    }
  }
  return { deleted_users: users, deleted_files: files };
}
