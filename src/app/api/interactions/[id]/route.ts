import { withTenant, parseId } from "@/server/http";
import { deleteInteraction } from "@/server/data/interactions";

export const DELETE = withTenant<{ id: string }>(async (_req, ctx, { id }) => {
  await deleteInteraction(ctx, parseId(id));
});
