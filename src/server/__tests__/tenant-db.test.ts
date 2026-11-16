import { describe, expect, it, vi } from "vitest";
import { cleanPatch, stampTenant, TenantDb } from "../data/tenant-db";

function fakeClient() {
  const calls: { op: string; args: unknown[] }[] = [];
  const builder: Record<string, (...a: unknown[]) => unknown> = {};
  for (const op of ["select", "insert", "update", "delete", "eq"]) {
    builder[op] = vi.fn((...args: unknown[]) => {
      calls.push({ op, args });
      return builder;
    });
  }
  const client = { from: vi.fn(() => builder), rpc: vi.fn() };
  return { client, calls };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("TenantDb (camada única de acesso)", () => {
  it("select sempre filtra por tenant_id da sessão", () => {
    const { client, calls } = fakeClient();
    new TenantDb(client as never, TENANT).select("contacts", "id");
    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
  });

  it("insert sobrescreve tenant_id vindo de fora", () => {
    const { client, calls } = fakeClient();
    new TenantDb(client as never, TENANT).insert("contacts", { name: "x", tenant_id: OTHER });
    const ins = calls.find((c) => c.op === "insert")!;
    expect(ins.args[0]).toEqual({ name: "x", tenant_id: TENANT });
  });

  it("insert em lote também aplica o tenant em cada linha", () => {
    const { client, calls } = fakeClient();
    new TenantDb(client as never, TENANT).insert("tags", [{ name: "a", tenant_id: OTHER }, { name: "b" }]);
    const rows = calls.find((c) => c.op === "insert")!.args[0] as { tenant_id: string }[];
    expect(rows.every((r) => r.tenant_id === TENANT)).toBe(true);
  });

  it("update remove tenant_id/id do patch e filtra pelo tenant", () => {
    const { client, calls } = fakeClient();
    new TenantDb(client as never, TENANT).update("contacts", { name: "y", tenant_id: OTHER, id: "z" });
    expect(calls.find((c) => c.op === "update")!.args[0]).toEqual({ name: "y" });
    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
  });

  it("delete filtra pelo tenant", () => {
    const { client, calls } = fakeClient();
    new TenantDb(client as never, TENANT).delete("tasks");
    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
  });

  it("não aceita tenantId vazio", () => {
    const { client } = fakeClient();
    expect(() => new TenantDb(client as never, "")).toThrow();
  });

  it("storagePath sempre prefixa o tenant e bloqueia path traversal", () => {
    const { client } = fakeClient();
    const db = new TenantDb(client as never, TENANT);
    expect(db.storagePath("contatos", "a.pdf")).toBe(`${TENANT}/contatos/a.pdf`);
    expect(() => db.storagePath("..", "x")).toThrow();
    expect(() => db.storagePath(`${OTHER}/x`)).toThrow();
    expect(() => db.storagePath("")).toThrow();
  });

  it("helpers puros", () => {
    expect(stampTenant({ a: 1, tenant_id: OTHER }, TENANT)).toEqual({ a: 1, tenant_id: TENANT });
    expect(cleanPatch({ a: 1, tenant_id: OTHER, id: "x" })).toEqual({ a: 1 });
  });
});
