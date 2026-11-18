import { withTenant, readJson } from "@/server/http";
import { tagCreateSchema } from "@/server/validation";
import { createTag, listTags } from "@/server/data/tags";

export const GET = withTenant(async (_req, ctx) => listTags(ctx));
export const POST = withTenant(async (req, ctx) =>
  Response.json(await createTag(ctx, await readJson(req, tagCreateSchema)), { status: 201 }),
);
