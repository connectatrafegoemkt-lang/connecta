/**
 * Relatório mensal do Painel da CONNECTA: só a equipe da plataforma vê, e
 * só números agregados por cliente (nada de contatos ou conversas).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
let platformUser: string;
const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7) + "-01";

type Row = Record<string, unknown> & { id: string };

beforeAll(async () => {
  A = await createTenantFixture("rel-a");
  B = await createTenantFixture("rel-b");
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plataforma-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);

  // A: 2 mensagens recebidas, 1 enviada; contato fechado (etapa de ganho)
  await as({ userId: A.adminId }, async (q) => {
    await q("insert into public.interactions (contact_id, type, direction, body) values ($1, 'whatsapp', 'entrada', 'oi'), ($1, 'whatsapp', 'entrada', 'tudo bem?'), ($1, 'whatsapp', 'saida', 'olá')", [A.contactId]);
    await q("insert into public.contacts (name, source) values ('Novo A', 'Instagram')");
    const won = await q<{ id: string }>("select id from public.pipeline_stages where is_won limit 1");
    await q("update public.contacts set value_cents = 250000, stage_id = $1 where id = $2", [won.rows[0].id, A.contactId]);
  });
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId, platformUser].filter(Boolean)]);
  await pool.end();
});

describe("relatório mensal da plataforma", () => {
  it("clientes (inclusive admin) e anônimos não acessam", async () => {
    for (const uid of [A.adminId, A.atendenteId, B.adminId]) {
      const msg = await expectDbError(as({ userId: uid }, (q) => q("select * from public.platform_monthly_report($1)", [month])));
      expect(msg).toMatch(/apenas administradores da plataforma/);
    }
    await expectDbError(as("anon", (q) => q("select * from public.platform_monthly_report($1)", [month])));
  });

  it("equipe CONNECTA vê os números certos de cada cliente, sem misturar", async () => {
    const r = await as({ userId: platformUser }, (q) => q<Row>("select * from public.platform_monthly_report($1)", [month]));
    const a = r.rows.find((x) => x.id === A.tenantId)!;
    const b = r.rows.find((x) => x.id === B.tenantId)!;
    expect(a).toMatchObject({ leads_new: 2, leads_won: 1, wa_in: 2, wa_out: 1, wa_conversations: 1, members: 2 });
    expect(Number(a.won_value_cents)).toBe(250000);
    expect(a.top_sources).toEqual(expect.arrayContaining([{ source: "Instagram", count: 1 }]));
    expect(b).toMatchObject({ leads_new: 1, leads_won: 0, wa_in: 0, wa_out: 0 });
  });

  it("só números: nenhuma coluna traz conteúdo de contato ou conversa", async () => {
    const r = await as({ userId: platformUser }, (q) => q<Row>("select * from public.platform_monthly_report($1)", [month]));
    const json = JSON.stringify(r.rows);
    for (const secret of ["Segredo do tenant", "tudo bem?", "contato-rel-a@exemplo.com", "Contato rel-a", "Tarefa rel-a"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("mês sem movimento vem zerado e mês inválido é recusado", async () => {
    const r = await as({ userId: platformUser }, (q) => q<Row>("select * from public.platform_monthly_report('2021-01-01')"));
    expect(r.rows.find((x) => x.id === A.tenantId)).toBeUndefined(); // cliente ainda não existia
    await expectDbError(as({ userId: platformUser }, (q) => q("select * from public.platform_monthly_report('1999-01-01')")));
  });
});
