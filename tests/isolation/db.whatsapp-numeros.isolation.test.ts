/**
 * Vários números de WhatsApp por cliente: cada número é do próprio tenant,
 * respeita o limite, e nada de um cliente aponta para o número de outro.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
let bSession: string;

beforeAll(async () => {
  A = await createTenantFixture("num-a");
  B = await createTenantFixture("num-b");
  await raw("update public.tenants set whatsapp_limit = 2 where id = $1", [A.tenantId]);
  const r = await as({ userId: B.adminId }, (q) => q<{ id: string }>("select public.whatsapp_add_number('Comercial B') as id"));
  bSession = r.rows[0].id;
  await as({ userId: A.adminId }, (q) => q("update public.contacts set phone = '5511955554444' where id = $1", [A.contactId]));
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean)]);
  await pool.end();
});

describe("números de WhatsApp", () => {
  it("admin adiciona números até o limite; o primeiro vira o principal", async () => {
    const one = await as({ userId: A.adminId }, (q) => q<{ id: string }>("select public.whatsapp_add_number('Comercial') as id"));
    const two = await as({ userId: A.adminId }, (q) => q<{ id: string }>("select public.whatsapp_add_number('Suporte') as id"));
    const rows = await raw<{ id: string; is_primary: boolean; label: string }>(
      "select id, is_primary, label from public.whatsapp_sessions where tenant_id = $1 order by created_at",
      [A.tenantId],
    );
    expect(rows.map((r) => [r.label, r.is_primary])).toEqual([["Comercial", true], ["Suporte", false]]);
    expect(rows.map((r) => r.id)).toEqual([one.rows[0].id, two.rows[0].id]);
    const msg = await expectDbError(as({ userId: A.adminId }, (q) => q("select public.whatsapp_add_number('Terceiro')")));
    expect(msg).toMatch(/limite/);
  });

  it("atendente não adiciona, renomeia nem remove números", async () => {
    await expectDbError(as({ userId: A.atendenteId }, (q) => q("select public.whatsapp_add_number('x')")));
    const [extra] = await raw<{ id: string }>("select id from public.whatsapp_sessions where tenant_id = $1 and not is_primary", [A.tenantId]);
    await expectDbError(as({ userId: A.atendenteId }, (q) => q("select public.whatsapp_rename_number($1, 'x')", [extra.id])));
    await expectDbError(as({ userId: A.atendenteId }, (q) => q("select public.whatsapp_remove_number($1)", [extra.id])));
  });

  it("A não vê, conecta, renomeia nem remove o número de B", async () => {
    const seen = await as({ userId: A.adminId }, (q) => q("select * from public.whatsapp_sessions where id = $1", [bSession]));
    expect(seen.rowCount).toBe(0);
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.whatsapp_request('reiniciar', $1)", [bSession])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.whatsapp_rename_number($1, 'hack')", [bSession])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.whatsapp_remove_number($1)", [bSession])));
    const [b] = await raw<{ label: string; reset_requested_at: string | null }>("select label, reset_requested_at from public.whatsapp_sessions where id = $1", [bSession]);
    expect(b).toEqual({ label: "Comercial B", reset_requested_at: null });
  });

  it("mensagem de A não pode sair pelo número de B", async () => {
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.whatsapp_outbox (contact_id, body, session_id) values ($1, 'oi', $2)", [A.contactId, bSession]),
      ),
    );
  });

  it("o principal não pode ser removido; remover um extra apaga só as credenciais dele", async () => {
    const [p] = await raw<{ id: string }>("select id from public.whatsapp_sessions where tenant_id = $1 and is_primary", [A.tenantId]);
    const [extra] = await raw<{ id: string }>("select id from public.whatsapp_sessions where tenant_id = $1 and not is_primary", [A.tenantId]);
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.whatsapp_remove_number($1)", [p.id])));
    await raw(
      "insert into public.whatsapp_auth_keys (tenant_id, key, value_enc) values ($1, 'creds', 'x'), ($1, $2, 'y')",
      [A.tenantId, `s:${extra.id}:creds`],
    );
    await as({ userId: A.adminId }, (q) => q("select public.whatsapp_remove_number($1)", [extra.id]));
    const keys = await raw<{ key: string }>("select key from public.whatsapp_auth_keys where tenant_id = $1", [A.tenantId]);
    expect(keys.map((k) => k.key)).toEqual(["creds"]);
  });

  it("só a equipe CONNECTA muda o limite", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.platform_set_whatsapp_limit($1, 10)", [A.tenantId])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.tenants set whatsapp_limit = 10 where id = $1", [A.tenantId])));
  });
});
