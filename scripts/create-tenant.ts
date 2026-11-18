/**
 * Onboarding de um novo cliente (tenant) — uso interno da CONNECTA.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/create-tenant.ts "Escritório Silva" escritorio-silva admin@silva.com.br "Senha-Forte-123" "Dra. Silva"
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [name, slug, email, password, adminName] = process.argv.slice(2);
  if (!name || !slug || !email || !password) {
    console.error("Uso: create-tenant.ts <nome> <slug> <email-admin> <senha> [nome-admin]");
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { data: tenantId, error: e2 } = await admin.rpc("create_tenant_with_admin", {
    p_name: name,
    p_slug: slug,
    p_admin_user_id: u.user.id,
    p_admin_name: adminName ?? null,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(u.user.id);
    throw e2;
  }
  console.log(`Tenant criado: ${tenantId} (admin ${email})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
