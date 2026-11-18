import { withTenant } from "@/server/http";

export const GET = withTenant(async (_req, ctx) => ({
  user_id: ctx.userId,
  tenant_id: ctx.tenantId,
  tenant_name: ctx.tenantName,
  role: ctx.role,
  profile: ctx.profile,
  permissions: [...ctx.permissions].sort(),
  department_ids: ctx.departmentIds,
  display_name: ctx.displayName,
}));
