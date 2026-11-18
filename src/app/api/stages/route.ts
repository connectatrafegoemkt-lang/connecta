import { withTenant, readJson } from "@/server/http";
import { stageCreateSchema } from "@/server/validation";
import { createStage, listStages } from "@/server/data/stages";

export const GET = withTenant(async (_req, ctx) => listStages(ctx));
export const POST = withTenant(async (req, ctx) =>
  Response.json(await createStage(ctx, await readJson(req, stageCreateSchema)), { status: 201 }),
);
