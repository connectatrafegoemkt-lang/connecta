/**
 * Suspensão de cliente (ex.: atraso no pagamento): enquanto suspenso, os
 * usuários do cliente não leem nem gravam NADA (bloqueio no banco); só a
 * equipe CONNECTA suspende/reativa; outros clientes não são afetados; ao
 * reativar, os dados voltam intactos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
let platformUser: string;
let platformTenant: string;

const suspend = (tenant: string, on: boolean, reason: string | null = null) =>
  as({ userId: platformUser }, (q) => q("select public.platform_set_tenant_suspended($1, $2, $3)", [tenant, on, reason]));

beforeAll(async () => {
  A = await createTenantFixture("susp-a");
  B = await createTenantFixture("susp-b");
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plat-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);
  const [t] = await raw<{ id: string }>("insert into public.tenants (name, slug) values ('CONNECTA teste', $1) returning id", [
    `connecta-${platformUser.slice(0, 8)}`,
  ]);
  platformTenant = t.id;
  await raw("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'admin')", [platformTenant, platformUser]);
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId, platformTenant].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [
    [A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId, platformUser].filter(Boolean),
  ]);
  await pool.end();
});

describe("suspensão de cliente", () => {
  it("só a equipe CONNECTA suspende; admin do cliente e de outro cliente não", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.platform_set_tenant_suspended($1, true)", [A.tenantId])));
    await expectDbError(as({ userId: B.adminId }, (q) => q("select public.platform_set_tenant_suspended($1, true)", [A.tenantId])));
    await expectDbError(as("anon", (q) => q("select public.platform_set_tenant_suspended($1, true)", [A.tenantId])));
    // nem mexendo direto na coluna
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.tenants set suspended_at = now()")));
    const [t] = await raw<{ s: string | null }>("select suspended_at as s from public.tenants where id = $1", [A.tenantId]);
    expect(t.s).toBeNull();
  });

  it("equipe CONNECTA não suspende a própria empresa por engano", async () => {
    const msg = await expectDbError(suspend(platformTenant, true));
    expect(msg).toMatch(/própria conta/);
  });

  it("cliente suspenso: usuários não leem nem gravam nada, e veem suspended = true", async () => {
    await suspend(A.tenantId, true, "Pagamento em atraso");
    for (const uid of [A.adminId, A.atendenteId]) {
      await as({ userId: uid }, async (q) => {
        for (const t of ["contacts", "interactions", "tasks", "tags", "pipeline_stages", "memberships", "whatsapp_sessions", "ai_settings", "tenants"]) {
          const r = await q(`select * from public.${t}`);
          expect(r.rowCount, `${t} (${uid === A.adminId ? "admin" : "atendente"})`).toBe(0);
        }
        const objs = await q("select * from storage.objects");
        expect(objs.rowCount).toBe(0);
        const ctx = await q<{ tenant_id: string; suspended: boolean }>("select tenant_id, suspended from public.current_context()");
        expect(ctx.rows[0]).toEqual({ tenant_id: A.tenantId, suspended: true });
        const dash = await q<{ s: { contacts_total: number } }>("select public.dashboard_summary() as s");
        expect(dash.rows[0].s.contacts_total).toBe(0);
      });
    }
    await expectDbError(as({ userId: A.adminId }, (q) => q("insert into public.contacts (name) values ('novo')")));
    const upd = await as({ userId: A.adminId }, (q) => q("update public.contacts set name = 'x' where id = $1", [A.contactId]));
    expect(upd.rowCount).toBe(0);
    const del = await as({ userId: A.adminId }, (q) => q("delete from public.contacts"));
    expect(del.rowCount).toBe(0);
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.whatsapp_request('conectar')")));
    const [ov] = await as({ userId: platformUser }, (q) =>
      q<{ suspended_at: string | null; suspended_reason: string | null }>(
        "select suspended_at, suspended_reason from public.platform_tenants_overview() where id = $1",
        [A.tenantId],
      ),
    ).then((r) => r.rows);
    expect(ov.suspended_at).not.toBeNull();
    expect(ov.suspended_reason).toBe("Pagamento em atraso");
  });

  it("outro cliente continua funcionando normalmente", async () => {
    const r = await as({ userId: B.adminId }, (q) => q<{ id: string }>("select id from public.contacts"));
    expect(r.rows.map((x) => x.id)).toEqual([B.contactId]);
    const ctx = await as({ userId: B.adminId }, (q) => q<{ suspended: boolean }>("select suspended from public.current_context()"));
    expect(ctx.rows[0].suspended).toBe(false);
  });

  it("ao reativar, os dados voltam intactos", async () => {
    await suspend(A.tenantId, false);
    const r = await as({ userId: A.atendenteId }, (q) => q<{ id: string; name: string }>("select id, name from public.contacts"));
    expect(r.rows.map((x) => x.id)).toEqual([A.contactId]);
    expect(r.rows[0].name).not.toBe("x");
    const [t] = await raw<{ s: string | null; r: string | null }>(
      "select suspended_at as s, suspended_reason as r from public.tenants where id = $1",
      [A.tenantId],
    );
    expect(t).toEqual({ s: null, r: null });
  });
});
