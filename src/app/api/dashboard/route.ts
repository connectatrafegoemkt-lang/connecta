import { withTenant } from "@/server/http";
import { getDashboard } from "@/server/data/dashboard";

export const GET = withTenant(async (_req, ctx) => getDashboard(ctx));
