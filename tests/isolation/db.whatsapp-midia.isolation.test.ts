/**
 * Isolamento de mídia, agendamento e mensagens rápidas do WhatsApp.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;
const future = () => new Date(Date.now() + 86_400_000).toISOString();

beforeAll(async () => {
  A = await createTenantFixture("md-a");
  B = await createTenantFixture("md-b");
  for (const [t, phone] of [[A, "5511940000001"], [B, "5511940000002"]] as const) {
    await as({ userId: t.atendenteId }, async (q) => {
      await q("update public.contacts set phone = $1 where id = $2", [phone, t.contactId]);
      await q("insert into public.quick_replies (shortcut, title, body) values ('boasvindas', 'Boas-vindas', $1)", [`rapida-${t.tenantId}`]);
      await q("insert into public.whatsapp_outbox (contact_id, body, scheduled_at) values ($1, $2, $3)", [t.contactId, `agendada-${t.tenantId}`, future()]);
    });
  }
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean)]);
  await pool.end();
});

describe("mídia na fila de envio", () => {
  it("aceita arquivo da pasta do próprio tenant", async () => {
    const r = await as({ userId: A.atendenteId }, (q) =>
      q<{ media_path: string }>(
        "insert into public.whatsapp_outbox (contact_id, body, media_kind, media_path, media_mime) values ($1, '', 'image', $2, 'image/png') returning media_path",
        [A.contactId, `${A.tenantId}/whatsapp/${A.contactId}/foto.png`],
      ),
    );
    expect(r.rows[0].media_path.startsWith(A.tenantId)).toBe(true);
  });

  it("recusa arquivo da pasta de outro tenant (nem o worker consegue)", async () => {
    const pathB = `${B.tenantId}/whatsapp/${B.contactId}/contrato.pdf`;
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.whatsapp_outbox (contact_id, body, media_kind, media_path) values ($1, 'x', 'document', $2)", [A.contactId, pathB]),
      ),
    );
    await expectDbError(
      as("service", (q) =>
        q("insert into public.whatsapp_outbox (tenant_id, contact_id, body, media_kind, media_path) values ($1, $2, 'x', 'document', $3)", [A.tenantId, A.contactId, pathB]),
      ),
    );
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.whatsapp_outbox (contact_id, body, media_kind, media_path) values ($1, 'x', 'document', $2)", [A.contactId, `${A.tenantId}/../${B.tenantId}/x.pdf`]),
      ),
    );
  });
});

describe("mensagens agendadas", () => {
  it("A vê e cancela só os próprios agendamentos", async () => {
    await as({ userId: A.atendenteId }, async (q) => {
      const seen = await q<{ body: string }>("select body from public.whatsapp_outbox where scheduled_at is not null");
      expect(seen.rows.map((r) => r.body)).toEqual([`agendada-${A.tenantId}`]);
      const delB = await q("delete from public.whatsapp_outbox where tenant_id = $1", [B.tenantId]);
      expect(delB.rowCount).toBe(0);
    });
    expect(await raw("select 1 from public.whatsapp_outbox where body = $1", [`agendada-${B.tenantId}`])).toHaveLength(1);
    const delA = await as({ userId: A.atendenteId }, (q) =>
      q("delete from public.whatsapp_outbox where body = $1", [`agendada-${A.tenantId}`]),
    );
    expect(delA.rowCount).toBe(1);
  });
});

describe("mensagens rápidas", () => {
  it("A lista só as próprias, e o mesmo atalho pode existir em B", async () => {
    const r = await as({ userId: A.atendenteId }, (q) => q<{ body: string }>("select body from public.quick_replies"));
    expect(r.rows.map((x) => x.body)).toEqual([`rapida-${A.tenantId}`]);
  });

  it("A não altera, exclui nem cria mensagens rápidas em B", async () => {
    await as({ userId: A.adminId }, async (q) => {
      expect((await q("update public.quick_replies set body = 'HACK' where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
      expect((await q("delete from public.quick_replies where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
    });
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.quick_replies (tenant_id, shortcut, title, body) values ($1, 'x', 'x', 'x')", [B.tenantId]),
      ),
    );
    const [b] = await raw<{ body: string }>("select body from public.quick_replies where tenant_id = $1", [B.tenantId]);
    expect(b.body).toBe(`rapida-${B.tenantId}`);
  });
});
