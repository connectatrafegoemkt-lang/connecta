/**
 * Painel da CONNECTA: só administradores da plataforma chegam à visão geral
 * dos clientes, e ela traz apenas metadados (nunca dados de negócio).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
let platformUser: string;

beforeAll(async () => {
  A = await createTenantFixture("plat-a");
  B = await createTenantFixture("plat-b");
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plataforma-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [
    [A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId, platformUser].filter(Boolean),
  ]);
  await pool.end();
});

describe("painel da plataforma", () => {
  it("usuários dos clientes (inclusive admin) não são administradores da plataforma", async () => {
    for (const uid of [A.adminId, A.atendenteId, B.adminId]) {
      const r = await as({ userId: uid }, (q) => q<{ ok: boolean }>("select public.is_platform_admin() as ok"));
      expect(r.rows[0].ok).toBe(false);
    }
    const r = await as({ userId: platformUser }, (q) => q<{ ok: boolean }>("select public.is_platform_admin() as ok"));
    expect(r.rows[0].ok).toBe(true);
  });

  it("admin de um cliente não acessa a visão geral dos clientes", async () => {
    const msg = await expectDbError(as({ userId: A.adminId }, (q) => q("select * from public.platform_tenants_overview()")));
    expect(msg).toMatch(/apenas administradores da plataforma/);
    await expectDbError(as("anon", (q) => q("select * from public.platform_tenants_overview()")));
  });

  it("ninguém lê nem se inclui na lista de administradores da plataforma", async () => {
    for (const actor of [{ userId: A.adminId }, { userId: platformUser }, "service" as const]) {
      await expectDbError(as(actor, (q) => q("select * from app.platform_admins")));
      await expectDbError(
        as(actor, (q) => q("insert into app.platform_admins (user_id) values ($1)", [A.adminId])),
      );
    }
    const n = await raw<{ n: number }>("select count(*)::int as n from app.platform_admins where user_id = $1", [A.adminId]);
    expect(n[0].n).toBe(0);
  });

  it("administrador da plataforma vê os clientes, mas só metadados", async () => {
    const r = await as({ userId: platformUser }, (q) =>
      q<Record<string, unknown>>("select * from public.platform_tenants_overview() where id = any($1)", [[A.tenantId, B.tenantId]]),
    );
    expect(r.rows.map((x) => x.id).sort()).toEqual([A.tenantId, B.tenantId].sort());
    expect(Object.keys(r.rows[0]).sort()).toEqual(
      ["ai_messages_month", "ai_mode", "ai_tokens_month", "contacts", "created_at", "id", "members", "name", "slug", "whatsapp_status"].sort(),
    );
    const a = r.rows.find((x) => x.id === A.tenantId)!;
    expect(a.members).toBe(2);
    expect(a.contacts).toBe(1);
  });

  it("administrador da plataforma continua SEM acesso aos dados de negócio dos clientes", async () => {
    await as({ userId: platformUser }, async (q) => {
      for (const t of ["contacts", "interactions", "tasks", "tags", "whatsapp_outbox", "memberships"]) {
        const r = await q(`select * from public.${t}`);
        expect(r.rowCount, t).toBe(0);
      }
    });
  });

  it("usuário comum não cria cliente pela função interna", async () => {
    await expectDbError(
      as({ userId: platformUser }, (q) =>
        q("select public.create_tenant_with_admin('X', $1, $2)", [`x-${randomUUID().slice(0, 8)}`, platformUser]),
      ),
    );
  });
});
