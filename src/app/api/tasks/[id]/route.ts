import { withTenant, readJson, parseId } from "@/server/http";
import { taskUpdateSchema } from "@/server/validation";
import { deleteTask, updateTask } from "@/server/data/tasks";

type P = { id: string };
export const PATCH = withTenant<P>(async (req, ctx, { id }) =>
  updateTask(ctx, parseId(id), await readJson(req, taskUpdateSchema)),
);
export const DELETE = withTenant<P>(async (_req, ctx, { id }) => {
  await deleteTask(ctx, parseId(id));
});
