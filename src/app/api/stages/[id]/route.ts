import { withTenant, readJson, parseId } from "@/server/http";
import { stageUpdateSchema } from "@/server/validation";
import { deleteStage, updateStage } from "@/server/data/stages";

type P = { id: string };
export const PATCH = withTenant<P>(async (req, ctx, { id }) =>
  updateStage(ctx, parseId(id), await readJson(req, stageUpdateSchema)),
);
export const DELETE = withTenant<P>(async (_req, ctx, { id }) => {
  await deleteStage(ctx, parseId(id));
});
