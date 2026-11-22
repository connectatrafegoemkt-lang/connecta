/**
 * Assistente de nicho (primeiro acesso) e campos extras da ficha do lead.
 * Tudo preso ao tenant da sessão: ninguém cria/vê campos de outro tenant,
 * nem marca nicho/onboarding de outra empresa.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;

const SETUP = {
  stages: [
    { name: "Novo lead", color: "#0ea5e9" },
    { name: "Triagem do caso", color: "#6366f1" },
    { name: "Contrato assinado", color: "#22c55e", is_won: true },
    { name: "Não fechou", color: "#ef4444", is_lost: true },
  ],
  tags: [{ name: "Trabalhista", color: "#0ea5e9" }, { name: "Urgente", color: "#ef4444" }],
  quick_replies: [{ shortcut: "boasvindas", title: "Boas-vindas", body: "Olá!" }],
  departments: [{ name: "Trabalhista", color: "#0ea5e9" }],
  contact_fields: [
    { key: "numero_processo", label: "Nº do processo", type: "texto" },
    { key: "area_direito", label: "Área", type: "opcoes", options: ["Trabalhista"] },
  ],
  ai: { niche: "Advocacia", business_area: "Trabalhista", tone: "formal", rules: "Não prometer resultado.", greeting: "Olá", services: [{ name: "Trabalhista", description: "", price: "" }], faq: [] },
};

beforeAll(async () => {
  A = await createTenantFixture("nicho-a");
  B = await createTenantFixture("nicho-b");
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean)]);
  await pool.end();
});

describe("assistente de nicho", () => {
  it("cliente novo começa sem onboarding; admin aplica e tudo fica só no tenant dele", async () => {
    const [before] = await raw<{ onboarded_at: string | null }>("select onboarded_at from public.tenants where id = $1", [A.tenantId]);
    expect(before.onboarded_at).toBeNull();

    const bStages = await raw("select id, name, position from public.pipeline_stages where tenant_id = $1 order by position", [B.tenantId]);
    const r = await as({ userId: A.adminId }, (q) =>
      q<{ r: Record<string, number> }>("select public.apply_niche_setup('advocacia', $1::jsonb) as r", [JSON.stringify(SETUP)]),
    );
    expect(r.rows[0].r.tags).toBe(2);

    const [t] = await raw<{ niche: string; onboarded_at: string | null }>("select niche, onboarded_at from public.tenants where id = $1", [A.tenantId]);
    expect(t.niche).toBe("advocacia");
    expect(t.onboarded_at).not.toBeNull();

    // nada do modelo foi parar em B
    expect(await raw("select 1 from public.tags where tenant_id = $1 and name = 'Urgente'", [B.tenantId])).toHaveLength(0);
    expect(await raw("select 1 from public.quick_replies where tenant_id = $1", [B.tenantId])).toHaveLength(0);
    expect(await raw("select 1 from public.departments where tenant_id = $1", [B.tenantId])).toHaveLength(0);
    // e tudo o que foi criado é de A
    const created = await raw<{ tenant_id: string }>(
      `select tenant_id from public.quick_replies where shortcut = 'boasvindas'
       union all select tenant_id from public.contact_fields where key = 'numero_processo'
       union all select tenant_id from public.departments where name = 'Trabalhista'`,
    );
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((x) => x.tenant_id === A.tenantId)).toBe(true);
    // B não foi tocado
    const [bt] = await raw<{ niche: string | null; onboarded_at: string | null }>("select niche, onboarded_at from public.tenants where id = $1", [B.tenantId]);
    expect(bt.niche).toBeNull();
    expect(bt.onboarded_at).toBeNull();
    expect(await raw("select id, name, position from public.pipeline_stages where tenant_id = $1 order by position", [B.tenantId])).toEqual(bStages);
    expect(await raw("select 1 from public.contact_fields where tenant_id = $1", [B.tenantId])).toHaveLength(0);

    // IA preenchida, mas continua desligada
    const [ai] = await raw<{ mode: string; niche: string }>("select mode, niche from public.ai_settings where tenant_id = $1", [A.tenantId]);
    expect(ai).toEqual({ mode: "desligado", niche: "Advocacia" });
  });

  it("etapa com lead é preservada; etapas vazias fora do modelo saem", async () => {
    const stages = await raw<{ id: string; name: string }>("select id, name from public.pipeline_stages where tenant_id = $1 order by position", [A.tenantId]);
    const names = stages.map((s) => s.name);
    expect(names.slice(0, 4)).toEqual(["Novo lead", "Triagem do caso", "Contrato assinado", "Não fechou"]);
    // a etapa da fixture (Novo lead) tem o contato de A e continua com o mesmo id
    expect(stages.find((s) => s.name === "Novo lead")!.id).toBe(A.stageId);
    expect(names).not.toContain("Qualificado");
    const [c] = await raw<{ stage_id: string }>("select stage_id from public.contacts where id = $1", [A.contactId]);
    expect(c.stage_id).toBe(A.stageId);
  });

  it("reaplicar não duplica nada", async () => {
    await as({ userId: A.adminId }, (q) => q("select public.apply_niche_setup('advocacia', $1::jsonb)", [JSON.stringify(SETUP)]));
    const [n] = await raw<{ tags: number; qr: number; f: number; st: number }>(
      `select (select count(*)::int from public.tags where tenant_id = $1 and name in ('Trabalhista','Urgente')) as tags,
              (select count(*)::int from public.quick_replies where tenant_id = $1) as qr,
              (select count(*)::int from public.contact_fields where tenant_id = $1) as f,
              (select count(*)::int from public.pipeline_stages where tenant_id = $1) as st`,
      [A.tenantId],
    );
    expect(n).toEqual({ tags: 2, qr: 1, f: 2, st: 4 });
  });

  it("atendente e anônimo não aplicam o assistente", async () => {
    await expectDbError(as({ userId: B.atendenteId }, (q) => q("select public.apply_niche_setup('saude', $1::jsonb)", [JSON.stringify(SETUP)])));
    await expectDbError(as("anon", (q) => q("select public.apply_niche_setup('saude', '{}'::jsonb)")));
    await expectDbError(as({ userId: B.atendenteId }, (q) => q("select app.mark_tenant_onboarded('saude')")));
    const [bt] = await raw<{ niche: string | null }>("select niche from public.tenants where id = $1", [B.tenantId]);
    expect(bt.niche).toBeNull();
  });

  it("usuário não altera nicho/onboarding direto na tabela (nem do próprio tenant)", async () => {
    await expectDbError(as({ userId: B.adminId }, (q) => q("update public.tenants set niche = 'saude' where id = $1", [B.tenantId])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.tenants set onboarded_at = null where id = $1", [B.tenantId])));
  });

  it("nicho inválido e configuração gigante são recusados", async () => {
    await expectDbError(as({ userId: B.adminId }, (q) => q("select public.apply_niche_setup('hacker', '{}'::jsonb)")));
    const big = { tags: Array.from({ length: 61 }, (_, i) => ({ name: `t${i}`, color: "#000000" })) };
    await expectDbError(as({ userId: B.adminId }, (q) => q("select public.apply_niche_setup('outro', $1::jsonb)", [JSON.stringify(big)])));
  });

  it("pular marca o próprio tenant como configurado sem criar nada", async () => {
    const before = await raw("select count(*)::int as n from public.tags where tenant_id = $1", [B.tenantId]);
    await as({ userId: B.adminId }, (q) => q("select public.apply_niche_setup(null, '{}'::jsonb)"));
    const [bt] = await raw<{ niche: string | null; onboarded_at: string | null }>("select niche, onboarded_at from public.tenants where id = $1", [B.tenantId]);
    expect(bt.onboarded_at).not.toBeNull();
    expect(bt.niche).toBeNull();
    expect(await raw("select count(*)::int as n from public.tags where tenant_id = $1", [B.tenantId])).toEqual(before);
  });
});

describe("campos extras da ficha do lead (contact_fields)", () => {
  it("A não vê nem altera campos de B", async () => {
    const f = await as({ userId: B.adminId }, (q) =>
      q<{ id: string }>("insert into public.contact_fields (key, label) values ('segredo_b', 'Segredo B') returning id"),
    );
    const fid = f.rows[0].id;
    for (const uid of [A.adminId, A.atendenteId]) {
      await as({ userId: uid }, async (q) => {
        expect((await q("select * from public.contact_fields where id = $1", [fid])).rowCount).toBe(0);
        expect((await q("select * from public.contact_fields where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
        expect((await q("update public.contact_fields set label = 'x' where id = $1", [fid])).rowCount).toBe(0);
        expect((await q("delete from public.contact_fields where id = $1", [fid])).rowCount).toBe(0);
      });
    }
    const [still] = await raw<{ label: string }>("select label from public.contact_fields where id = $1", [fid]);
    expect(still.label).toBe("Segredo B");
  });

  it("tenant_id de outro cliente no insert é recusado", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) => q("insert into public.contact_fields (tenant_id, key, label) values ($1, 'x', 'X')", [B.tenantId])),
    );
  });

  it("atendente vê os campos do próprio tenant, mas não cria", async () => {
    await as({ userId: A.atendenteId }, async (q) => {
      expect((await q("select * from public.contact_fields")).rowCount).toBeGreaterThan(0);
    });
    await expectDbError(as({ userId: A.atendenteId }, (q) => q("insert into public.contact_fields (key, label) values ('y', 'Y')")));
  });

  it("custom_fields do contato precisa ser um objeto", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.contacts set custom_fields = '[]'::jsonb where id = $1", [A.contactId])));
    const ok = await as({ userId: A.adminId }, (q) =>
      q("update public.contacts set custom_fields = '{\"numero_processo\": \"123\"}'::jsonb where id = $1", [A.contactId]),
    );
    expect(ok.rowCount).toBe(1);
    // e o contato de B continua fora do alcance de A
    const other = await as({ userId: A.adminId }, (q) => q("update public.contacts set custom_fields = '{}'::jsonb where id = $1", [B.contactId]));
    expect(other.rowCount).toBe(0);
  });
});
