/**
 * Prospecção da CONNECTA (leads ativas): só a equipe da plataforma vê e
 * altera. Clientes (inclusive admin) não chegam nas tabelas nem nas funções.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let platformUser: string;
let prospectId: string;

beforeAll(async () => {
  A = await createTenantFixture("prosp-a");
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plataforma-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);
});

afterAll(async () => {
  await raw("delete from app.prospects where created_by = $1", [platformUser]);
  await raw("delete from public.tenants where id = $1", [A?.tenantId]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, platformUser].filter(Boolean)]);
  await pool.end();
});

const P = () => ({ userId: platformUser });

describe("prospecção da CONNECTA", () => {
  it("equipe CONNECTA cadastra, registra follow-up e vê o histórico", async () => {
    const r = await as(P(), (q) =>
      q<{ id: string }>("select public.platform_prospect_save(null, $1::jsonb) as id", [
        JSON.stringify({ name: "Dr. Paulo", company: "Paulo Advocacia", phone: "5541999998888", niche: "Advocacia", source: "Instagram" }),
      ]),
    );
    prospectId = r.rows[0].id;
    await as(P(), (q) =>
      q("select public.platform_prospect_log($1, 'whatsapp', 'Mandei apresentação', now() + interval '2 days')", [prospectId]),
    );
    const g = await as(P(), (q) => q<{ p: Record<string, unknown> & { activities: { type: string; body: string }[] } }>("select public.platform_prospect_get($1) as p", [prospectId]));
    const p = g.rows[0].p;
    expect(p.status).toBe("contatado"); // novo → contatado no primeiro contato
    expect(p.last_contact_at).not.toBeNull();
    expect(p.next_followup_at).not.toBeNull();
    expect(p.activities.map((a) => a.type).sort()).toEqual(["status", "whatsapp"]);
    const list = await as(P(), (q) => q<{ l: { id: string }[] }>("select public.platform_prospects_list() as l"));
    expect(list.rows[0].l.some((x) => x.id === prospectId)).toBe(true);
  });

  it("grava área de atuação e Instagram; recusa Instagram inválido", async () => {
    const r = await as(P(), (q) =>
      q<{ id: string }>("select public.platform_prospect_save(null, $1::jsonb) as id", [
        JSON.stringify({ name: "Dra. Area", area: "Trabalhista", instagram: "dra.area" }),
      ]),
    );
    const [row] = await raw<{ area: string; instagram: string }>("select area, instagram from app.prospects where id = $1", [r.rows[0].id]);
    expect(row).toEqual({ area: "Trabalhista", instagram: "dra.area" });
    await expectDbError(as(P(), (q) => q("select public.platform_prospect_save(null, $1::jsonb)", [JSON.stringify({ name: "X", instagram: "inválido com espaço" })])));
  });

  it("importa uma lista e recusa telefone inválido", async () => {
    const n = await as(P(), (q) =>
      q<{ n: number }>("select public.platform_prospects_import($1::jsonb) as n", [
        JSON.stringify([{ name: "Escritório X", phone: "5511988887777" }, { name: "Escritório Y" }]),
      ]),
    );
    expect(n.rows[0].n).toBe(2);
    await expectDbError(as(P(), (q) => q("select public.platform_prospect_save(null, $1::jsonb)", [JSON.stringify({ name: "Z", phone: "abc" })])));
  });

  it("clientes (admin e atendente) e anônimos não acessam nada", async () => {
    for (const actor of [{ userId: A.adminId }, { userId: A.atendenteId }, "anon" as const]) {
      for (const sql of [
        "select public.platform_prospects_list()",
        `select public.platform_prospect_get('${prospectId}')`,
        `select public.platform_prospect_save(null, '{"name":"invasor"}'::jsonb)`,
        `select public.platform_prospect_log('${prospectId}', 'nota', 'x', null)`,
        `select public.platform_prospect_delete('${prospectId}')`,
        `select public.platform_prospects_import('[{"name":"x"}]'::jsonb)`,
        "select * from app.prospects",
        "select * from app.prospect_activities",
      ]) {
        await expectDbError(as(actor, (q) => q(sql)));
      }
    }
    const [{ n }] = await raw<{ n: number }>("select count(*)::int as n from app.prospects where name = 'invasor'");
    expect(n).toBe(0);
  });

  it("excluir apaga a lead e o histórico", async () => {
    await as(P(), (q) => q("select public.platform_prospect_delete($1)", [prospectId]));
    const [{ n }] = await raw<{ n: number }>("select count(*)::int as n from app.prospect_activities where prospect_id = $1", [prospectId]);
    expect(n).toBe(0);
    await expectDbError(as(P(), (q) => q("select public.platform_prospect_get($1)", [prospectId])));
  });
});
