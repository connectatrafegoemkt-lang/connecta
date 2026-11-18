import { withTenant, readJson, parseId } from "@/server/http";
import { tagUpdateSchema } from "@/server/validation";
import { deleteTag, updateTag } from "@/server/data/tags";

type P = { id: string };
export const PATCH = withTenant<P>(async (req, ctx, { id }) =>
  updateTag(ctx, parseId(id), await readJson(req, tagUpdateSchema)),
);
export const DELETE = withTenant<P>(async (_req, ctx, { id }) => {
  await deleteTag(ctx, parseId(id));
});
