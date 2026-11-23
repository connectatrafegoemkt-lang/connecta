/**
 * Google Sheets → Prospecção: só a equipe CONNECTA conecta e sincroniza
 * planilhas; cada linha entra uma vez; lead excluída não volta.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let platformUser: string;
let sourceId: string;
const SHEET = `Sheet${randomUUID().replace(/-/g, "")}`.slice(0, 40);
const P = () => ({ userId: platformUser });

beforeAll(async () => {
  A = await createTenantFixture("sheet-a");
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plataforma-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);
});

afterAll(async () => {
  await raw("delete from app.prospect_sheet_sources where sheet_id = $1", [SHEET]);
  await raw("delete from app.prospects where created_by = $1", [platformUser]);
  await raw("delete from public.tenants where id = $1", [A?.tenantId]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, platformUser].filter(Boolean)]);
  await pool.end();
});

const rows = [
  { key: "tel:5541999998888", name: "Dra. Ana", phone: "5541999998888", company: "Souza Adv" },
  { key: "email:joao@lima.adv.br", name: "Dr. João", email: "joao@lima.adv.br" },
];

describe("planilhas do Google Sheets na prospecção", () => {
  it("equipe CONNECTA conecta e sincroniza; reimportar não duplica", async () => {
    const r = await as(P(), (q) => q<{ id: string }>("select public.platform_sheet_source_add('Leads OAB', $1, '0', null) as id", [SHEET]));
    sourceId = r.rows[0].id;
    const n1 = await as(P(), (q) => q<{ n: number }>("select public.platform_sheet_sync($1, $2::jsonb) as n", [sourceId, JSON.stringify(rows)]));
    expect(n1.rows[0].n).toBe(2);
    const n2 = await as(P(), (q) => q<{ n: number }>("select public.platform_sheet_sync($1, $2::jsonb) as n", [sourceId, JSON.stringify(rows)]));
    expect(n2.rows[0].n).toBe(0);
    const [p] = await raw<{ source: string }>("select source from app.prospects where phone = '5541999998888' and created_by = $1", [platformUser]);
    expect(p.source).toBe("Google Sheets: Leads OAB");
  });

  it("coluna preenchida depois na planilha (ex.: Instagram) chega à lead, sem apagar o que foi digitado no CRM", async () => {
    await raw("update app.prospects set company = 'Editado no CRM' where email = 'joao@lima.adv.br' and created_by = $1", [platformUser]);
    const later = [
      { ...rows[0], instagram: "dra.ana", area: "Trabalhista" },
      { ...rows[1], instagram: "joao.lima", company: "Lima Sociedade" },
    ];
    const n = await as(P(), (q) => q<{ n: number }>("select public.platform_sheet_sync($1, $2::jsonb) as n", [sourceId, JSON.stringify(later)]));
    expect(n.rows[0].n).toBe(0); // nenhuma nova
    const ps = await raw<{ name: string; instagram: string; area: string | null; company: string }>(
      "select name, instagram, area, company from app.prospects where created_by = $1 order by name",
      [platformUser],
    );
    expect(ps).toEqual([
      { name: "Dr. João", instagram: "joao.lima", area: null, company: "Editado no CRM" },
      { name: "Dra. Ana", instagram: "dra.ana", area: "Trabalhista", company: "Souza Adv" },
    ]);
    const l = await as(P(), (q) => q<{ l: { id: string; last_result: string }[] }>("select public.platform_sheet_sources_list() as l"));
    expect(l.rows[0].l.find((x) => x.id === sourceId)!.last_result).toBe("2 lead(s) atualizada(s)");
  });

  it("lead excluída no CRM não volta na próxima leitura", async () => {
    await raw("delete from app.prospects where phone = '5541999998888' and created_by = $1", [platformUser]);
    const n = await as(P(), (q) => q<{ n: number }>("select public.platform_sheet_sync($1, $2::jsonb) as n", [sourceId, JSON.stringify(rows)]));
    expect(n.rows[0].n).toBe(0);
  });

  it("erro de leitura fica registrado para aparecer na tela", async () => {
    await as(P(), (q) => q("select public.platform_sheet_sync($1, '[]'::jsonb, 'Planilha não compartilhada')", [sourceId]));
    const l = await as(P(), (q) => q<{ l: { id: string; last_ok: boolean; last_result: string; imported: number }[] }>("select public.platform_sheet_sources_list() as l"));
    const s = l.rows[0].l.find((x) => x.id === sourceId)!;
    expect(s).toMatchObject({ last_ok: false, last_result: "Planilha não compartilhada", imported: 2 });
  });

  it("clientes e anônimos não acessam nada", async () => {
    for (const actor of [{ userId: A.adminId }, { userId: A.atendenteId }, "anon" as const]) {
      for (const sql of [
        "select public.platform_sheet_sources_list()",
        `select public.platform_sheet_source_add('x', '${SHEET}x', '0', null)`,
        `select public.platform_sheet_sync('${sourceId}', '[{"key":"k","name":"invasor"}]'::jsonb)`,
        `select public.platform_sheet_source_delete('${sourceId}')`,
        "select * from app.prospect_sheet_sources",
        "select * from app.prospect_sheet_seen",
      ]) {
        await expectDbError(as(actor, (q) => q(sql)));
      }
    }
    expect(await raw("select 1 from app.prospects where name = 'invasor'")).toHaveLength(0);
  });

  it("id de planilha inválido é recusado", async () => {
    await expectDbError(as(P(), (q) => q("select public.platform_sheet_source_add('x', '../../etc', '0', null)")));
  });
});
