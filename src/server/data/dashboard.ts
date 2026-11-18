import "server-only";
import type { TenantContext } from "../context";
import { fromDbError } from "../errors";

export interface DashboardSummary {
  contacts_total: number;
  contacts_last_30d: number;
  pipeline_value_cents: number;
  won_value_cents: number;
  tasks_open: number;
  tasks_overdue: number;
  interactions_last_7d: number;
  by_stage: { id: string; name: string; color: string; count: number }[];
}

export async function getDashboard(ctx: TenantContext): Promise<DashboardSummary> {
  const { data, error } = await ctx.db.rpc("dashboard_summary");
  if (error) throw fromDbError(error);
  return data as DashboardSummary;
}
