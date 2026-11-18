/**
 * Isolamento do atendimento por IA: configuração, sugestões, consumo,
 * pausa por contato e origem das mensagens.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await createTenantFixture("ai-a");
  B = await createTenantFixture("ai-b");
  for (const t of [A, B]) {
    await as({ userId: t.adminId }, (q) =>
      q("insert into public.ai_settings (mode, niche, rules) values ('automatico', $1, $2)", [
        `nicho-secreto-${t.tenantId}`,
        `regra-secreta-${t.tenantId}`,
      ]),
    );
    await as("service", async (q) => {
      await q("insert into public.ai_suggestions (tenant_id, contact_id, body) values ($1, $2, $3)", [
        t.tenantId,
        t.contactId,
        `sugestao-${t.tenantId}`,
      ]);
      await q("insert into public.ai_usage (tenant_id, kind, model, input_tokens, output_tokens) values ($1, 'resposta', 'm', 10, 5)", [
        t.tenantId,
      ]);
    });
  }
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [
    [A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean),
  ]);
  await pool.end();
});

describe("configuração da IA", () => {
  it("A lê só a própria configuração", async () => {
    for (const uid of [A.adminId, A.atendenteId]) {
      const r = await as({ userId: uid }, (q) => q<{ tenant_id: string; niche: string }>("select tenant_id, niche from public.ai_settings"));
      expect(r.rows).toEqual([{ tenant_id: A.tenantId, niche: `nicho-secreto-${A.tenantId}` }]);
    }
  });

  it("admin de A não altera a configuração de B (0 linhas) e não cria config em B", async () => {
    const r = await as({ userId: A.adminId }, (q) =>
      q("update public.ai_settings set rules = 'HACKEADO' where tenant_id = $1", [B.tenantId]),
    );
    expect(r.rowCount).toBe(0);
    await expectDbError(
      as({ userId: A.adminId }, (q) => q("insert into public.ai_settings (tenant_id, mode) values ($1, 'automatico')", [B.tenantId])),
    );
    const [b] = await raw<{ rules: string }>("select rules from public.ai_settings where tenant_id = $1", [B.tenantId]);
    expect(b.rules).toBe(`regra-secreta-${B.tenantId}`);
  });

  it("atendente não altera a configuração nem do próprio tenant", async () => {
    const r = await as({ userId: A.atendenteId }, (q) => q("update public.ai_settings set mode = 'desligado'"));
    expect(r.rowCount).toBe(0);
  });

  it("ninguém exclui a configuração pela API", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("delete from public.ai_settings")));
  });
});

describe("sugestões da IA", () => {
  it("A vê só as próprias sugestões e não marca as de B", async () => {
    await as({ userId: A.atendenteId }, async (q) => {
      const r = await q<{ body: string }>("select body from public.ai_suggestions");
      expect(r.rows.map((x) => x.body)).toEqual([`sugestao-${A.tenantId}`]);
      const u = await q("update public.ai_suggestions set status = 'usada' where tenant_id = $1", [B.tenantId]);
      expect(u.rowCount).toBe(0);
    });
  });

  it("usuário não cria sugestão nem altera o texto (só o status)", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.ai_suggestions (contact_id, body) values ($1, 'forjada')", [A.contactId]),
      ),
    );
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.ai_suggestions set body = 'alterado'")));
  });
});

describe("consumo da IA", () => {
  it("só o admin do tenant lê o consumo, e só do próprio tenant", async () => {
    const adm = await as({ userId: A.adminId }, (q) => q<{ tenant_id: string }>("select tenant_id from public.ai_usage"));
    expect(adm.rows.every((r) => r.tenant_id === A.tenantId)).toBe(true);
    expect(adm.rowCount).toBe(1);
    const at = await as({ userId: A.atendenteId }, (q) => q("select * from public.ai_usage"));
    expect(at.rowCount).toBe(0);
    const sum = await as({ userId: A.adminId }, (q) => q<{ s: { mensagens: number } }>("select public.ai_usage_summary() as s"));
    expect(sum.rows[0].s.mensagens).toBe(1);
  });

  it("ninguém grava consumo pela API (nem no próprio tenant)", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.ai_usage (tenant_id, kind, model) values ($1, 'teste', 'x')", [A.tenantId]),
      ),
    );
    await expectDbError(as({ userId: A.adminId }, (q) => q("delete from public.ai_usage")));
  });
});

describe("pausa e origem das mensagens", () => {
  it("A não pausa a IA de um contato de B", async () => {
    const r = await as({ userId: A.adminId }, (q) =>
      q("update public.contacts set ai_paused_until = 'infinity' where id = $1", [B.contactId]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("usuário não consegue se passar pela IA na fila de envio (origin)", async () => {
    await as({ userId: A.atendenteId }, (q) =>
      q("update public.contacts set phone = '5511955551111' where id = $1", [A.contactId]),
    );
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.whatsapp_outbox (contact_id, body, origin) values ($1, 'x', 'ia')", [A.contactId]),
      ),
    );
    const r = await as({ userId: A.atendenteId }, (q) =>
      q<{ origin: string }>("insert into public.whatsapp_outbox (contact_id, body) values ($1, 'oi') returning origin", [A.contactId]),
    );
    expect(r.rows[0].origin).toBe("humano");
  });
});
