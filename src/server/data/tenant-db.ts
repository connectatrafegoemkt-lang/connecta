import type { SupabaseClient } from "@supabase/supabase-js";

/** Tabelas de negócio com coluna tenant_id. */
export const TENANT_TABLES = [
  "contacts",
  "pipeline_stages",
  "tags",
  "contact_tags",
  "interactions",
  "tasks",
  "memberships",
  "audit_logs",
  "whatsapp_sessions",
  "whatsapp_qr",
  "whatsapp_outbox",
  // whatsapp_auth_keys fica DE FORA de propósito: só o worker acessa.
] as const;
export type TenantTable = (typeof TENANT_TABLES)[number];

type Row = Record<string, unknown>;

/** Remove qualquer tenant_id vindo de fora e aplica o da sessão. */
export function stampTenant<T extends Row>(row: T, tenantId: string): T & { tenant_id: string } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tenant_id: _ignored, ...rest } = row;
  return { ...(rest as T), tenant_id: tenantId };
}

/** Remove tenant_id (imutável) e id de um patch de update. */
export function cleanPatch<T extends Row>(patch: T): Omit<T, "tenant_id" | "id"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tenant_id: _t, id: _i, ...rest } = patch;
  return rest;
}

/**
 * CAMADA ÚNICA DE ACESSO A DADOS.
 *
 * Toda operação recebe automaticamente o filtro/valor de tenant_id da
 * sessão. É impossível montar uma query sem tenant por aqui. Isso soma-se ao
 * RLS do banco (defesa em profundidade): mesmo que uma policy fosse
 * removida por engano, as queries continuariam filtradas.
 */
export class TenantDb {
  constructor(
    private readonly sb: SupabaseClient,
    readonly tenantId: string,
  ) {
    if (!tenantId) throw new Error("TenantDb sem tenantId");
  }

  select(table: TenantTable, columns = "*", options?: { count?: "exact"; head?: boolean }) {
    return this.sb.from(table).select(columns, options).eq("tenant_id", this.tenantId);
  }

  insert(table: TenantTable, rows: Row | Row[]) {
    const stamped = Array.isArray(rows)
      ? rows.map((r) => stampTenant(r, this.tenantId))
      : stampTenant(rows, this.tenantId);
    return this.sb.from(table).insert(stamped);
  }

  update(table: TenantTable, patch: Row) {
    return this.sb.from(table).update(cleanPatch(patch)).eq("tenant_id", this.tenantId);
  }

  delete(table: TenantTable) {
    return this.sb.from(table).delete().eq("tenant_id", this.tenantId);
  }

  /** RPCs permitidas: todas derivam o tenant internamente via auth.uid(). */
  rpc(fn: "dashboard_summary"): ReturnType<SupabaseClient["rpc"]>;
  rpc(fn: "whatsapp_request", args: { p_action: "conectar" | "desconectar" }): ReturnType<SupabaseClient["rpc"]>;
  rpc(fn: "dashboard_summary" | "whatsapp_request", args?: Record<string, unknown>) {
    return this.sb.rpc(fn, args);
  }

  /** Storage: todo caminho é prefixado com o tenant e validado. */
  storagePath(...parts: string[]): string {
    for (const p of parts) {
      if (!p || p.includes("..") || p.includes("/") || p.includes("\\")) {
        throw new Error("Segmento de caminho inválido");
      }
    }
    return [this.tenantId, ...parts].join("/");
  }

  get storage() {
    return this.sb.storage.from("tenant-files");
  }

  /** Canal realtime não é exposto aqui; o navegador assina com RLS. */
}
