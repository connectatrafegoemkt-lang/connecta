import { withTenant, readJson, readQuery } from "@/server/http";
import { taskCreateSchema, taskListQuerySchema } from "@/server/validation";
import { createTask, listTasks } from "@/server/data/tasks";

export const GET = withTenant(async (req, ctx) => listTasks(ctx, readQuery(req, taskListQuerySchema)));
export const POST = withTenant(async (req, ctx) =>
  Response.json(await createTask(ctx, await readJson(req, taskCreateSchema)), { status: 201 }),
);
