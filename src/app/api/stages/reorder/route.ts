import { withTenant, readJson } from "@/server/http";
import { stageReorderSchema } from "@/server/validation";
import { reorderStages } from "@/server/data/stages";

export const POST = withTenant(async (req, ctx) => {
  await reorderStages(ctx, (await readJson(req, stageReorderSchema)).ids);
});
