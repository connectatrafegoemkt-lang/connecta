import "server-only";
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
  input: { name: string; slug?: string; admin_email: string; admin_password: string; admin_name: string },
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
  return { tenant_id: tenantId as string, slug };
}
