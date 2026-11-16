/**
 * Smoke test do worker (CI): cria um tenant, pede conexão do WhatsApp e
 * espera o worker gravar um QR code real para ESSE tenant (e só para ele).
 * Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/smoke/whatsapp-qr.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const run = randomUUID().slice(0, 8);
  const ids: string[] = [];
  const users: string[] = [];
  for (const label of ["a", "b"]) {
    const { data: u } = await sb.auth.admin.createUser({ email: `qr-${label}-${run}@teste.local`, password: `S-${randomUUID()}`, email_confirm: true });
    users.push(u.user!.id);
    const { data } = await sb.rpc("create_tenant_with_admin", { p_name: `QR ${label}`, p_slug: `qr-${label}-${run}`, p_admin_user_id: u.user!.id });
    ids.push(data as string);
  }
  const [A, B] = ids;
  try {
    await sb.from("whatsapp_sessions").upsert({ tenant_id: A, desired_state: "conectado", status: "conectando" }).throwOnError();
    for (let i = 0; i < 60; i++) {
      const { data } = await sb.from("whatsapp_qr").select("tenant_id, qr").in("tenant_id", [A, B]);
      const a = data?.find((r) => r.tenant_id === A);
      if (a?.qr) {
        if (data!.some((r) => r.tenant_id === B && r.qr)) throw new Error("QR gerado para o tenant errado!");
        const { data: s } = await sb.from("whatsapp_sessions").select("status").eq("tenant_id", A).single();
        console.log(`OK: QR gerado para o tenant A (status ${s?.status}), nenhum para B.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Worker não gerou QR em 60s");
  } finally {
    await sb.from("whatsapp_sessions").update({ desired_state: "desconectado" }).eq("tenant_id", A);
    await new Promise((r) => setTimeout(r, 3000));
    await sb.from("tenants").delete().in("id", ids);
    for (const u of users) await sb.auth.admin.deleteUser(u);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
