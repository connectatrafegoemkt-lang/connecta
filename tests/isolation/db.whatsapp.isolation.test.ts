/**
 * Isolamento do WhatsApp no banco: sessões, QR, credenciais e fila.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await createTenantFixture("wa-a");
  B = await createTenantFixture("wa-b");
  // Estado do worker (service_role) para os dois tenants
  for (const t of [A, B]) {
    await as("service", async (q) => {
      await q("insert into public.whatsapp_sessions (tenant_id, status, desired_state, phone, is_primary) values ($1, 'conectado', 'conectado', '5511900000000', true)", [t.tenantId]);
      await q(
        "insert into public.whatsapp_qr (tenant_id, session_id, qr) select $1, id, $2 from public.whatsapp_sessions where tenant_id = $1 and is_primary",
        [t.tenantId, `QR-SECRETO-${t.tenantId}`],
      );
      await q("insert into public.whatsapp_auth_keys (tenant_id, key, value_enc) values ($1, 'creds', 'cifrado')", [t.tenantId]);
    });
  }
  await as({ userId: B.atendenteId }, (q) =>
    q("update public.contacts set phone = '5511911112222' where id = $1", [B.contactId]),
  );
  await as({ userId: B.atendenteId }, (q) =>
    q("insert into public.whatsapp_outbox (contact_id, body) values ($1, 'mensagem de B')", [B.contactId]),
  );
  await as({ userId: A.atendenteId }, (q) =>
    q("update public.contacts set phone = '5511933334444' where id = $1", [A.contactId]),
  );
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [
    [A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean),
  ]);
  await pool.end();
});

describe("credenciais do WhatsApp", () => {
  it("nenhum usuário (nem admin do próprio tenant) lê whatsapp_auth_keys", async () => {
    for (const uid of [A.adminId, A.atendenteId]) {
      const msg = await expectDbError(as({ userId: uid }, (q) => q("select * from public.whatsapp_auth_keys")));
      expect(msg).toMatch(/permission denied/);
    }
  });

  it("nenhum usuário escreve credenciais (inclusive de B)", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.whatsapp_auth_keys (tenant_id, key, value_enc) values ($1, 'creds', 'x')", [B.tenantId]),
      ),
    );
    await expectDbError(as({ userId: A.adminId }, (q) => q("delete from public.whatsapp_auth_keys")));
    const left = await raw("select 1 from public.whatsapp_auth_keys where tenant_id = $1", [B.tenantId]);
    expect(left).toHaveLength(1);
  });
});

describe("sessão e QR", () => {
  it("A vê apenas a própria sessão", async () => {
    const r = await as({ userId: A.atendenteId }, (q) => q<{ tenant_id: string }>("select tenant_id from public.whatsapp_sessions"));
    expect(r.rows.map((x) => x.tenant_id)).toEqual([A.tenantId]);
  });

  it("QR: só o admin do próprio tenant lê; atendente não; ninguém lê o de B", async () => {
    const admin = await as({ userId: A.adminId }, (q) => q<{ tenant_id: string; qr: string }>("select tenant_id, qr from public.whatsapp_qr"));
    expect(admin.rows).toEqual([{ tenant_id: A.tenantId, qr: `QR-SECRETO-${A.tenantId}` }]);
    const at = await as({ userId: A.atendenteId }, (q) => q("select * from public.whatsapp_qr"));
    expect(at.rowCount).toBe(0);
  });

  it("usuários não alteram sessão/QR diretamente (nem de B)", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("update public.whatsapp_sessions set desired_state = 'desconectado' where tenant_id = $1", [B.tenantId]),
      ),
    );
    await expectDbError(
      as({ userId: A.adminId }, (q) => q("update public.whatsapp_qr set qr = 'x' where tenant_id = $1", [A.tenantId])),
    );
    const s = await raw<{ desired_state: string }>("select desired_state from public.whatsapp_sessions where tenant_id = $1", [B.tenantId]);
    expect(s[0].desired_state).toBe("conectado");
  });

  it("whatsapp_request só afeta o tenant do admin logado", async () => {
    await as({ userId: A.adminId }, (q) => q("select public.whatsapp_request('desconectar')"));
    const rows = await raw<{ tenant_id: string; desired_state: string }>(
      "select tenant_id, desired_state from public.whatsapp_sessions where tenant_id = any($1)",
      [[A.tenantId, B.tenantId]],
    );
    const byTenant = Object.fromEntries(rows.map((r) => [r.tenant_id, r.desired_state]));
    expect(byTenant[A.tenantId]).toBe("desconectado");
    expect(byTenant[B.tenantId]).toBe("conectado");
  });

  it("atendente não pode conectar/desconectar", async () => {
    await expectDbError(as({ userId: A.atendenteId }, (q) => q("select public.whatsapp_request('conectar')")));
  });
});

describe("fila de envio (outbox)", () => {
  it("A não vê a fila de B", async () => {
    const r = await as({ userId: A.adminId }, (q) => q("select * from public.whatsapp_outbox"));
    expect(r.rowCount).toBe(0);
  });

  it("A não enfileira mensagem para contato de B nem com tenant_id de B", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.whatsapp_outbox (contact_id, body) values ($1, 'spam')", [B.contactId]),
      ),
    );
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.whatsapp_outbox (tenant_id, contact_id, body) values ($1, $2, 'spam')", [B.tenantId, B.contactId]),
      ),
    );
    const n = await raw<{ n: number }>("select count(*)::int as n from public.whatsapp_outbox where tenant_id = $1", [B.tenantId]);
    expect(n[0].n).toBe(1);
  });

  it("A não altera status nem apaga mensagens não agendadas da fila (worker é quem atualiza)", async () => {
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.whatsapp_outbox set status = 'enviado'")));
    const before = await raw<{ n: number }>("select count(*)::int as n from public.whatsapp_outbox");
    const del = await as({ userId: A.adminId }, (q) => q("delete from public.whatsapp_outbox"));
    expect(del.rowCount).toBe(0);
    const after = await raw<{ n: number }>("select count(*)::int as n from public.whatsapp_outbox");
    expect(after[0].n).toBe(before[0].n);
  });

  it("A enfileira para o próprio contato e a linha fica no tenant A", async () => {
    const r = await as({ userId: A.atendenteId }, (q) =>
      q<{ tenant_id: string; status: string }>(
        "insert into public.whatsapp_outbox (contact_id, body) values ($1, 'olá') returning tenant_id, status",
        [A.contactId],
      ),
    );
    expect(r.rows[0]).toEqual({ tenant_id: A.tenantId, status: "pendente" });
  });

  it("insert com o tenant_id da própria sessão (como faz a camada TenantDb) funciona", async () => {
    const r = await as({ userId: A.atendenteId }, (q) =>
      q<{ tenant_id: string }>(
        "insert into public.whatsapp_outbox (tenant_id, contact_id, body) values ($1, $2, 'via TenantDb') returning tenant_id",
        [A.tenantId, A.contactId],
      ),
    );
    expect(r.rows[0].tenant_id).toBe(A.tenantId);
  });

  it("service_role não consegue ligar fila de A a contato de B (FK composta)", async () => {
    await expectDbError(
      as("service", (q) =>
        q("insert into public.whatsapp_outbox (tenant_id, contact_id, body) values ($1, $2, 'x')", [A.tenantId, B.contactId]),
      ),
    );
  });
});
