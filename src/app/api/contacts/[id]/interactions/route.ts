import { withTenant, parseId } from "@/server/http";
import { listInteractions } from "@/server/data/interactions";

export const GET = withTenant<{ id: string }>(async (_req, ctx, { id }) => listInteractions(ctx, parseId(id)));
