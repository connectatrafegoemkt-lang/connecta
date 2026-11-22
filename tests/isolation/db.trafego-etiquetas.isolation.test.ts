/**
 * Tráfego pago e etiquetas do WhatsApp:
 *  - origem do anúncio e vínculo com a etiqueta do WhatsApp só o worker grava;
 *  - mudanças de etiqueta feitas por pessoas viram fila no PRÓPRIO tenant
 *    (e mudanças do worker não voltam para a fila);
 *  - a fila não é legível por usuários;
 *  - investimento em anúncios só a equipe CONNECTA informa e vê.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
let platformUser: string;
const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7) + "-01";

beforeAll(async () => {
  A = await createTenantFixture("traf-a");
  B = await createTenantFixture("traf-b");
  platformUser = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [platformUser, `plataforma-${platformUser}@connecta.local`]);
  await raw("insert into app.platform_admins (user_id) values ($1)", [platformUser]);
  // A tem WhatsApp ligado; B não
  await as("service", (q) => q("insert into public.whatsapp_sessions (tenant_id, desired_state, status) values ($1, 'conectado', 'conectado')", [A.tenantId]));
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId, platformUser].filter(Boolean)]);
  await pool.end();
});

const queue = (tenant: string) =>
  raw<{ kind: string; contact_id: string | null; tag_id: string | null; wa_label_id: string | null }>(
    "select kind, contact_id, tag_id, wa_label_id from public.whatsapp_label_queue where tenant_id = $1 order by created_at",
    [tenant],
  );

describe("origem de anúncio e vínculo de etiqueta: só o worker grava", () => {
  it("usuário não marca lead como anúncio nem forja vínculo com etiqueta do WhatsApp", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.contacts set ad_at = now() where id = $1", [A.contactId])));
    await expectDbError(as({ userId: A.adminId }, (q) => q(`update public.contacts set ad_source = '{"title":"x"}' where id = $1`, [A.contactId])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.tags set wa_label_id = '7' where id = $1", [A.tagId])));
    const c = await as({ userId: A.adminId }, (q) =>
      q<{ ad_at: string | null }>(`insert into public.contacts (name, ad_at, ad_source) values ('X', now(), '{"a":1}') returning ad_at`),
    );
    expect(c.rows[0].ad_at).toBeNull();
    const t = await as({ userId: A.adminId }, (q) => q<{ wa_label_id: string | null }>("insert into public.tags (name, wa_label_id) values ('forjada', '9') returning wa_label_id"));
    expect(t.rows[0].wa_label_id).toBeNull();
  });

  it("worker grava a origem do anúncio e o vínculo", async () => {
    await as("service", (q) => q(`update public.contacts set ad_at = now(), ad_source = '{"title":"Campanha Trabalhista"}' where id = $1`, [A.contactId]));
    await as("service", (q) => q("update public.tags set wa_label_id = '5' where id = $1", [A.tagId]));
    const [c] = await raw<{ ad_at: string | null }>("select ad_at from public.contacts where id = $1", [A.contactId]);
    expect(c.ad_at).not.toBeNull();
  });
});

describe("fila de etiquetas CRM → WhatsApp", () => {
  it("mudanças de pessoas entram na fila do próprio tenant; do worker, não", async () => {
    await raw("delete from public.whatsapp_label_queue where tenant_id = any($1)", [[A.tenantId, B.tenantId]]);
    const tag = await as({ userId: A.adminId }, (q) => q<{ id: string }>("insert into public.tags (name, color) values ('Urgente', '#ff0000') returning id"));
    await as({ userId: A.atendenteId }, (q) => q("insert into public.contact_tags (contact_id, tag_id) values ($1, $2)", [A.contactId, tag.rows[0].id]));
    await as({ userId: A.atendenteId }, (q) => q("delete from public.contact_tags where contact_id = $1 and tag_id = $2", [A.contactId, A.tagId]));
    const kinds = (await queue(A.tenantId)).map((x) => x.kind);
    expect(kinds).toEqual(["label_upsert", "chat_add", "chat_remove"]);
    expect((await queue(A.tenantId))[2].wa_label_id).toBe("5");

    // worker (vindo do celular) não gera eco
    await as("service", (q) => q("insert into public.contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)", [A.tenantId, A.contactId, A.tagId]));
    expect(await queue(A.tenantId)).toHaveLength(3);

    // B (sem WhatsApp) não enfileira nada e não recebe nada de A
    await as({ userId: B.adminId }, (q) => q("insert into public.tags (name) values ('Outra')"));
    expect(await queue(B.tenantId)).toHaveLength(0);
  });

  it("usuários não leem nem escrevem na fila", async () => {
    for (const uid of [A.adminId, A.atendenteId, B.adminId]) {
      await expectDbError(as({ userId: uid }, (q) => q("select * from public.whatsapp_label_queue")));
      await expectDbError(
        as({ userId: uid }, (q) => q("insert into public.whatsapp_label_queue (kind, tag_id) values ('label_upsert', $1)", [A.tagId])),
      );
    }
  });
});

describe("tráfego pago no relatório mensal", () => {
  it("cliente não informa nem lê investimento", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("select public.platform_set_ad_spend($1, $2, 100, 0, 0)", [A.tenantId, month])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("select * from app.tenant_ad_spend")));
  });

  it("equipe CONNECTA informa o investimento e vê leads/fechados do tráfego", async () => {
    await as({ userId: platformUser }, (q) => q("select public.platform_set_ad_spend($1, $2, 150000, 50000, 0)", [A.tenantId, month]));
    // lead de anúncio fecha no mês
    await as({ userId: A.adminId }, async (q) => {
      const won = await q<{ id: string }>("select id from public.pipeline_stages where is_won limit 1");
      await q("update public.contacts set value_cents = 300000, stage_id = $1 where id = $2", [won.rows[0].id, A.contactId]);
    });
    const r = await as({ userId: platformUser }, (q) =>
      q<Record<string, unknown> & { id: string }>("select * from public.platform_monthly_report($1)", [month]),
    );
    const a = r.rows.find((x) => x.id === A.tenantId)!;
    const b = r.rows.find((x) => x.id === B.tenantId)!;
    expect(a).toMatchObject({ ad_leads_new: 1, paid_leads_won: 1 });
    expect(Number(a.paid_won_value_cents)).toBe(300000);
    expect(Number(a.spend_meta_cents)).toBe(150000);
    expect(Number(a.spend_google_cents)).toBe(50000);
    expect(a.top_campaigns).toEqual([{ campaign: "Campanha Trabalhista", count: 1 }]);
    expect(b).toMatchObject({ ad_leads_new: 0, paid_leads_won: 0 });
    expect(Number(b.spend_meta_cents)).toBe(0);
  });
});
