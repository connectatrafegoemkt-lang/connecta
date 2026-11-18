import "server-only";
import { requirePerm, type TenantContext } from "../context";
import { fromDbError } from "../errors";

export interface AuditLog {
  id: number;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  created_at: string;
}

export async function listAuditLogs(ctx: TenantContext, limit = 100): Promise<AuditLog[]> {
  requirePerm(ctx, "auditoria.ver");
  const { data, error } = await ctx.db
    .select("audit_logs", "id, user_id, action, table_name, record_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw fromDbError(error);
  return data as unknown as AuditLog[];
}
