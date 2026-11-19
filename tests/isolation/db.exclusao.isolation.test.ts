/**
 * Exclusão definitiva de cliente pelo Painel da CONNECTA: só a equipe da
 * plataforma, só cliente já suspenso, com confirmação pelo identificador,
 * nunca a própria empresa; apaga TODOS os dados do cliente e nada de outro.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
let platformUser: string;
let platformTenant: string;
let slugA: string;

const del = (actor: { userId: string }, tenant: string, slug: string) =>
  as(actor, (q) => q<{ ids: string[] }>("select public.platform_delete_tenant($1, $2) as ids", [tenant, slug]));

beforeAll(async () => {
  A = await createTenantFixture("del-a");
  B = await createTenantFixture("del-b");
  [{ slug: slugA }] = await raw<{ slug: string }>("select slug from public.tenants where id = $1", [A.tenantId]);
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plat-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);
  const [t] = await raw<{ id: string }>("insert into public.tenants (name, slug) values ('CONNECTA', $1) returning id", [
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

const TABLES = [
  "contacts", "interactions", "tasks", "tags", "pipeline_stages", "contact_tags", "memberships",
  "whatsapp_outbox", "ai_settings", "quick_replies", "departments", "audit_logs",
];

describe("excluir cliente", () => {
  it("admin do próprio cliente ou de outro cliente não exclui", async () => {
    await raw("update public.tenants set suspended_at = now() where id = $1", [A.tenantId]);
    await expectDbError(del({ userId: A.adminId }, A.tenantId, slugA));
    await expectDbError(del({ userId: B.adminId }, A.tenantId, slugA));
    const r = await raw("select 1 from public.tenants where id = $1", [A.tenantId]);
    expect(r).toHaveLength(1);
  });

  it("não exclui cliente ativo (precisa suspender antes)", async () => {
    const msg = await expectDbError(del({ userId: platformUser }, B.tenantId, "qualquer"));
    expect(msg).toMatch(/suspenda o cliente antes/);
  });

  it("não exclui sem digitar o identificador exato", async () => {
    const msg = await expectDbError(del({ userId: platformUser }, A.tenantId, `${slugA}-errado`));
    expect(msg).toMatch(/confirmação não confere/);
  });

  it("não exclui a empresa da própria conta", async () => {
    await raw("update public.tenants set suspended_at = now() where id = $1", [platformTenant]);
    const [t] = await raw<{ slug: string }>("select slug from public.tenants where id = $1", [platformTenant]);
    const msg = await expectDbError(del({ userId: platformUser }, platformTenant, t.slug));
    expect(msg).toMatch(/própria conta/);
    await raw("update public.tenants set suspended_at = null where id = $1", [platformTenant]);
  });

  it("exclui TODOS os dados do cliente, devolve a equipe e não toca no outro cliente", async () => {
    const before = await raw<{ n: number }>(
      "select count(*)::int as n from public.contacts where tenant_id = $1",
      [B.tenantId],
    );
    const r = await del({ userId: platformUser }, A.tenantId, slugA);
    expect([...r.rows[0].ids].sort()).toEqual([A.adminId, A.atendenteId].sort());
    for (const t of TABLES) {
      const left = await raw<{ n: number }>(`select count(*)::int as n from public.${t} where tenant_id = $1`, [A.tenantId]);
      expect(left[0].n, t).toBe(0);
    }
    expect(await raw("select 1 from public.tenants where id = $1", [A.tenantId])).toHaveLength(0);
    const after = await raw<{ n: number }>("select count(*)::int as n from public.contacts where tenant_id = $1", [B.tenantId]);
    expect(after[0].n).toBe(before[0].n);
    const bMembers = await raw<{ n: number }>("select count(*)::int as n from public.memberships where tenant_id = $1", [B.tenantId]);
    expect(bMembers[0].n).toBe(2);
  });
});
