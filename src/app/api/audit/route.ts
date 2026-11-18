import { withTenant } from "@/server/http";
import { listAuditLogs } from "@/server/data/audit";

export const GET = withTenant(async (_req, ctx) => listAuditLogs(ctx));
