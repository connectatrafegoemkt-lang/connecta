/** "Gerar novo QR code": só o admin, e só no próprio tenant. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await createTenantFixture("wa-reset-a");
  B = await createTenantFixture("wa-reset-b");
  await as("service", (q) =>
    q("insert into public.whatsapp_sessions (tenant_id, desired_state, status) values ($1, 'conectado', 'conectado'), ($2, 'conectado', 'conectado')", [A.tenantId, B.tenantId]),
  );
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean)]);
  await pool.end();
});

describe("reiniciar pareamento do WhatsApp", () => {
  it("admin pede um QR novo só para a própria empresa", async () => {
    await as({ userId: A.adminId }, (q) => q("select public.whatsapp_request('reiniciar')"));
    const rows = await raw<{ tenant_id: string; status: string; reset_requested_at: string | null }>(
      "select tenant_id, status, reset_requested_at from public.whatsapp_sessions where tenant_id = any($1)",
      [[A.tenantId, B.tenantId]],
    );
    const a = rows.find((r) => r.tenant_id === A.tenantId)!;
    const b = rows.find((r) => r.tenant_id === B.tenantId)!;
    expect(a.status).toBe("conectando");
    expect(a.reset_requested_at).not.toBeNull();
    expect(b.status).toBe("conectado");
    expect(b.reset_requested_at).toBeNull();
  });

  it("atendente e anônimo não reiniciam; ação desconhecida é recusada", async () => {
    await expectDbError(as({ userId: B.atendenteId }, (q) => q("select public.whatsapp_request('reiniciar')")));
    await expectDbError(as("anon", (q) => q("select public.whatsapp_request('reiniciar')")));
    await expectDbError(as({ userId: B.adminId }, (q) => q("select public.whatsapp_request('apagar_tudo')")));
    const [b] = await raw<{ reset_requested_at: string | null }>("select reset_requested_at from public.whatsapp_sessions where tenant_id = $1", [B.tenantId]);
    expect(b.reset_requested_at).toBeNull();
  });
});
