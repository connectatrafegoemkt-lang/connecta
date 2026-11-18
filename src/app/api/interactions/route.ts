import { withTenant, readJson } from "@/server/http";
import { interactionCreateSchema } from "@/server/validation";
import { createInteraction } from "@/server/data/interactions";

export const POST = withTenant(async (req, ctx) => {
  const input = await readJson(req, interactionCreateSchema);
  return Response.json(await createInteraction(ctx, input), { status: 201 });
});
